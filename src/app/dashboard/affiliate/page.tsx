import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, dateTime } from "@/lib/utils";
import { StatCard, statusBadge, EmptyState } from "@/components/ui";
import { SITE } from "@/lib/config";

export default async function AffiliatePage() {
  const user = await requireUser();

  const [referrals, commissions, paidSum] = await Promise.all([
    db.user.findMany({
      where: { referredById: user.id },
      select: { id: true, email: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    db.commission.findMany({
      where: { referrerId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.commission.aggregate({
      _sum: { amount: true },
      where: { referrerId: user.id, status: "PAID" },
    }),
  ]);

  const pending = commissions
    .filter((c) => c.status === "PENDING")
    .reduce((a, c) => a + c.amount, 0);
  const link = `/register?ref=${user.referralCode}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Affiliate program</h1>
        <p className="mt-1 text-sm text-slate-400">
          Earn 10% of every challenge purchase made with your code. Commissions
          are added when payments are confirmed and paid with your payouts.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total referrals" value={referrals.length} />
        <StatCard label="Paid commissions" value={money(paidSum._sum.amount || 0)} />
        <StatCard label="Pending commissions" value={money(pending)} />
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold text-white">Your referral link</h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <code className="flex-1 overflow-x-auto rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 font-mono text-sm text-slate-300">
            {link || `/register?ref=${user.referralCode}`}
          </code>
          <code className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 font-mono text-sm text-blue-400">
            {user.referralCode}
          </code>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Share the link or just the code during registration.
        </p>
      </div>

      <div className="card p-0">
        {commissions.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No commissions yet"
              body="Share your referral link. Commissions appear when your referrals buy challenges."
            />
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="px-4 py-3 text-xs uppercase text-slate-400">Date</th>
                <th className="px-4 py-3 text-xs uppercase text-slate-400">Amount</th>
                <th className="px-4 py-3 text-xs uppercase text-slate-400">Status</th>
              </tr>
            </thead>
            <tbody>
              {commissions.map((c) => (
                <tr key={c.id} className="border-b border-slate-800/60">
                  <td className="px-4 py-3 text-slate-400">
                    {dateTime(c.createdAt)}
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold text-slate-200">
                    {money(c.amount)}
                  </td>
                  <td className="px-4 py-3">{statusBadge(c.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-slate-500">
        Self-referrals and fraudulent traffic result in account termination. {SITE.name} reserves the right to
        reverse unpaid commissions from fraudulent referrals.
      </p>
    </div>
  );
}
