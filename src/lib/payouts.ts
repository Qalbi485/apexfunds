import { db, TX_OPTS } from "./db";
import { SITE } from "./config";
import { round2 } from "./rules";
import type { NotifyOpts } from "./notify";
import { writeAudit, writeAuditSafe } from "./audit";
import type { Actor } from "./payments";

/**
 * Accounting model (Phase A):
 * - currentBalance = trading balance = start ± realized trading P&L only.
 *   Payouts never modify it, so risk rules (daily loss / drawdown) measure
 *   genuine trading performance only — no phantom drawdown after a payout.
 * - paidWithdrawals = cumulative PAID payouts (trader-side).
 * - equity = currentBalance − paidWithdrawals.
 * - trader profit share = payoutSplitPct% of max(0, currentBalance − startBalance).
 * - available to request now = share − paidWithdrawals − outstanding
 *   (outstanding = sum of REQUESTED + APPROVED payouts).
 * - When a payout of X is PAID: paidWithdrawals += X, profitConsumed =
 *   X / traderShare, firmAmount = profitConsumed × firmShare. The firm's
 *   20% stays in the account as trading cushion (trading can lose into it).
 */

export function traderShareRatio(): number {
  return SITE.payoutSplitPct / 100;
}

export function firmShareRatio(): number {
  return 1 - traderShareRatio();
}

/** Total trader-side profit share earned so far (0 if in drawdown). */
export function traderProfitShare(currentBalance: number, startBalance: number): number {
  const profit = Math.max(0, round2(currentBalance - startBalance));
  return round2(profit * traderShareRatio());
}

/** Eligible profit not yet consumed by any payout (ignores outstanding). */
export function eligibleAfterPaid(
  currentBalance: number,
  startBalance: number,
  paidWithdrawals: number
): number {
  return Math.max(0, round2(traderProfitShare(currentBalance, startBalance) - paidWithdrawals));
}

async function outstandingFor(challengeId: string, client = db): Promise<number> {
  const agg = await client.payout.aggregate({
    where: { challengeId, status: { in: ["REQUESTED", "APPROVED"] } },
    _sum: { amount: true },
  });
  return round2(agg._sum.amount ?? 0);
}

async function kycGateEnabled(): Promise<boolean> {
  const s = await db.setting.findUnique({ where: { key: SITE.kycSettingKey } });
  if (s) return s.value === "true";
  return SITE.kycRequiredBeforePayout;
}

export type PayoutOutcome =
  | { ok: true; payoutId: string; alerts: NotifyOpts[]; amount: number }
  | { error: string };

/**
 * Trader payout request with integrity gates:
 * - strictly status === "FUNDED" (FAILED/BREACHED never qualify; the old
 *   `|| phase === "FUNDED"` loophole is closed),
 * - amount ≤ share − paid − outstanding (re-checked atomically inside the
 *   creation transaction so concurrent requests cannot oversubscribe),
 * - optional KYC gate (Setting key overridable),
 * - payout schedule (first payout delay + interval).
 */
