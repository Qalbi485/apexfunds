"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { syncChallenge } from "@/lib/sync";
import { round2 } from "@/lib/rules";
import { notify } from "@/lib/notify";
import { requestPayoutCore } from "@/lib/payouts";
import { submitPaymentTxCore } from "@/lib/payments";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/ratelimit";

export type ActionResult = { error?: string; success?: string; data?: unknown } | null;

export async function purchaseChallengeAction(packageId: string) {
  const user = await requireUser();
  const pkg = await db.package.findUnique({ where: { id: packageId } });
  if (!pkg || !pkg.active) redirect("/#challenges");

  const phases = JSON.parse(pkg.phasesJson) as Array<{
    phase: string;
    targetPct: number;
    maxDailyLossPct: number;
    maxTotalDrawdownPct: number;
    minTradingDays: number;
  }>;
  const first = phases[0];
  const isInstant = first.phase === "FUNDED";

  const challenge = await db.challenge.create({
    data: {
      userId: user.id,
      packageId: pkg.id,
      type: pkg.slug.startsWith("ONE_STEP")
        ? "ONE_STEP"
        : pkg.slug.startsWith("TWO_STEP")
          ? "TWO_STEP"
          : "INSTANT",
      phase: isInstant ? "FUNDED" : first.phase,
      status: "PENDING_PAYMENT",
      accountSize: pkg.accountSize,
      startBalance: pkg.accountSize,
      currentBalance: pkg.accountSize,
      peakBalance: pkg.accountSize,
      profitTarget: round2(pkg.accountSize * (1 + first.targetPct / 100)),
      maxDailyLoss: round2((first.maxDailyLossPct / 100) * pkg.accountSize),
      maxTotalDrawdown: round2(
        (first.maxTotalDrawdownPct / 100) * pkg.accountSize
      ),
      consistencyPct: isInstant ? 50 : 40,
      minTradingDays: first.minTradingDays,
      brokerAccountId: `acc_${Date.now()}_${user.id.slice(-6)}`,
    },
  });

  const payment = await db.payment.create({
    data: {
      userId: user.id,
      challengeId: challenge.id,
      amount: pkg.price,
      method: "USDT_TRC20",
    },
  });

  redirect(`/checkout/${payment.id}`);
}

const txSchema = z.object({
  txHash: z.string().min(10, "Enter full transaction hash"),
  network: z.enum(["TRC20", "ERC20"]),
});

export async function submitTxAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireUser();
  const paymentId = formData.get("paymentId") as string;
  const parsed = txSchema.safeParse({
    txHash: formData.get("txHash"),
    network: formData.get("network"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "Invalid input" };
  }

  const result = await submitPaymentTxCore({
    paymentId,
    userId: user.id,
    txHash: parsed.data.txHash,
    network: parsed.data.network,
  });
  if ("error" in result) return { error: result.error };

  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  await notify({
    userId: user.id,
    type: "PAYMENT",
    title: "Transaction submitted",
    body: "Your payment is being verified. Your challenge will activate shortly.",
    adminAlert: `🧾 <b>New TXID submitted</b>\n$${payment?.amount ?? "?"} (${parsed.data.network})\nTXID: ${parsed.data.txHash.slice(0, 24)}...\nConfirm in admin → Payments`,
  });

  revalidatePath(`/checkout/${paymentId}`);
  return { success: "Transaction submitted. Waiting for confirmation." };
}

export async function requestPayoutAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireUser();
  const challengeId = formData.get("challengeId") as string;
  const amount = parseFloat(String(formData.get("amount")));
  const walletAddress = String(formData.get("walletAddress") || "").trim();
  const network = String(formData.get("network") || "TRC20");

  const result = await requestPayoutCore({
    userId: user.id,
    challengeId,
    amount,
    walletAddress,
    network,
    actor: { id: user.id, email: user.email },
  });
  if ("error" in result) return { error: result.error };
  for (const a of result.alerts) await notify(a);

  revalidatePath("/dashboard/payouts");
  revalidatePath(`/dashboard/challenges/${challengeId}`);
  return { success: "Payout request submitted." };
}

