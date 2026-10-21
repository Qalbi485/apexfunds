"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import {
  createSession,
  destroySession,
  verifySession,
  revokeUserSessions,
  issueStepUpCookie,
  adminTwoFactorEnabled,
} from "@/lib/auth";
import { randomCode } from "@/lib/utils";
import { RATE_LIMITS, consumeRateLimit, clearRateLimit, pickClientIp } from "@/lib/ratelimit";
import { createPasswordResetToken, consumePasswordResetToken } from "@/lib/password-reset";
import { sendEmail } from "@/lib/notify";
import { logger } from "@/lib/logger";
import { SITE, seedLoginBlocked } from "@/lib/config";
import { totpVerify } from "@/lib/totp";

export type AuthFormState = { error?: string; success?: string } | null;

/** Dummy hash to equalize timing for unknown emails (bcrypt, cost 10). */
const DUMMY_HASH = "$2a$10$C6UzMDM.H6dfI/f/IKcEeO7ZBpDLhE3pyLzFA1G0rHhRhbF0eeW1a";

async function clientIp(): Promise<string> {
  const h = await headers();
  return pickClientIp(h.get("x-forwarded-for"), h.get("x-real-ip"));
}

const registerSchema = z.object({
  name: z.string().min(2, "Name too short"),
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Min 8 characters"),
  referral: z.string().optional(),
});

export async function registerAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const ip = await clientIp();
  const rl = await consumeRateLimit(`register:ip:${ip}`, RATE_LIMITS.registerIp);
  if (!rl.ok)
    return { error: `Too many attempts. Try again in ${rl.retryAfterSec}s.` };

  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    referral: formData.get("referral") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "Invalid input" };
  }
  const { name, password, referral } = parsed.data;
  const email = parsed.data.email.toLowerCase();

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { error: "Email already registered" };

  let referredById: string | undefined;
  if (referral) {
    const ref = await db.user.findUnique({
      where: { referralCode: referral.toUpperCase() },
    });
    if (ref) referredById = ref.id;
  }

  let code = randomCode();
  let attempts = 0;
  while (
    (await db.user.findUnique({ where: { referralCode: code } })) &&
    attempts < 20
  ) {
    code = randomCode();
    attempts++;
  }

  const user = await db.user.create({
    data: {
      name,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      referralCode: code,
      referredById,
    },
  });

  logger.info("user_registered", { userId: user.id });
  await createSession(user.id, user.role, (await headers()).get("user-agent") || undefined);
  redirect("/dashboard");
}

const loginSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(1, "Password required"),
});

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const ip = await clientIp();
  const ipKey = `login:ip:${ip}`;
  const ipRl = await consumeRateLimit(ipKey, RATE_LIMITS.loginIp);
  if (!ipRl.ok) {
    logger.warn("login_rate_limited", { scope: "ip", ip });
    return { error: `Too many attempts. Try again in ${ipRl.retryAfterSec}s.` };
  }

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Invalid input" };

  const email = parsed.data.email.toLowerCase();
  const emailKey = `login:email:${email}`;
  const emailRl = await consumeRateLimit(emailKey, RATE_LIMITS.loginEmail);
  if (!emailRl.ok) {
    logger.warn("login_rate_limited", { scope: "email", email });
    return { error: `Too many attempts. Try again in ${emailRl.retryAfterSec}s.` };
  }

  const user = await db.user.findUnique({ where: { email } });
  // Equalize timing for unknown emails; identical user-facing error.
  const ok = await bcrypt.compare(
    parsed.data.password,
    user?.passwordHash || DUMMY_HASH
  );
  if (!user || !ok) {
    logger.warn("login_failed", { email, ip });
    return { error: "Invalid email or password" };
  }

  // Production: seed/demo credentials are disabled (identical error so the
  // guard itself does not reveal that the account exists).
  if (seedLoginBlocked(email)) {
    logger.warn("seed_login_blocked", { email, ip });
    return { error: "Invalid email or password" };
  }

  // Success: clear the per-email failure bucket so past failures stop counting.
  await clearRateLimit(emailKey);

  logger.info("login_success", { userId: user.id, role: user.role });
  await createSession(user.id, user.role, (await headers()).get("user-agent") || undefined);
  redirect(user.role === "ADMIN" ? "/admin" : "/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}

const pwSchema = z.object({
  current: z.string().min(1, "Current password required"),
  next: z.string().min(8, "New password must be at least 8 characters"),
});

export async function changePasswordAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const session = await verifySession();
  if (!session) return { error: "Not logged in" };

  const rl = await consumeRateLimit(
    `pwchange:${session.sub}`,
    RATE_LIMITS.passwordChange
  );
  if (!rl.ok)
    return { error: `Too many attempts. Try again in ${rl.retryAfterSec}s.` };

  const user = await db.user.findUnique({ where: { id: session.sub } });
  if (!user) return { error: "User not found" };

  const parsed = pwSchema.safeParse({
    current: formData.get("current"),
    next: formData.get("next"),
  });
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message || "Invalid input" };

  const ok = await bcrypt.compare(parsed.data.current, user.passwordHash);
  if (!ok) {
    logger.warn("password_change_failed", { userId: user.id });
    return { error: "Current password is incorrect" };
  }

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(parsed.data.next, 10) },
  });
  // Invalidate every previously issued session except the current one.
  const revoked = await revokeUserSessions(user.id, session.jti);
  logger.info("password_changed", { userId: user.id, revokedSessions: revoked });

  return { success: "Password updated. Other sessions were signed out." };
}

