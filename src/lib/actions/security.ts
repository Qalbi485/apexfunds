"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  requireAdmin,
  requireStepUp,
  verifySession,
  revokeUserSessions,
} from "@/lib/auth";
import { generateTotpSecret, totpProvisioningUri, totpVerify } from "@/lib/totp";
import { writeAuditSafe } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { SITE } from "@/lib/config";
import type { ActionResult } from "./trader";

export type TotpStartResult =
  | { error?: string; success?: string; data?: { secret: string; uri: string } }
  | null;

/**
 * Begins TOTP enrollment for the current admin. Requires step-up. Stores the
 * secret with totpEnabled=false until confirmTotpAction verifies a code.
 */
export async function enableTotpStartAction(): Promise<TotpStartResult> {
  const admin = await requireAdmin();
  const stepUp = await requireStepUp();
  if (stepUp) return { error: stepUp };

  const secret = generateTotpSecret();
  await db.user.update({
    where: { id: admin.id },
    data: { totpSecret: secret, totpEnabled: false },
  });
  const uri = totpProvisioningUri(secret, admin.email, SITE.name);
  return { data: { secret, uri } };
}

export async function enableTotpConfirmAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const code = String(formData.get("code") || "").trim();
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code" };

  const user = await db.user.findUnique({ where: { id: admin.id } });
  if (!user?.totpSecret) return { error: "Start setup first" };
  if (!totpVerify(user.totpSecret, code)) {
    logger.warn("totp_enable_failed", { userId: admin.id });
    return { error: "Invalid code — check your authenticator app and time sync" };
  }

  await db.user.update({
    where: { id: admin.id },
    data: { totpEnabled: true },
  });
  await writeAuditSafe({
    actorId: admin.id,
    actorEmail: admin.email,
    action: "TOTP_ENABLED",
    entityType: "User",
    entityId: admin.id,
    outcome: "SUCCESS",
  });
  return { success: "Two-factor authentication enabled" };
}

export async function disableTotpAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const password = String(formData.get("password") || "");
  const code = String(formData.get("code") || "").trim();

  const user = await db.user.findUnique({ where: { id: admin.id } });
  if (!user?.totpEnabled || !user.totpSecret)
    return { error: "Two-factor is not enabled" };

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return { error: "Incorrect password" };
  if (!totpVerify(user.totpSecret, code)) return { error: "Invalid code" };

  await db.user.update({
    where: { id: admin.id },
    data: { totpEnabled: false, totpSecret: null },
  });
  await writeAuditSafe({
    actorId: admin.id,
    actorEmail: admin.email,
    action: "TOTP_DISABLED",
    entityType: "User",
    entityId: admin.id,
    outcome: "SUCCESS",
  });
  return { success: "Two-factor authentication disabled" };
}

const revokeSchema = z.object({ jti: z.string().min(8) });

/** Revokes one of the current user's own sessions by jti. */
export async function revokeOwnSessionAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await verifySession();
  if (!session) return { error: "Not logged in" };
  const parsed = revokeSchema.safeParse({ jti: formData.get("jti") });
  if (!parsed.success) return { error: "Invalid session" };

  const res = await db.session.updateMany({
    where: { id: parsed.data.jti, userId: session.sub, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (res.count === 0) return { error: "Session not found" };
  return { success: "Session signed out" };
}

/** Signs out every session except the current one. */
export async function revokeOtherSessionsAction(): Promise<ActionResult> {
  const session = await verifySession();
  if (!session) return { error: "Not logged in" };
  const n = await revokeUserSessions(session.sub, session.jti);
  return { success: `Signed out ${n} other session(s)` };
}
