import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { StatCard, statusBadge, EmptyState } from "@/components/ui";
import { money, dateTime } from "@/lib/utils";
import { SITE } from "@/lib/config";

export default async function DashboardPage() {
  const user = await requireUser();

  const [challenges, notifications, payouts, totalPayout] = await Promise.all([
    db.challenge.findMany({
      where: { userId: user.id },
      include: { package: true },
      orderBy: { createdAt: "desc" },
    }),
    db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    db.payout.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    db.payout.aggregate({
      _sum: { amount: true },
      where: { userId: user.id, status: "PAID" },
    }),
  ]);

  const active = challenges.filter((c) =>
    ["ACTIVE", "FUNDED"].includes(c.status)
  );
  const bestEquity = active.reduce(
    (acc, c) => acc + (c.currentBalance - c.startBalance),
    0
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">
          Welcome back, {user.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Here is your trading overview.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total challenges"
          value={challenges.length}
          sub={`${active.length} active`}
        />
        <StatCard
          label="Total payouts"
          value={money(totalPayout._sum.amount || 0)}
          sub="Lifetime paid"
        />
        <StatCard
          label="Open P&L (active)"
          value={money(bestEquity)}
          sub="Across active accounts"
        />
        <StatCard
          label="Profit split"
          value={`${SITE.payoutSplitPct}%`}
          sub="You keep the majority"
        />
      </div>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">My challenges</h2>
          <div className="flex gap-2">
            <Link href="/dashboard/trade" className="btn-primary">
              Open Terminal
            </Link>
            <Link href="/#challenges" className="btn-secondary">
              + Buy new challenge
            </Link>
          </div>
        </div>

        {challenges.length === 0 ? (
          <EmptyState
            title="No challenges yet"
            body="Pick a challenge above, prove your skills, and get funded."
            action={
              <Link href="/#challenges" className="btn-primary">
                View Challenges
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4">
            {challenges.map((c) => (
              <Link
                key={c.id}
                href={`/dashboard/challenges/${c.id}`}
                className="card flex flex-col gap-4 transition-colors hover:border-blue-500/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-white">
                      {c.package.name}
                    </p>
                    {statusBadge(c.status)}
                    <span className="text-xs text-slate-500">
                      {c.phase.replace("_", " ")}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">
                    Balance:{" "}
                    <span className="font-mono text-slate-200">
                      {money(c.currentBalance)}
                    </span>{" "}
                    / start {money(c.startBalance)}
                    {c.breachReason && (
                      <span className="ml-2 text-rose-400">
                        — {c.breachReason}
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-slate-100">
                    {c.currentBalance - c.startBalance >= 0 ? "+" : ""}
                    {money(c.currentBalance - c.startBalance)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {dateTime(c.updatedAt)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-white">
            Recent payouts
          </h2>
          {payouts.length === 0 ? (
            <div className="card text-sm text-slate-400">
              No payouts yet. Available on funded accounts after{" "}
              {SITE.firstPayoutDays} days.
            </div>
          ) : (
            <div className="card space-y-3 p-4">
              {payouts.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between text-sm"
                >
                  <div>
                    <p className="font-medium text-slate-200">
                      {money(p.amount)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {dateTime(p.createdAt)}
                    </p>
                  </div>
                  {statusBadge(p.status)}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-white">
            Notifications
          </h2>
          {notifications.length === 0 ? (
            <div className="card text-sm text-slate-400">All caught up.</div>
          ) : (
            <div className="card space-y-3 p-4">
              {notifications.map((n) => (
                <div key={n.id} className="border-b border-slate-800 pb-3 last:border-0 last:pb-0">
                  <p
                    className={`text-sm font-medium ${n.read ? "text-slate-400" : "text-slate-100"}`}
                  >
                    {n.title}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">{n.body}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
