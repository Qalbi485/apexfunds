import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  parsePhases,
  getPhaseConfig,
  progressMetrics,
} from "@/lib/rules";
import { SITE } from "@/lib/config";
import { money, dateTime } from "@/lib/utils";
import { fmtPrice } from "@/lib/market";
import { traderProfitShare } from "@/lib/payouts";
import {
  Badge,
  ProgressBar,
  statusBadge,
  TableWrap,
  Th,
  Td,
} from "@/components/ui";
import { SyncButton } from "@/components/sync-button";
import { PayoutForm } from "@/components/payout-form";

export default async function ChallengeDetailPage({
  params,
}: PageProps<"/dashboard/challenges/[id]">) {
  const { id } = await params;
  const user = await requireUser();

  const challenge = await db.challenge.findUnique({
    where: { id },
    include: { package: true, trades: { orderBy: { closedAt: "desc" }, take: 50 } },
  });
  if (!challenge || challenge.userId !== user.id) notFound();

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

  const isActive = ["ACTIVE", "FUNDED"].includes(challenge.status);
  const isFunded = challenge.status === "FUNDED";
  const wins = challenge.trades.filter((t) => t.profit > 0).length;
  const totalClosed = challenge.trades.length;

  const equity =
    Math.round((challenge.currentBalance - challenge.paidWithdrawals) * 100) / 100;
  const profitShare = traderProfitShare(
    challenge.currentBalance,
    challenge.startBalance
  );
  const outstandingAgg = await db.payout.aggregate({
    where: {
      challengeId: challenge.id,
      status: { in: ["REQUESTED", "APPROVED"] },
    },
    _sum: { amount: true },
  });
  const outstanding = Math.round((outstandingAgg._sum.amount ?? 0) * 100) / 100;
  const payoutAvailable = Math.max(
    0,
    Math.round((profitShare - challenge.paidWithdrawals - outstanding) * 100) / 100
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/dashboard"
            className="text-sm text-slate-400 hover:text-white"
          >
            ← Dashboard
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-white">
              {challenge.package.name}
            </h1>
            {statusBadge(challenge.status)}
            <Badge color={challenge.phase === "FUNDED" ? "cyan" : "slate"}>
              {challenge.phase.replace("_", " ")}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Account: {challenge.brokerAccountId} • Started:{" "}
            {dateTime(challenge.startedAt)}
          </p>
        </div>
        {isActive && <SyncButton challengeId={challenge.id} />}
      </div>

      {challenge.breachReason && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
          <strong>Account closed:</strong> {challenge.breachReason}
        </div>
      )}

      {/* BALANCE + METERS */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-1">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Current balance
          </p>
          <p className="mt-2 text-4xl font-bold text-white">
            {money(challenge.currentBalance)}
          </p>
          <p
            className={`mt-1 text-sm font-medium ${
              m.profit >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {m.profit >= 0 ? "+" : ""}
            {money(m.profit)} ({((m.profit / challenge.startBalance) * 100).toFixed(2)}
            %)
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Equity {money(equity)} • Payouts are free and never reduce
            drawdown limits
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-slate-500">Start balance</p>
              <p className="font-mono text-slate-200">
                {money(challenge.startBalance)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Peak balance</p>
              <p className="font-mono text-slate-200">
                {money(challenge.peakBalance)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Trading days</p>
              <p className="font-mono text-slate-200">
                {challenge.tradingDaysDone} /{" "}
                {cfg.minTradingDays || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Win rate (recent)</p>
              <p className="font-mono text-slate-200">
                {totalClosed > 0
                  ? `${((wins / totalClosed) * 100).toFixed(0)}%`
                  : "—"}
              </p>
            </div>
          </div>
        </div>

        <div className="card space-y-5 lg:col-span-2">
          {cfg.targetPct > 0 ? (
            <ProgressBar
              value={m.targetPctDone}
              color="emerald"
              label={`Profit target (${cfg.targetPct}%)`}
              right={`${money(challenge.currentBalance)} / ${money(m.targetBalance)}`}
            />
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-sm text-cyan-300">
              <span>Funded account — no target. Trade within the rules.</span>
              <Badge color="cyan">LIVE</Badge>
            </div>
          )}
          <ProgressBar
            value={m.dailyLossPctUsed}
            color={m.dailyLossPctUsed > 70 ? "rose" : "amber"}
            label={`Daily loss limit (${cfg.maxDailyLossPct}%)`}
            right={`${money(m.dailyLoss)} / ${money(m.dailyLimit)}`}
          />
          <ProgressBar
            value={m.drawdownPctUsed}
            color={m.drawdownPctUsed > 70 ? "rose" : "cyan"}
            label={`Max drawdown (${cfg.maxTotalDrawdownPct}%${SITE.trailingDrawdown ? " from peak" : ""})`}
            right={`${money(m.drawdownUsed)} / ${money(m.drawdownLimit)}`}
          />
          {!m.consistencyOk && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-400">
              Consistency rule active: your best day is{" "}
              {m.bestDayPct.toFixed(1)}% of total profit (max allowed{" "}
              {m.consistencyPct}%). Add more trading days before the target
              counts.
            </div>
          )}
          <p className="text-xs text-slate-500">
            All limits are enforced automatically on closed trades. Breaches
            close the account immediately.
          </p>
        </div>
      </div>

      {/* PAYOUT (funded only) */}
      {isFunded && challenge.status === "FUNDED" && (
        <div className="card">
          <h2 className="text-lg font-semibold text-white">Request payout</h2>
          <p className="mt-1 text-sm text-slate-400">
            Keep {SITE.payoutSplitPct}% of profits. First payout after{" "}
            {SITE.firstPayoutDays} days, then every {SITE.payoutDaysInterval}{" "}
            days. Minimum ${SITE.minPayout}.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            KYC approved account required. Requests are processed within{" "}
            {SITE.payoutProcessingHours} hours of approval.
          </p>
          <div className="mt-4 max-w-md">
            <PayoutForm
              challengeId={challenge.id}
              available={payoutAvailable}
            />
          </div>
        </div>
      )}

      {/* TRADES */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">
          Trade history{" "}
          <span className="text-sm font-normal text-slate-500">
            (last {challenge.trades.length})
          </span>
        </h2>
        {challenge.trades.length === 0 ? (
          <div className="card text-sm text-slate-400">
            No trades synced yet. Click &quot;Sync trades&quot; after trading,
            or trades will appear automatically on the next sync.
          </div>
        ) : (
          <TableWrap>
            <thead>
              <tr className="border-b border-slate-800">
                <Th>Time</Th>
                <Th>Symbol</Th>
                <Th>Dir</Th>
                <Th>Stake</Th>
                <Th>Entry</Th>
                <Th>Close</Th>
                <Th>Payout</Th>
                <Th>Profit</Th>
              </tr>
            </thead>
            <tbody>
              {challenge.trades.map((t) => (
                <tr key={t.id} className="border-b border-slate-800/60">
                  <Td className="whitespace-nowrap text-xs text-slate-400">
                    {dateTime(t.closedAt)}
                  </Td>
                  <Td className="font-medium">{t.symbol}</Td>
                  <Td>
                    <Badge color={t.direction === "UP" ? "emerald" : "rose"}>
                      {t.direction}
                    </Badge>
                  </Td>
                  <Td className="font-mono">{money(t.stake)}</Td>
                  <Td className="font-mono text-xs text-slate-300">
                    {t.entryPrice != null ? fmtPrice(t.symbol, t.entryPrice) : "—"}
                  </Td>
                  <Td className="font-mono text-xs text-slate-300">
                    {t.closePrice != null ? fmtPrice(t.symbol, t.closePrice) : "—"}
                  </Td>
                  <Td className="font-mono">{money(t.payout || 0)}</Td>
                  <Td
                    className={`font-mono font-semibold ${
                      t.profit >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {t.profit >= 0 ? "+" : ""}
                    {money(t.profit)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </section>
    </div>
  );
}
