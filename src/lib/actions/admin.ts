"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, TX_OPTS } from "@/lib/db";
import { requireAdmin, requireStepUp } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { confirmPaymentCore, flushPaymentAlerts } from "@/lib/payments";
import { processPayoutCore } from "@/lib/payouts";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import type { ActionResult } from "./trader";
export type { ActionResult };

export async function confirmPaymentAction(paymentId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  const stepUp = await requireStepUp();
  if (stepUp) return { error: stepUp };

  const result = await confirmPaymentCore(paymentId, {
    id: admin.id,
    email: admin.email,
  });
  if ("error" in result) return { error: result.error };
  await flushPaymentAlerts(result.alerts);
  logger.info("payment_confirmed", { paymentId, actorId: admin.id });

  revalidatePath("/admin/payments");
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return { success: "Payment confirmed" };
}

export async function processPayoutAction(
  payoutId: string,
  action: "APPROVED" | "PAID" | "REJECTED"
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const stepUp = await requireStepUp();
  if (stepUp) return { error: stepUp };

  const result = await processPayoutCore(payoutId, action, {
    id: admin.id,
    email: admin.email,
  });
  if ("error" in result) return { error: result.error };
  for (const a of result.alerts) await notify(a);
  logger.info("payout_processed", { payoutId, action, actorId: admin.id });

  revalidatePath("/admin/payouts");
  revalidatePath("/dashboard/payouts");
  return { success: `Payout ${action.toLowerCase()}` };
}

export async function reviewKycAction(
  kycId: string,
  action: "APPROVED" | "REJECTED"
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const stepUp = await requireStepUp();
  if (stepUp) return { error: stepUp };

  const kyc = await db.kyc.findUnique({ where: { id: kycId } });
  if (!kyc) return { error: "KYC not found" };

  await db.$transaction(async (tx) => {
    await tx.kyc.update({
      where: { id: kycId },
      data: { status: action, reviewedAt: new Date() },
    });
    // Status transition only — document numbers are never written to audit.
    await writeAudit(tx, {
      actorId: admin.id,
      actorEmail: admin.email,
      action: "KYC_REVIEWED",
      entityType: "Kyc",
      entityId: kycId,
      outcome: "SUCCESS",
      before: { status: kyc.status },
      after: { status: action },
    });
  }, TX_OPTS);

  await notify({
    userId: kyc.userId,
    type: "SYSTEM",
    title: action === "APPROVED" ? "KYC approved ✅" : "KYC rejected",
    body:
      action === "APPROVED"
        ? "Your identity verification is complete."
        : "Please resubmit your identity documents.",
    emailSubject:
      action === "APPROVED"
        ? "KYC approved — you're verified"
        : "KYC needs resubmission",
  });

  revalidatePath("/admin/kyc");
  return { success: `KYC ${action.toLowerCase()}` };
}

const settingsSchema = z.record(z.string(), z.string());

export async function saveSettingsAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const stepUp = await requireStepUp();
  if (stepUp) return { error: stepUp };

  const entries: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("set_") && typeof value === "string") {
      entries[key.slice(4)] = value;
    }
  }
  const parsed = settingsSchema.safeParse(entries);
  if (!parsed.success) return { error: "Invalid settings" };

  await db.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(parsed.data)) {
      const existing = await tx.setting.findUnique({ where: { key } });
      await tx.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
      await writeAudit(tx, {
        actorId: admin.id,
        actorEmail: admin.email,
        action: "SETTING_CHANGED",
        entityType: "Setting",
        entityId: key,
        outcome: "SUCCESS",
        before: existing ? { value: existing.value } : null,
        after: { value },
      });
    }
  }, TX_OPTS);

  revalidatePath("/admin/settings");
  return { success: "Settings saved" };
}

export async function togglePackageAction(packageId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  const stepUp = await requireStepUp();
  if (stepUp) return { error: stepUp };

  const pkg = await db.package.findUnique({ where: { id: packageId } });
  if (!pkg) return { error: "Package not found" };
  await db.$transaction(async (tx) => {
    await tx.package.update({
      where: { id: packageId },
      data: { active: !pkg.active },
    });
    await writeAudit(tx, {
      actorId: admin.id,
      actorEmail: admin.email,
      action: "PACKAGE_TOGGLED",
      entityType: "Package",
      entityId: packageId,
      outcome: "SUCCESS",
      before: { active: pkg.active },
      after: { active: !pkg.active },
    });
  }, TX_OPTS);
  revalidatePath("/admin/packages");
  revalidatePath("/");
  return { success: pkg.active ? "Package disabled" : "Package enabled" };
}

const roleSchema = z.object({
  userId: z.string().min(8),
  role: z.enum(["TRADER", "ADMIN"]),
});

/**
 * Changes a user's role. Guarded by admin + step-up; cannot change your own
 * role (prevents accidental admin lockout and self-privilege games).
 */
export async function setUserRoleAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const stepUp = await requireStepUp();
  if (stepUp) return { error: stepUp };

  const parsed = roleSchema.safeParse({
    userId: formData.get("userId"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: "Invalid input" };
  if (parsed.data.userId === admin.id)
    return { error: "You cannot change your own role" };

  const target = await db.user.findUnique({ where: { id: parsed.data.userId } });
  if (!target) return { error: "User not found" };
  if (target.role === parsed.data.role)
    return { error: "User already has that role" };

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: { role: parsed.data.role },
    });
    await writeAudit(tx, {
      actorId: admin.id,
      actorEmail: admin.email,
      action: "USER_ROLE_CHANGED",
      entityType: "User",
      entityId: target.id,
      outcome: "SUCCESS",
      before: { role: target.role },
      after: { role: parsed.data.role },
    });
  }, TX_OPTS);
  // A privilege change must invalidate outstanding sessions of the target
  // so a stale JWT role claim cannot linger.
  await db.session.updateMany({
    where: { userId: target.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  logger.warn("user_role_changed", {
    targetUserId: target.id,
    from: target.role,
    to: parsed.data.role,
    actorId: admin.id,
  });

  revalidatePath("/admin/users");
  return { success: `Role updated to ${parsed.data.role}` };
}

export async function adminReplyTicketAction(
  ticketId: string,
  formData: FormData
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const body = String(formData.get("body") || "").trim();
  const close = formData.get("close") === "on";
  if (!body) return { error: "Message required" };

  const ticket = await db.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) return { error: "Ticket not found" };

  await db.$transaction(async (tx) => {
    await tx.ticketMessage.create({
      data: { ticketId, authorId: admin.id, authorRole: "ADMIN", body },
    });
    await tx.supportTicket.update({
      where: { id: ticketId },
      data: { status: close ? "CLOSED" : "REPLIED" },
    });
    await writeAudit(tx, {
      actorId: admin.id,
      actorEmail: admin.email,
      action: "TICKET_REPLIED",
      entityType: "SupportTicket",
      entityId: ticketId,
      outcome: "SUCCESS",
      before: { status: ticket.status },
      after: { status: close ? "CLOSED" : "REPLIED" },
    });
  }, TX_OPTS);

  revalidatePath(`/admin/tickets/${ticketId}`);
  return { success: "Reply sent" };
}