export async function syncChallengeAction(challengeId: string): Promise<ActionResult> {
  const user = await requireUser();
  const challenge = await db.challenge.findUnique({
    where: { id: challengeId },
  });
  if (!challenge || challenge.userId !== user.id)
    return { error: "Challenge not found" };

  const result = await syncChallenge(challengeId);
  revalidatePath(`/dashboard/challenges/${challengeId}`);
  revalidatePath("/dashboard");
  if (!result.ok) return { error: result.error };
  return {
    success:
      result.newTrades === 0
        ? "No new trades from broker."
        : `Synced ${result.newTrades} trade(s).`,
    data: result.events,
  };
}

export async function submitKycAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireUser();
  const fullName = String(formData.get("fullName") || "").trim();
  const country = String(formData.get("country") || "").trim();
  const documentType = String(formData.get("documentType") || "ID_CARD");
  const documentNumber = String(formData.get("documentNumber") || "").trim();

  if (!fullName || !country || !documentNumber)
    return { error: "All fields are required" };

  // Document number must match the card format (no photo storage — text-only
  // KYC keeps the app deployable on serverless/Cloud Run with Postgres).
  if (documentType === "ID_CARD" && /pak/i.test(country)) {
    if (!/^\d{5}-\d{7}-\d$/.test(documentNumber))
      return {
        error:
          "CNIC number must be exactly 12345-1234567-1 (13 digits with dashes)",
      };
  } else if (!/^[\w\-/ ]{5,32}$/.test(documentNumber)) {
    return { error: "Document number looks invalid" };
  }

  await db.kyc.upsert({
    where: { userId: user.id },
    update: { fullName, country, documentType, documentNumber, status: "PENDING" },
    create: { userId: user.id, fullName, country, documentType, documentNumber },
  });

  revalidatePath("/dashboard/settings");
  return { success: "KYC submitted for review." };
}

export async function createTicketAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireUser();
  const rl = await consumeRateLimit(`support:${user.id}`, RATE_LIMITS.support);
  if (!rl.ok)
    return { error: `Too many tickets. Try again in ${rl.retryAfterSec}s.` };

  const subject = String(formData.get("subject") || "").trim();
  const body = String(formData.get("body") || "").trim();
  if (!subject || !body) return { error: "Subject and message required" };

  await db.supportTicket.create({
    data: {
      userId: user.id,
      subject,
      messages: { create: { authorId: user.id, authorRole: "TRADER", body } },
    },
  });

  await notify({
    adminAlert: `🎫 <b>New support ticket</b>\n${subject}\nFrom: ${user.email}`,
  });

  revalidatePath("/dashboard/support");
  return { success: "Ticket created. Support will reply soon." };
}

export async function replyTicketAction(
  ticketId: string,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireUser();
  const rl = await consumeRateLimit(`support:${user.id}`, RATE_LIMITS.support);
  if (!rl.ok)
    return { error: `Too many replies. Try again in ${rl.retryAfterSec}s.` };

  const body = String(formData.get("body") || "").trim();
  if (!body) return { error: "Message required" };

  const ticket = await db.supportTicket.findUnique({
    where: { id: ticketId },
  });
  if (!ticket || ticket.userId !== user.id)
    return { error: "Ticket not found" };

  await db.$transaction([
    db.ticketMessage.create({
      data: {
        ticketId,
        authorId: user.id,
        authorRole: "TRADER",
        body,
      },
    }),
    db.supportTicket.update({
      where: { id: ticketId },
      data: { status: "OPEN" },
    }),
  ]);

  revalidatePath(`/dashboard/support/${ticketId}`);
  return { success: "Reply sent." };
}

export async function markNotificationsReadAction() {
  const user = await requireUser();
  await db.notification.updateMany({
    where: { userId: user.id, read: false },
    data: { read: true },
  });
  revalidatePath("/dashboard");
}