// ── Password reset (non-enumerating) ──

export async function requestPasswordResetAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const ip = await clientIp();
  const ipRl = await consumeRateLimit(
    `reset:ip:${ip}`,
    RATE_LIMITS.passwordResetIp
  );
  if (!ipRl.ok)
    return { error: `Too many attempts. Try again in ${ipRl.retryAfterSec}s.` };

  const emailRaw = String(formData.get("email") || "").trim().toLowerCase();
  if (!emailRaw || !emailRaw.includes("@"))
    return { error: "Enter a valid email address" };

  const emailRl = await consumeRateLimit(
    `reset:email:${emailRaw}`,
    RATE_LIMITS.passwordResetEmail
  );
  if (!emailRl.ok)
    return { error: `Too many attempts. Try again in ${emailRl.retryAfterSec}s.` };

  const user = await db.user.findUnique({ where: { email: emailRaw } });
  if (user) {
    try {
      const { raw, expiresAt } = await createPasswordResetToken(user.id, ip);
      const url = `${process.env.SITE_URL || ""}/reset-password?token=${raw}`;
      const sent = await sendEmail(
        user.email,
        "Reset your password",
        `<p>Someone requested a password reset for your ${SITE.name} account.</p>
         <p>This link expires in 30 minutes and can be used once:</p>
         <p><a href="${url}">${url}</a></p>
         <p>If you did not request this, ignore this email.</p>`
      );
      if (sent !== "sent") {
        // Operational visibility: never silently pretend mail was delivered.
        logger.warn("password_reset_email_unavailable", {
          userId: user.id,
          reason: sent,
        });
      } else {
        logger.info("password_reset_email_sent", {
          userId: user.id,
          expiresAt: expiresAt.toISOString(),
        });
      }
    } catch (e) {
      logger.error("password_reset_token_failed", {
        userId: user.id,
        error: (e as Error).message,
      });
    }
  } else {
    logger.info("password_reset_unknown_email", { ip });
  }

  // Identical response whether or not the email exists (no enumeration).
  return {
    success: "If that email has an account, a reset link has been sent.",
  };
}

export async function performPasswordResetAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const ip = await clientIp();
  const rl = await consumeRateLimit(
    `reset:ip:${ip}`,
    RATE_LIMITS.passwordResetIp
  );
  if (!rl.ok)
    return { error: `Too many attempts. Try again in ${rl.retryAfterSec}s.` };

  const token = String(formData.get("token") || "").trim();
  const password = String(formData.get("password") || "");
  if (password.length < 8)
    return { error: "New password must be at least 8 characters" };
  if (!token) return { error: "Invalid or expired link" };

  const result = await consumePasswordResetToken(
    token,
    await bcrypt.hash(password, 10)
  );
  if ("error" in result) {
    logger.warn("password_reset_consume_failed", { ip });
    return { error: result.error };
  }

  await revokeUserSessions(result.userId);
  logger.info("password_reset_completed", { userId: result.userId });
  return { success: "Password updated. Please sign in with your new password." };
}

// ── Step-up re-verification (sensitive admin actions) ──

const reverifySchema = z.object({
  password: z.string().min(1, "Password required"),
  totp: z.string().optional(),
});

export async function reverifyAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const session = await verifySession();
  if (!session) return { error: "Not logged in" };

  const rl = await consumeRateLimit(
    `reverify:${session.sub}`,
    RATE_LIMITS.passwordChange
  );
  if (!rl.ok)
    return { error: `Too many attempts. Try again in ${rl.retryAfterSec}s.` };

  const user = await db.user.findUnique({ where: { id: session.sub } });
  if (!user) return { error: "User not found" };

  const parsed = reverifySchema.safeParse({
    password: formData.get("password"),
    totp: String(formData.get("totp") || "").trim() || undefined,
  });
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message || "Invalid input" };

  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) {
    logger.warn("reverify_failed", { userId: user.id, reason: "password" });
    return { error: "Incorrect password" };
  }

  if (await adminTwoFactorEnabled()) {
    if (!user.totpEnabled || !user.totpSecret)
      return { error: "Two-factor authentication is required for admin actions" };
    if (!parsed.data.totp || !totpVerify(user.totpSecret, parsed.data.totp)) {
      logger.warn("reverify_failed", { userId: user.id, reason: "totp" });
      return { error: "Invalid authenticator code" };
    }
  }

  await issueStepUpCookie();
  logger.info("reverify_success", { userId: user.id });
  return { success: "Verified. Sensitive actions are unlocked for 5 minutes." };
}
