import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { StatCard } from "@/components/ui";
import { money } from "@/lib/utils";

export default async function AdminOverviewPage() {
  await requireAdmin();

  const [
    userCount,
    challengeCount,
    activeCount,
    fundedCount,
    pendingPayments,
    pendingPayouts,
    confirmedRevenue,
    totalPaidOut,
    pendingKyc,
    openTickets,
  ] = await Promise.all([
    db.user.count({ where: { role: "TRADER" } }),
    db.challenge.count(),
    db.challenge.count({ where: { status: "ACTIVE" } }),
    db.challenge.count({ where: { status: "FUNDED" } }),
    db.payment.count({ where: { status: "PENDING" } }),
    db.payout.count({ where: { status: "REQUESTED" } }),
    db.payment.aggregate({
      _sum: { amount: true },
      where: { status: "CONFIRMED" },
    }),
    db.payout.aggregate({ _sum: { amount: true }, where: { status: "PAID" } }),
    db.kyc.count({ where: { status: "PENDING" } }),
    db.supportTicket.count({ where: { status: { in: ["OPEN", "REPLIED"] } } }),
  ]);

  const revenue = confirmedRevenue._sum.amount || 0;
  const paidOut = totalPaidOut._sum.amount || 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Admin overview</h1>
        <p className="mt-1 text-sm text-slate-400">
          Business snapshot across all traders.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Traders" value={userCount} />
        <StatCard
          label="Challenges"
          value={challengeCount}
          sub={`${activeCount} active • ${fundedCount} funded`}
        />
        <StatCard label="Revenue (confirmed)" value={money(revenue)} />
        <StatCard
          label="Paid out"
          value={money(paidOut)}
          sub={`Net: ${money(revenue - paidOut)}`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Payments to confirm"
          value={pendingPayments}
          sub={pendingPayments > 0 ? "Action needed" : "All clear"}
        />
        <StatCard
          label="Payouts requested"
          value={pendingPayouts}
          sub={pendingPayouts > 0 ? "Action needed" : "All clear"}
        />
        <StatCard label="KYC pending" value={pendingKyc} />
        <StatCard label="Open tickets" value={openTickets} />
      </div>
    </div>
  );
}
