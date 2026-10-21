import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import { db } from "./db";
import { assertProductionSecret } from "./config";

// Production startup guard: refuse to boot with a missing/weak/placeholder
// session secret (Phase D). The value itself is never printed.
assertProductionSecret("SESSION_SECRET", process.env.SESSION_SECRET);

const secret = new TextEncoder().encode(process.env.SESSION_SECRET);

export const SESSION_COOKIE = "session";
export const STEPUP_COOKIE = "stepup";

/** Step-up (sensitive admin actions) is valid this long after re-verification. */
export const STEPUP_TTL_SEC = 5 * 60;
/** A fresh login counts as step-up for this long. */
export const RECENT_AUTH_SEC = 10 * 60;
export const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

export type SessionPayload = {
  sub: string;
  role: string;
  jti: string;
  iat: number;
};

export type StepUpPayload = { sub: string; purpose: "stepup"; jti: string; iat: number };

// ── pure token helpers (no request context; unit-testable) ──

export async function signSessionToken(opts: {
  userId: string;
  role: string;
  jti: string;
  issuedAt?: number;
  expiresAtSec?: number;
}): Promise<string> {
  const iat = opts.issuedAt ?? Math.floor(Date.now() / 1000);
  const exp = iat + (opts.expiresAtSec ?? SESSION_TTL_SEC);
  return new SignJWT({ role: opts.role, jti: opts.jti })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(opts.userId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(secret);
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (!payload.sub || !payload.jti) return null;
    return {
      sub: payload.sub,
      role: (payload.role as string) || "TRADER",
      jti: payload.jti as string,
      iat: (payload.iat as number) || 0,
    };
  } catch {
    return null;
  }
}

export async function signStepUpToken(userId: string): Promise<string> {
  const jti = randomBytes(16).toString("hex");
  const iat = Math.floor(Date.now() / 1000);
  return new SignJWT({ purpose: "stepup", jti })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + STEPUP_TTL_SEC)
    .sign(secret);
}

export async function verifyStepUpToken(
  token: string,
  userId: string
): Promise<StepUpPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.sub !== userId || payload.purpose !== "stepup" || !payload.jti)
      return null;
    return {
      sub: payload.sub,
      purpose: "stepup",
      jti: payload.jti as string,
      iat: (payload.iat as number) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Validates the DB session registry row for a session token. Returns false
 * for revoked, expired, or unknown sessions (stateless JWT alone is not
 * enough — logout/password-change revoke rows).
 */
export async function isSessionActive(jti: string): Promise<boolean> {
  const row = await db.session.findUnique({ where: { id: jti } });
  if (!row) return false;
  if (row.revokedAt) return false;
  if (row.expiresAt.getTime() < Date.now()) return false;
  return true;
}

/** Revokes every session for a user, optionally keeping one (current jti). */
export async function revokeUserSessions(
  userId: string,
  exceptJti?: string
): Promise<number> {
  const res = await db.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptJti ? { id: { not: exceptJti } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

// ── cookie-bound helpers (request context) ──

export async function createSession(
  userId: string,
  role: string,
  userAgent?: string
) {
  const jti = randomBytes(16).toString("hex");
  const now = new Date();
  await db.session.create({
    data: {
      id: jti,
      userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_SEC * 1000),
      userAgent: userAgent ? userAgent.slice(0, 200) : null,
    },
  });
  const token = await signSessionToken({ userId, role, jti });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const payload = await verifySessionToken(token);
    if (payload) {
      await db.session.updateMany({
        where: { id: payload.jti, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(STEPUP_COOKIE);
}

export async function issueStepUpCookie() {
  const session = await verifySession();
  if (!session) return false;
  const token = await signStepUpToken(session.sub);
  const cookieStore = await cookies();
  cookieStore.set(STEPUP_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STEPUP_TTL_SEC,
  });
  return true;
}

export async function verifySession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  // Server-side revocation check (logout / password change / admin revoke).
  if (!(await isSessionActive(payload.jti))) return null;
  return payload;
}

export const getCurrentUser = cache(async () => {
  const session = await verifySession();
  if (!session) return null;
  const user = await db.user.findUnique({ where: { id: session.sub } });
  return user;
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/dashboard");
  return user;
}

/**
 * Step-up gate for sensitive admin actions (payments, payouts, role changes,
 * financial settings). Satisfied by either:
 *  - a fresh login (session iat within RECENT_AUTH_SEC), or
 *  - a valid step-up cookie issued after password re-verification (and TOTP
 *    code, when the admin 2FA setting is enabled).
 * Returns null when satisfied, or a user-safe error string.
 */
export async function requireStepUp(): Promise<string | null> {
  const session = await verifySession();
  if (!session) return "Not logged in";
  const now = Math.floor(Date.now() / 1000);
  if (session.iat && now - session.iat <= RECENT_AUTH_SEC) return null;

  const cookieStore = await cookies();
  const token = cookieStore.get(STEPUP_COOKIE)?.value;
  if (!token) return "Recent re-verification required for this action";
  const step = await verifyStepUpToken(token, session.sub);
  if (!step) return "Verification expired — please re-enter your password";
  return null;
}

/** True when the admin 2FA setting is enforced. */
export async function adminTwoFactorEnabled(): Promise<boolean> {
  const s = await db.setting.findUnique({ where: { key: "adminTwoFactor" } });
  return s?.value === "true";
}
