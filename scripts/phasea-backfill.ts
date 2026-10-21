import "dotenv/config";
import { db } from "../src/lib/db";
import { traderProfitShare } from "../src/lib/payouts";

/**
 * Phase A accounting backfill (idempotent):
 * 1. Legacy PAID payouts had their full amount deducted from currentBalance
 *    by the old processPayoutAction. Restore it and record the amount in
 *    paidWithdrawals so risk rules use the pure trading balance.
 * 2. Legacy REQUESTED/APPROVED payouts that exceed the new eligible profit
 *    (share − paid) are rejected with an explanatory note so they cannot
 *    block or exceed the new ledger.
 */
async function main() {
  const paidByChallenge = await db.payout.groupBy({
    by: ["challengeId"],
    where: { status: "PAID" },
    _sum: { amount: true },
  });

  for (const g of paidByChallenge) {
    const totalPaid = Math.round((g._sum.amount ?? 0) * 100) / 100;
    const ch = await db.challenge.findUnique({ where: { id: g.challengeId } });
    if (!ch) continue;
    if (ch.paidWithdrawals >= totalPaid - 0.005) {
      console.log(
        `skip ${ch.id}: paidWithdrawals=${ch.paidWithdrawals} already >= ${totalPaid}`
      );
      continue;
    }
    const delta = Math.round((totalPaid - ch.paidWithdrawals) * 100) / 100;
    await db.challenge.update({
      where: { id: ch.id },
      data: {
        currentBalance: { increment: delta },
        paidWithdrawals: totalPaid,
      },
    });
    console.log(
      `backfill ${ch.id}: restored currentBalance +${delta} → paidWithdrawals=${totalPaid}`
    );
  }

  const openRequests = await db.payout.findMany({
    where: { status: { in: ["REQUESTED", "APPROVED"] } },
    include: { challenge: true },
  });
  for (const p of openRequests) {
    const share = traderProfitShare(
      p.challenge.currentBalance,
      p.challenge.startBalance
    );
    if (p.amount > share - p.challenge.paidWithdrawals + 0.005) {
      await db.payout.update({
        where: { id: p.id },
        data: {
          status: "REJECTED",
          processedAt: new Date(),
          note: "Rejected by Phase A backfill: exceeds new eligible profit split (80% of trading profit minus paid withdrawals)",
        },
      });
      console.log(
        `reject ${p.id}: amount ${p.amount} > eligible ${share - p.challenge.paidWithdrawals}`
      );
    }
  }

  const summary = await db.challenge.findMany({
    select: {
      id: true,
      status: true,
      currentBalance: true,
      paidWithdrawals: true,
      startBalance: true,
    },
  });
  console.log("\nFinal challenges:");
  for (const c of summary) {
    console.log(
      `  ${c.id} ${c.status} bal=${c.currentBalance} paid=${c.paidWithdrawals} start=${c.startBalance}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