export async function requestPayoutCore(opts: {
  userId: string;
  challengeId: string;
  amount: number;
  walletAddress: string;
  network: string;
  /** Tests can skip the schedule delay; production passes false/undefined. */
  skipScheduleCheck?: boolean;
  actor?: Actor;
}): Promise<PayoutOutcome> {
  const { userId, challengeId, amount, walletAddress, network } = opts;

  if (!Number.isFinite(amount) || amount < SITE.minPayout)
    return { error: `Minimum payout is $${SITE.minPayout}` };
  if (walletAddress.length < 10) return { error: "Invalid wallet address" };

  const challenge = await db.challenge.findUnique({ where: { id: challengeId } });
  if (!challenge || challenge.userId !== userId)
    return { error: "Challenge not found" };
  if (challenge.status !== "FUNDED")
    return { error: "Payouts are only available on active funded accounts" };

  if (await kycGateEnabled()) {
    const kyc = await db.kyc.findUnique({ where: { userId } });
    if (!kyc || kyc.status !== "APPROVED")
      return { error: "KYC verification is required before payouts" };
  }

  if (!opts.skipScheduleCheck) {
    const lastPayout = await db.payout.findFirst({
      where: { challengeId, status: { in: ["REQUESTED", "APPROVED", "PAID"] } },
      orderBy: { createdAt: "desc" },
    });
    if (lastPayout) {
      const nextEligible = new Date(
        lastPayout.createdAt.getTime() + SITE.payoutDaysInterval * 86400000
      );
      if (new Date() < nextEligible)
        return { error: `Next payout available after ${nextEligible.toLocaleDateString()}` };
    } else {
      const fundedAt = challenge.fundedAt ?? challenge.createdAt;
      const nextEligible = new Date(
        fundedAt.getTime() + SITE.firstPayoutDays * 86400000
      );
      if (new Date() < nextEligible)
        return { error: `First payout available after ${nextEligible.toLocaleDateString()}` };
    }
  }

  const share = traderProfitShare(challenge.currentBalance, challenge.startBalance);
  const outstanding = await outstandingFor(challengeId);
  const availableNow = Math.max(0, round2(share - challenge.paidWithdrawals - outstanding));
  if (amount > availableNow)
    return {
      error: `Amount exceeds available profit (share ${share.toFixed(2)} − paid ${challenge.paidWithdrawals.toFixed(2)} − outstanding ${outstanding.toFixed(2)} = ${availableNow.toFixed(2)})`,
    };

  const traderAmount = round2(amount);
  const profitConsumed = round2(traderAmount / traderShareRatio());
  const firmAmount = round2(profitConsumed * firmShareRatio());

  try {
    const payoutId = await db.$transaction(async (tx) => {
      // Write-first: creating the payout row acquires SQLite's write lock, so
      // the challenge state read below can never be stale relative to a
      // concurrent PAID payout or another request committing earlier.
      const created = await tx.payout.create({
        data: {
          userId,
          challengeId,
          amount: traderAmount,
          traderAmount,
          firmAmount,
          profitConsumed,
          walletAddress,
          network,
        },
      });

      // Authoritative in-tx re-validation against FRESH state (the pre-tx
      // reads above are only for fast, friendly error messages).
      const fresh = await tx.challenge.findUnique({ where: { id: challengeId } });
      if (!fresh || fresh.userId !== userId)
        throw new Error("CHALLENGE_NOT_FOUND");
      if (fresh.status !== "FUNDED") throw new Error("CHALLENGE_NOT_ELIGIBLE");

      const freshShare = traderProfitShare(fresh.currentBalance, fresh.startBalance);
      const agg = await tx.payout.aggregate({
        where: { challengeId, status: { in: ["REQUESTED", "APPROVED"] } },
        _sum: { amount: true },
      });
      const totalOutstanding = round2(agg._sum.amount ?? 0);
      if (
        totalOutstanding >
        round2(freshShare - fresh.paidWithdrawals) + 0.005
      )
        throw new Error("OUTSTANDING_EXCEEDED");
      // Worst-case equity gate: if every OPEN position lost its full stake
      // and every pending payout were paid, the account must not go below
      // zero (reservedExposure = sum of open stakes).
      const worstCaseEquity = round2(
        fresh.currentBalance -
          fresh.reservedExposure -
          fresh.paidWithdrawals -
          totalOutstanding
      );
      if (worstCaseEquity < -0.005)
        throw new Error("EQUITY_SHORTFALL");

      await writeAudit(tx, {
        actorId: opts.actor?.id ?? userId,
        actorEmail: opts.actor?.email ?? null,
        action: "PAYOUT_REQUESTED",
        entityType: "Payout",
        entityId: created.id,
        outcome: "SUCCESS",
        after: {
          amount: traderAmount,
          firmAmount,
          profitConsumed,
          network,
          status: "REQUESTED",
        },
      });
      return created.id;
    }, TX_OPTS);

    const alerts: NotifyOpts[] = [
      {
        userId,
        type: "PAYOUT",
        title: "Payout requested",
        body: `Your $${traderAmount.toFixed(2)} payout request is being reviewed.`,
        emailSubject: "Payout request received",
        adminAlert: `🔔 <b>Payout requested</b>\n$${traderAmount} • ${network}\nWallet: ${walletAddress.slice(0, 16)}...\nFirm share this payout: $${firmAmount}\nReview in admin → Payouts`,
      },
    ];

    return { ok: true, payoutId, alerts, amount: traderAmount };
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "OUTSTANDING_EXCEEDED")
      return { error: "Amount exceeds available profit (concurrent requests)" };
    if (msg === "EQUITY_SHORTFALL")
      return {
        error:
          "Payout blocked: open positions would put the account below zero",
      };
    if (msg === "CHALLENGE_NOT_FOUND") return { error: "Challenge not found" };
    if (msg === "CHALLENGE_NOT_ELIGIBLE")
      return { error: "Payouts are only available on active funded accounts" };
    throw e;
  }
}

export type ProcessPayoutOutcome =
  | { ok: true; payoutId: string; alerts: NotifyOpts[]; amount: number }
  | { error: string; payoutId: string };

/**
 * Admin payout state machine with conditional claims so concurrent
 * processing cannot double-pay. On PAID: paidWithdrawals += amount
 * (currentBalance untouched — no phantom drawdown).
 */
