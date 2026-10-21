import { db, TX_OPTS } from "./db";
import { round2 } from "./rules";
import { notify, type NotifyOpts } from "./notify";
import { writeAudit, writeAuditSafe, type AuditEntry } from "./audit";

export type Actor = { id: string; email?: string | null };

export type ConfirmPaymentOutcome =
  | { ok: true; alerts: NotifyOpts[]; challengeId: string | null; instant: boolean }
  | { error: string };

/**
 * Atomically confirms a payment and activates its challenge.
 *
 * Integrity: a conditional PENDING→CONFIRMED claim (updateMany) inside a
 * transaction guarantees that of N concurrent confirmations only one wins.
 * Challenge activation is conditional on status PENDING_PAYMENT so a
 * re-confirm can never reset an ACTIVE/FUNDED account. Commission carries a
 * unique paymentId constraint as a second idempotency layer.
 *
 * Audit: PAYMENT_CONFIRMED / PAYMENT_CONFIRM_FAILED rows are written inside
 * the same transaction (or best-effort for failures), atomically with the
 * business change.
 */
export async function confirmPaymentCore(
  paymentId: string,
  actor?: Actor
): Promise<ConfirmPaymentOutcome> {
  const auditBase: Pick<AuditEntry, "actorId" | "actorEmail" | "entityType" | "entityId"> = {
    actorId: actor?.id ?? null,
    actorEmail: actor?.email ?? null,
    entityType: "Payment",
    entityId: paymentId,
  };

  const result = await db.$transaction(async (tx) => {
    const now = new Date();
    const claimed = await tx.payment.updateMany({
      where: { id: paymentId, status: { not: "CONFIRMED" } },
      data: { status: "CONFIRMED", confirmedAt: now },
    });
    if (claimed.count === 0) {
      await writeAudit(tx, {
        ...auditBase,
        action: "PAYMENT_CONFIRM_FAILED",
        outcome: "FAILURE",
        meta: { reason: "already_confirmed_or_missing" },
      });
      return { error: "Already confirmed" } as const;
    }

    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { challenge: { include: { package: true } } },
    });
    if (!payment) return { error: "Payment not found" } as const;

    const alerts: NotifyOpts[] = [];
    let instant = false;

    if (payment.challenge) {
      instant = payment.challenge.type === "INSTANT";
      const isFirstPayment = !payment.challenge.startedAt;
      // Conditional activation: only a PENDING_PAYMENT challenge moves to
      // ACTIVE/FUNDED. Already-active accounts are untouched (no reset).
      const activated = await tx.challenge.updateMany({
        where: { id: payment.challenge.id, status: "PENDING_PAYMENT" },
        data: {
          status: instant ? "FUNDED" : "ACTIVE",
          startedAt: isFirstPayment ? now : payment.challenge.startedAt,
          fundedAt: instant ? now : payment.challenge.fundedAt,
        },
      });

      await writeAudit(tx, {
        ...auditBase,
        action: "CHALLENGE_ACTIVATED",
        entityType: "Challenge",
        entityId: payment.challenge.id,
        outcome: "SUCCESS",
        before: { status: "PENDING_PAYMENT" },
        after: { status: instant ? "FUNDED" : "ACTIVE" },
        meta: { viaPayment: paymentId, alreadyActive: activated.count === 0 },
      });

      alerts.push({
        userId: payment.userId,
        type: "PAYMENT",
        title: instant ? "Instant funded account is live 🎉" : "Challenge activated 🎉",
        body: instant
          ? "Your funded account is ready. Trade carefully — rules apply from the first trade."
          : "Your challenge is active. Good luck!",
        emailSubject: instant
          ? "Your funded account is live"
          : "Challenge activated — good luck!",
        emailBody: instant
          ? `Payment confirmed. Your ${payment.challenge.package.name} funded account is live.`
          : `Payment confirmed. Your ${payment.challenge.package.name} is now active. Open your dashboard to start trading.`,
        adminAlert: `💰 <b>Payment confirmed</b>\n$${payment.amount} • ${payment.challenge.package.name}\nUser: ${payment.userId.slice(-8)}`,
      });
    }

    const buyer = await tx.user.findUnique({
      where: { id: payment.userId },
      select: { referredById: true },
    });
    if (buyer?.referredById) {
      try {
        await tx.commission.create({
          data: {
            referrerId: buyer.referredById,
            paymentId,
            amount: round2(payment.amount * 0.1),
          },
        });
      } catch (e) {
        // Unique paymentId constraint: a concurrent confirmation already
        // created this commission — that is fine, do not fail the confirm.
        if ((e as { code?: string }).code !== "P2002") throw e;
      }
    }

    await writeAudit(tx, {
      ...auditBase,
      action: "PAYMENT_CONFIRMED",
      outcome: "SUCCESS",
      before: { status: "PENDING" },
      after: { status: "CONFIRMED", amount: payment.amount },
    });

    return { ok: true as const, alerts, challengeId: payment.challengeId, instant };
  }, TX_OPTS);

  if ("error" in result) {
    await writeAuditSafe({
      ...auditBase,
      action: "PAYMENT_CONFIRM_FAILED",
      outcome: "FAILURE",
      meta: { error: result.error },
    });
  }

  return result;
}

export async function flushPaymentAlerts(alerts: NotifyOpts[]): Promise<void> {
  for (const a of alerts) await notify(a);
}

export type SubmitTxOutcome = { ok: true; paymentId: string } | { error: string };

/**
 * Records the trader-submitted transaction hash on a payment.
 *
 * Integrity:
 * - only the payment's owner may submit (checked in the conditional WHERE),
 * - a CONFIRMED payment can never be flipped back to PENDING (check happens
 *   atomically inside the UPDATE, not as a separate read),
 * - duplicate txHash across payments is rejected by the unique constraint —
 *   concurrent double-submits resolve to exactly one success, one friendly
 *   error (no 500).
 */
export async function submitPaymentTxCore(opts: {
  paymentId: string;
  userId: string;
  txHash: string;
  network: "TRC20" | "ERC20";
}): Promise<SubmitTxOutcome> {
  const { paymentId, userId, txHash, network } = opts;

  const dup = await db.payment.findUnique({ where: { txHash } });
  if (dup) return { error: "This transaction hash was already submitted" };

  try {
    const updated = await db.payment.updateMany({
      where: {
        id: paymentId,
        userId,
        status: { not: "CONFIRMED" },
      },
      data: {
        txHash,
        method: `USDT_${network}`,
        status: "PENDING",
      },
    });
    if (updated.count === 0) {
      const fresh = await db.payment.findUnique({ where: { id: paymentId } });
      if (!fresh || fresh.userId !== userId)
        return { error: "Payment not found" };
      return { error: "Payment already confirmed" };
    }
  } catch (e) {
    // Unique txHash race: another payment claimed this hash concurrently.
    if ((e as { code?: string }).code === "P2002")
      return { error: "This transaction hash was already submitted" };
    throw e;
  }

  return { ok: true, paymentId };
}
