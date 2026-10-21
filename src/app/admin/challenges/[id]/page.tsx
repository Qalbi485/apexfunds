import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { parsePhases, getPhaseConfig, progressMetrics } from "@/lib/rules";
import { SITE } from "@/lib/config";
import { money, dateTime } from "@/lib/utils";
import {
  statusBadge,
  Badge,
  ProgressBar,
  TableWrap,
  Th,
  Td,
} from "@/components/ui";
import { SyncButton } from "@/components/sync-button";

export default async function AdminChallengeDetail({
  params,
}: PageProps<"/admin/challenges/[id]">) {
  await requireAdmin();
  const { id } = await params;

  const challenge = await db.challenge.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, email: true, name: true } },
      package: true,
      trades: { orderBy: { closedAt: "desc" }, take: 100 },
    },
  });
  if (!challenge) notFound();

  const phases = parsePhases(challenge.package.phasesJson);
  const cfg = getPhaseConfig(phases, challenge.phase);
  const m = progressMetrics(
    {
      accountSize: challenge.accountSize,
      startBalance: challenge.startBalance,
      currentBalance: challenge.currentBalance,
      peakBalance: challenge.peakBalance,
      dailyStartBalance: challenge.dailyStartBalance,
      tradingDaysDone: challenge.tradingDaysDone,
      lastTradeDay: challenge.lastTradeDay,
      tradingDayKeys: challenge.tradingDayKeys,
      bestDayProfit: challenge.bestDayProfit,
      phase: challenge.phase,
      status: challenge.status,
    },
    cfg,
    challenge.consistencyPct
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/admin/challenges"
            className="text-sm text-slate-400 hover:text-white"
          >
            ← Challenges
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-white">
              {challenge.package.name}
            </h1>
            {statusBadge(challenge.status)}
            <Badge>{challenge.phase.replace("_", " ")}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {challenge.user.name} ({challenge.user.email}) • Broker acc:{" "}
            {challenge.brokerAccountId}
          </p>
        </div>
        {["ACTIVE", "FUNDED"].includes(challenge.status) && (
          <SyncButton challengeId={challenge.id} />
        )}
      </div>

      {challenge.breachReason && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
          <strong>Breach:</strong> {challenge.breachReason}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card">
          <p className="text-xs uppercase text-slate-400">Balance</p>
          <p className="mt-1 text-3xl font-bold text-white">
            {money(challenge.currentBalance)}
          </p>
          <p className="text-sm text-slate-500">
            Start {money(challenge.startBalance)} • Peak{" "}
            {money(challenge.peakBalance)}
          </p>
        </div>
        <div className="card space-y-3 lg:col-span-2">
          {cfg.targetPct > 0 && (
            <ProgressBar
              value={m.targetPctDone}
              label={`Target ${cfg.targetPct}%`}
              right={money(m.targetBalance)}
            />
          )}
          <ProgressBar
            value={m.dailyLossPctUsed}
            color="amber"
            label={`Daily loss ${cfg.maxDailyLossPct}%`}
            right={`${money(m.dailyLoss)} / ${money(m.dailyLimit)}`}
          />
          <ProgressBar
            value={m.drawdownPctUsed}
            color="cyan"
            label={`Drawdown ${cfg.maxTotalDrawdownPct}%${SITE.trailingDrawdown ? " (peak)" : ""}`}
            right={`${money(m.drawdownUsed)} / ${money(m.drawdownLimit)}`}
          />
          <p className="text-xs text-slate-500">
            Days {challenge.tradingDaysDone}/{cfg.minTradingDays} • Consistency{" "}
            {m.consistencyOk ? "OK" : `${m.bestDayPct.toFixed(0)}% day share`}{" "}
            • Started {dateTime(challenge.startedAt)} • Funded{" "}
            {dateTime(challenge.fundedAt)}
          </p>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">
          Trades ({challenge.trades.length})
        </h2>
        <TableWrap>
          <thead>
            <tr className="border-b border-slate-800">
              <Th>Time</Th>
              <Th>Symbol</Th>
              <Th>Dir</Th>
              <Th>Stake</Th>
              <Th>Profit</Th>
              <Th>Broker ID</Th>
            </tr>
          </thead>
          <tbody>
            {challenge.trades.map((t) => (
              <tr key={t.id} className="border-b border-slate-800/60">
                <Td className="whitespace-nowrap text-xs text-slate-400">
                  {dateTime(t.closedAt)}
                </Td>
                <Td>{t.symbol}</Td>
                <Td>
                  <Badge color={t.direction === "UP" ? "emerald" : "rose"}>
                    {t.direction}
                  </Badge>
                </Td>
                <Td className="font-mono">{money(t.stake)}</Td>
                <Td
                  className={`font-mono ${t.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                >
                  {t.profit >= 0 ? "+" : ""}
                  {money(t.profit)}
                </Td>
                <Td className="font-mono text-xs text-slate-500">
                  {t.brokerTradeId}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>
    </div>
  );
}