export async function processPayoutCore(
  payoutId: string,
  action: "APPROVED" | "PAID" | "REJECTED",
  actor?: Actor
): Promise<ProcessPayoutOutcome> {
  const payout = await db.payout.findUnique({ where: { id: payoutId } });
  if (!payout) return { error: "Payout not found", payoutId };

  const actionName =
    action === "APPROVED"
      ? "PAYOUT_APPROVED"
      : action === "PAID"
        ? "PAYOUT_PAID"
        : "PAYOUT_REJECTED";

  let result: { ok: true } | { error: string };
  try {
    result = await db.$transaction(
      async (tx): Promise<{ ok: true } | { error: string }> => {
    // Conditional claims encode the legal state machine:
    // REQUESTED → APPROVED | REJECTED; APPROVED → PAID | REJECTED.
    let claimed = 0;
    if (action === "APPROVED") {
      claimed = (
        await tx.payout.updateMany({
          where: { id: payoutId, status: "REQUESTED" },
          data: { status: "APPROVED" },
        })
      ).count;
    } else if (action === "PAID") {
      claimed = (
        await tx.payout.updateMany({
          where: { id: payoutId, status: "APPROVED" },
          data: { status: "PAID", processedAt: new Date() },
        })
      ).count;
      if (claimed > 0) {
        // Equity re-validation (write-first, so this read is fresh): after
        // this payout the account must still cover open exposure. Prevents
        // paying out profit that concurrent trades have already lost between
        // REQUEST and PAID. Throw → the PAID claim rolls back.
        const ch = await tx.challenge.findUnique({
          where: { id: payout.challengeId },
        });
        const equityAfter = ch
          ? round2(
              ch.currentBalance -
                ch.reservedExposure -
                (ch.paidWithdrawals + payout.amount)
            )
          : -1;
        if (!ch || equityAfter < -0.005)
          throw new Error("EQUITY_SHORTFALL");
        // Ledger: consume trader profit; never touch the trading balance.
        await tx.challenge.update({
          where: { id: payout.challengeId },
          data: { paidWithdrawals: { increment: payout.amount } },
        });
      }
    } else {
      claimed = (
        await tx.payout.updateMany({
          where: { id: payoutId, status: { in: ["REQUESTED", "APPROVED"] } },
          data: { status: "REJECTED", processedAt: new Date() },
        })
      ).count;
    }
    if (claimed === 0) {
      await writeAudit(tx, {
        actorId: actor?.id ?? null,
        actorEmail: actor?.email ?? null,
        action: `${actionName}_FAILED`,
        entityType: "Payout",
        entityId: payoutId,
        outcome: "FAILURE",
        meta: { reason: "invalid_state_transition", attempted: action },
      });
      const fresh = await tx.payout.findUnique({ where: { id: payoutId } });
      if (action === "PAID" && fresh?.status === "PAID")
        return { error: "Already processed" } as const;
      if (action === "APPROVED" && fresh?.status === "APPROVED")
        return { error: "Already approved" } as const;
      return { error: "Already processed" } as const;
    }
    // Atomic financial audit: same transaction as the state change.
    await writeAudit(tx, {
      actorId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      action: actionName,
      entityType: "Payout",
      entityId: payoutId,
      outcome: "SUCCESS",
      before: { status: action === "PAID" ? "APPROVED" : "REQUESTED" },
      after: { status: action, amount: payout.amount },
      meta:
        action === "PAID"
          ? { paidWithdrawalsIncrement: payout.amount, firmAmount: payout.firmAmount }
          : undefined,
    });
    return { ok: true as const };
  }, TX_OPTS);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "EQUITY_SHORTFALL") {
      await writeAuditSafe({
        actorId: actor?.id ?? null,
        actorEmail: actor?.email ?? null,
        action: `${actionName}_FAILED`,
        entityType: "Payout",
        entityId: payoutId,
        outcome: "FAILURE",
        meta: { reason: "equity_shortfall_after_open_exposure" },
      });
      return {
        error:
          "Payout blocked: open positions / recent losses no longer cover this amount",
        payoutId,
      };
    }
    throw e;
  }

  if ("error" in result) {
    await writeAuditSafe({
      actorId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      action: `${actionName}_FAILED`,
      entityType: "Payout",
      entityId: payoutId,
      outcome: "FAILURE",
      meta: { error: result.error },
    });
    return { error: result.error, payoutId };
  }

  const payoutTitle =
    action === "PAID"
      ? "Payout sent 💰"
      : action === "APPROVED"
        ? "Payout approved"
        : "Payout rejected";

  const alerts: NotifyOpts[] = [
    {
      userId: payout.userId,
      type: "PAYOUT",
      title: payoutTitle,
      body:
        action === "PAID"
          ? `$${payout.amount.toFixed(2)} has been sent to your wallet.`
          : action === "APPROVED"
            ? `Your $${payout.amount.toFixed(2)} payout is approved and will be sent shortly.`
            : `Your payout was rejected.${payout.note ? " Reason: " + payout.note : ""}`,
      emailSubject: payoutTitle,
      adminAlert:
        action === "PAID"
          ? `💸 <b>Payout sent</b>\n$${payout.amount} → ${payout.walletAddress.slice(0, 10)}...`
          : action === "APPROVED"
            ? `✅ <b>Payout approved</b>\n$${payout.amount}`
            : `❌ <b>Payout rejected</b>\n$${payout.amount}`,
    },
  ];

  return { ok: true, payoutId, alerts, amount: payout.amount };
}
