import type { Prisma } from "@/generated/prisma/client";
import { db, TX_OPTS } from "./db";
import {
  applyTrade,
  dayKey,
  getPhaseConfig,
  nextPhase,
  parsePhases,
  round2,
  type ChallengeState,
  type TradeInput,
} from "./rules";
import { priceAt, SYMBOLS, isLiveSymbol, marketOpenFor } from "./market";
import { notify, type NotifyOpts } from "./notify";
import { SITE } from "./config";

export type DbClient = Prisma.TransactionClient | typeof db;

export async function loadChallengeState(challengeId: string, client: DbClient = db) {
  const challenge = await client.challenge.findUnique({
    where: { id: challengeId },
    include: { package: true },
  });
  if (!challenge) return null;
  const phases = parsePhases(challenge.package.phasesJson);
  const state: ChallengeState = {
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
  };
  return { challenge, phases, state };
}

export type ApplyOutcome = {
  status: string;
  phase: string;
  currentBalance: number;
  breachReason: string | null;
  events: string[];
  phasePassed: boolean;
  funded: boolean;
  ignored?: boolean;
  /** Side-effect notifications; callers must flush AFTER the DB transaction commits. */
  alerts: NotifyOpts[];
};

export async function flushAlerts(alerts: NotifyOpts[]): Promise<void> {
  for (const a of alerts) await notify(a);
}

/**
 * Applies one closed trade's P&L to a challenge and advances breach/phase
 * state. Pass `client` (a Prisma transaction client) to make the whole
 * application atomic with an enclosing settlement/sync transaction.
 *
 * Integrity rules:
 * - Only ACTIVE / FUNDED challenges accept trades (enforced in applyTrade
 *   and again here before any write).
 * - Phase transitions only run when the challenge is ACTIVE and in an
 *   evaluation phase; FUNDED accounts are never reset or downgraded.
 */
export async function applyClosedTradeToChallenge(
  challengeId: string,
  t: TradeInput,
  client: DbClient = db
): Promise<ApplyOutcome | { error: string }> {
  const loaded = await loadChallengeState(challengeId, client);
  if (!loaded) return { error: "Challenge not found" };
  const { challenge, phases } = loaded;
  let state = loaded.state;

  if (challenge.status !== "ACTIVE" && challenge.status !== "FUNDED") {
    return {
      status: challenge.status,
      phase: challenge.phase,
      currentBalance: challenge.currentBalance,
      breachReason: challenge.breachReason,
      events: [`Ignored: challenge status ${challenge.status}`],
      phasePassed: false,
      funded: false,
      ignored: true,
      alerts: [],
    };
  }

  const config = getPhaseConfig(phases, state.phase);
  const result = applyTrade(state, config, t, challenge.consistencyPct);
  state = result.state;

  if (result.events.some((e) => e.type === "TRADE_IGNORED")) {
    return {
      status: challenge.status,
      phase: challenge.phase,
      currentBalance: challenge.currentBalance,
      breachReason: challenge.breachReason,
      events: ["Ignored: challenge not eligible for trades"],
      phasePassed: false,
      funded: false,
      ignored: true,
      alerts: [],
    };
  }

  const events: string[] = [];
  const alerts: NotifyOpts[] = [];
  let breachReason: string | null = null;
  let phasePassed = false;
  let funded = false;

  const breach = result.events.find(
    (e) => e.type === "BREACH_DAILY_LOSS" || e.type === "BREACH_TOTAL_DRAWDOWN"
  );
  const passed = result.events.find((e) => e.type === "PHASE_PASSED");

  if (breach) {
    breachReason =
      breach.type === "BREACH_DAILY_LOSS"
        ? `Daily loss limit breached (${(breach as { dailyLossPct: number }).dailyLossPct.toFixed(2)}%)`
        : `Max drawdown breached (${(breach as { drawdownPct: number }).drawdownPct.toFixed(2)}%)`;

    await client.challenge.update({
      where: { id: challengeId },
      data: {
        currentBalance: state.currentBalance,
        peakBalance: state.peakBalance,
        dailyStartBalance: state.dailyStartBalance,
        tradingDaysDone: state.tradingDaysDone,
        lastTradeDay: state.lastTradeDay,
        tradingDayKeys: state.tradingDayKeys,
        bestDayProfit: state.bestDayProfit,
        status: state.status,
        breachReason,
        failedAt: new Date(),
      },
    });

    const title =
      state.status === "BREACHED"
        ? "Funded account breached"
        : "Challenge failed";
    alerts.push({
      userId: challenge.userId,
      type: "BREACH",
      title,
      body: breachReason,
      emailSubject: `${title} — ${challenge.package.name}`,
      adminAlert: `🔴 <b>${title}</b>\n${breachReason}\nAccount: ${challenge.brokerAccountId}`,
    });
    events.push(breachReason);
  } else if (passed && challenge.status === "ACTIVE") {
    const nx = nextPhase(phases, state.phase);
    if (nx) {
      phasePassed = true;
      state.phase = nx.phase;
      state.status = "ACTIVE";
      state.startBalance = state.accountSize;
      state.currentBalance = state.accountSize;
      state.peakBalance = state.accountSize;
      state.dailyStartBalance = null;
      state.tradingDaysDone = 0;
      state.lastTradeDay = null;
      state.tradingDayKeys = "[]";
      state.bestDayProfit = 0;
      events.push(`Passed ${passed.phase} → ${nx.phase}`);
      await client.challenge.update({
        where: { id: challengeId },
        data: {
          phase: nx.phase,
          status: "ACTIVE",
          startBalance: state.accountSize,
          currentBalance: state.accountSize,
          peakBalance: state.accountSize,
          dailyStartBalance: null,
          tradingDaysDone: 0,
          lastTradeDay: null,
          tradingDayKeys: "[]",
          bestDayProfit: 0,
          profitTarget: round2(state.accountSize * (1 + nx.targetPct / 100)),
          maxDailyLoss: round2(
            (nx.maxDailyLossPct / 100) * state.accountSize
          ),
          maxTotalDrawdown: round2(
            (nx.maxTotalDrawdownPct / 100) * state.accountSize
          ),
          minTradingDays: nx.minTradingDays,
        },
      });
      alerts.push({
        userId: challenge.userId,
        type: "SYSTEM",
        title: "Phase passed 🎉",
        body: `You passed ${passed.phase}. ${nx.phase} is now active.`,
        emailSubject: `Phase passed — ${nx.phase}`,
        adminAlert: `✅ <b>Phase passed</b>\n${challenge.package.name}`,
      });
    } else {
      // Last evaluation phase completed → FUNDED. Never runs for accounts
      // that are already FUNDED (guard above) so FUNDED can't be "re-set".
      funded = true;
      state.status = "FUNDED";
      events.push("Challenge completed → FUNDED");
      await client.challenge.update({
        where: { id: challengeId },
        data: {
          currentBalance: state.currentBalance,
          peakBalance: state.peakBalance,
          dailyStartBalance: state.dailyStartBalance,
          tradingDaysDone: state.tradingDaysDone,
          lastTradeDay: state.lastTradeDay,
          bestDayProfit: state.bestDayProfit,
          status: "FUNDED",
          phase: "FUNDED",
          fundedAt: new Date(),
          profitTarget: 0,
        },
      });
      alerts.push({
        userId: challenge.userId,
        type: "SYSTEM",
        title: "You are funded! 🎉",
        body: "All phases completed. Your funded account is live.",
        emailSubject: "You are FUNDED! 🎉",
        adminAlert: `🏆 <b>TRADER FUNDED</b>\n${challenge.package.name}`,
      });
    }
  } else {
    const consistencyBlock = result.events.find(
      (e) => e.type === "CONSISTENCY_WARNING"
    );
    const minDaysBlock = result.events.find(
      (e) => e.type === "MIN_DAYS_PENDING"
    );
    if (consistencyBlock) {
      events.push(
        `Target hit but consistency active (${(consistencyBlock as { bestDayPct: number }).bestDayPct.toFixed(1)}% > ${(consistencyBlock as { allowedPct: number }).allowedPct}%)`
      );
    }
    if (minDaysBlock) {
      events.push(
        `Target hit, need more days (${(minDaysBlock as { daysDone: number }).daysDone}/${(minDaysBlock as { daysRequired: number }).daysRequired})`
      );
    }
    await client.challenge.update({
      where: { id: challengeId },
      data: {
        currentBalance: state.currentBalance,
        peakBalance: state.peakBalance,
        dailyStartBalance: state.dailyStartBalance,
        tradingDaysDone: state.tradingDaysDone,
        lastTradeDay: state.lastTradeDay,
        tradingDayKeys: state.tradingDayKeys,
        bestDayProfit: state.bestDayProfit,
      },
    });
  }

  const fresh = await client.challenge.findUnique({ where: { id: challengeId } });
  return {
    status: fresh?.status || state.status,
    phase: fresh?.phase || state.phase,
    currentBalance: fresh?.currentBalance ?? state.currentBalance,
    breachReason: fresh?.breachReason ?? breachReason,
    events,
    phasePassed,
    funded,
    alerts,
  };
}

export type OpenTradeResult = { ok: true; tradeId: string } | { error: string };

/**
 * Opens a terminal trade with atomic exposure reservation:
 * available = currentBalance − paidWithdrawals − reservedExposure.
 * The reservation is incremented only if it fits both the available-funds
 * rule and the maxOpenExposurePct cap, evaluated atomically in the DB.
 */
export async function openTerminalTrade(opts: {
  userId: string;
  challengeId: string;
  symbol: string;
  direction: "UP" | "DOWN";
  stake: number;
  durationSec: number;
}): Promise<OpenTradeResult> {
  const { userId, challengeId, symbol, direction, stake, durationSec } = opts;

  if (!SYMBOLS[symbol]) return { error: "Unknown symbol" };
  if (!["UP", "DOWN"].includes(direction)) return { error: "Invalid direction" };
  if (!Number.isFinite(stake) || stake < 1) return { error: "Min stake is $1" };
  if (![30, 60, 120, 300].includes(durationSec))
    return { error: "Invalid duration" };

  const now = Date.now();
  const entry = priceAt(symbol, now);
  const payoutPct = SYMBOLS[symbol].payout;

  const result = await db.$transaction(async (tx) => {
    const challenge = await tx.challenge.findUnique({
      where: { id: challengeId },
    });
    if (!challenge || challenge.userId !== userId)
      return { error: "Challenge not found" } as OpenTradeResult;
    if (!["ACTIVE", "FUNDED"].includes(challenge.status))
      return { error: "Challenge is not active" } as OpenTradeResult;

    // Hard rule: inactivity — an untouched account busts after N days.
    const lastTrade = await tx.trade.findFirst({
      where: { challengeId },
      orderBy: { openedAt: "desc" },
      select: { openedAt: true },
    });
    if (lastTrade) {
      const ageDays = (now - lastTrade.openedAt.getTime()) / 86_400_000;
      if (ageDays > SITE.inactiveDaysToFail) {
        const reason = `No trades for ${Math.floor(ageDays)} days (limit ${SITE.inactiveDaysToFail})`;
        await tx.challenge.update({
          where: { id: challengeId },
          data: {
            status: challenge.status === "FUNDED" ? "BREACHED" : "FAILED",
            breachReason: reason,
          },
        });
        return {
          error: `Account breached — ${reason}`,
        } as OpenTradeResult;
      }
    }

    // Hard rule: single-trade stake cap (% of balance) — blocks all-in bets.
    const stakeCap = round2(
      (challenge.currentBalance * SITE.maxStakePct) / 100
    );
    if (stake > stakeCap)
      return {
        error: `Max single stake is ${SITE.maxStakePct}% of balance ($${stakeCap.toFixed(2)}) — hard rule`,
      } as OpenTradeResult;

    // Hard rule: trailing drawdown floor. Settlement normally marks the
    // breach; this additionally locks opening while already below the floor.
    if (SITE.trailingDrawdown && challenge.startBalance > 0 && challenge.peakBalance > 0) {
      const floor =
        challenge.peakBalance *
        (1 - challenge.maxTotalDrawdown / challenge.startBalance);
      if (challenge.currentBalance < floor)
        return {
          error: `Trailing drawdown from peak breached (balance ${challenge.currentBalance.toFixed(2)} < floor ${floor.toFixed(2)}) — trading locked`,
        } as OpenTradeResult;
    }

    // Hard rule: daily trade cap (anti-overtrading).
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const todayCount = await tx.trade.count({
      where: { challengeId, openedAt: { gte: dayStart } },
    });
    if (todayCount >= SITE.maxTradesPerDay)
      return {
        error: `Daily trade limit reached (${SITE.maxTradesPerDay} trades/day) — hard rule`,
      } as OpenTradeResult;

    const available = round2(
      challenge.currentBalance -
        challenge.paidWithdrawals -
        challenge.reservedExposure
    );
    if (stake > available)
      return {
        error: `Insufficient available funds (available ${available.toFixed(2)})`,
      } as OpenTradeResult;

    // Atomic conditional reservation: a single UPDATE evaluates BOTH the
    // available-funds rule (currentBalance − paidWithdrawals − reservedExposure
    // ≥ stake) and the open-exposure cap against the live row, so a concurrent
    // PAID payout or another order can never be raced past either check.
    // (The pre-checks above only produce friendly messages.)
    const claimed = await tx.$executeRaw`
      UPDATE Challenge
      SET reservedExposure = reservedExposure + ${stake}
      WHERE id = ${challengeId}
        AND status IN ('ACTIVE', 'FUNDED')
        AND currentBalance - paidWithdrawals - reservedExposure >= ${stake}
        AND reservedExposure <= (currentBalance * ${SITE.maxOpenExposurePct} / 100.0) - ${stake}`;
    if (claimed === 0)
      return {
        error: `Insufficient available funds or open-exposure cap (${SITE.maxOpenExposurePct}% of balance)`,
      } as OpenTradeResult;

    const trade = await tx.trade.create({
      data: {
        challengeId,
        brokerTradeId: `term_${now}_${Math.random().toString(36).slice(2, 8)}`,
        symbol,
        direction,
        stake,
        status: "OPEN",
        entryPrice: entry,
        payoutPct,
        expiryAt: new Date(now + durationSec * 1000),
        openedAt: new Date(now),
        closedAt: new Date(now + durationSec * 1000),
        profit: 0,
      },
    });
    return { ok: true as const, tradeId: trade.id };
  }, TX_OPTS);

  return result;
}

export type SettleResult =
  | {
      ok: true;
      tradeId: string;
      profit: number;
      won: boolean | null;
      closePrice: number;
      challenge: {
        currentBalance: number;
        paidWithdrawals: number;
        reservedExposure: number;
        available: number;
        status: string;
        phase: string;
        breachReason: string | null;
      };
      events: string[];
    }
  | { error: string };

/**
 * Settles an expired OPEN trade exactly once by tradeId (core execution).
 *
 * Atomicity: a conditional OPEN→CLOSED claim (updateMany with status + expiry
 * filters) inside a transaction guarantees that of N concurrent requests only
 * one applies P&L, releases the exposure reservation, and runs the risk
 * engine. The economic close time (expiryAt) — not the HTTP arrival time —
 * determines the trading day.
 */
export async function settleTradeRecordCore(tradeId: string): Promise<SettleResult> {
  const pre = await db.trade.findUnique({
    where: { id: tradeId },
    include: { challenge: true },
  });
  if (!pre) return { error: "Trade not found" };
  if (pre.status === "CLOSED") return { error: "Already settled" };
  if (!pre.expiryAt || Date.now() < pre.expiryAt.getTime())
    return { error: "Trade not expired yet" };

  const expiry = pre.expiryAt;
  const close = priceAt(pre.symbol, expiry.getTime());
  const entry = pre.entryPrice ?? close;

  // A live (real-market) pair whose whole trade window fell inside the
  // closed-market session had a frozen price — no real movement could happen,
  // so the trade is voided and the stake refunded instead of a random win/loss.
  // Crypto (24/7) never freezes, so its trades are never voided.
  const frozen =
    isLiveSymbol(pre.symbol) &&
    !marketOpenFor(pre.symbol, pre.openedAt.getTime()) &&
    !marketOpenFor(pre.symbol, expiry.getTime());

  let won: boolean | null = null;
  let profit = 0;
  if (!frozen) {
    if (close > entry) won = pre.direction === "UP";
    else if (close < entry) won = pre.direction === "DOWN";
    else won = null;

    if (won === true) profit = round2(pre.stake * ((pre.payoutPct ?? 85) / 100));
    else if (won === false) profit = -pre.stake;
    else profit = 0;
  }

  const settledAt = new Date();

  const outcome = await db.$transaction(async (tx) => {
    // Conditional claim: only one caller can transition OPEN → CLOSED.
    const claimed = await tx.trade.updateMany({
      where: {
        id: tradeId,
        status: "OPEN",
        expiryAt: { lte: settledAt },
      },
      data: {
        status: "CLOSED",
        closePrice: close,
        profit,
        closedAt: expiry, // economic close drives trading-day attribution
        settledAt,
      },
    });
    if (claimed.count === 0) return null;

    // Release the exposure reservation exactly once (claim above guarantees
    // this code runs at most once per trade). Guarded against negatives.
    await tx.challenge.updateMany({
      where: { id: pre.challengeId, reservedExposure: { gte: pre.stake } },
      data: { reservedExposure: { decrement: pre.stake } },
    });

    const applied = await applyClosedTradeToChallenge(
      pre.challengeId,
      {
        brokerTradeId: pre.brokerTradeId,
        symbol: pre.symbol,
        direction: pre.direction,
        stake: pre.stake,
        payout: won === true ? pre.stake + profit : 0,
        profit,
        openedAt: pre.openedAt,
        closedAt: expiry,
      },
      tx
    );
    if ("error" in applied) throw new Error(applied.error);
    return applied;
  }, TX_OPTS);

  if (!outcome) {
    const fresh = await db.trade.findUnique({ where: { id: tradeId } });
    return {
      error:
        fresh?.status === "CLOSED" ? "Already settled" : "Trade not expired yet",
    };
  }

  await flushAlerts(outcome.alerts);

  const fresh = await db.challenge.findUnique({ where: { id: pre.challengeId } });

  return {
    ok: true,
    tradeId,
    profit,
    won,
    closePrice: close,
    challenge: {
      currentBalance: fresh?.currentBalance ?? outcome.currentBalance,
      paidWithdrawals: fresh?.paidWithdrawals ?? 0,
      reservedExposure: fresh?.reservedExposure ?? 0,
      available:
        fresh
          ? round2(fresh.currentBalance - fresh.paidWithdrawals - fresh.reservedExposure)
          : outcome.currentBalance,
      status: fresh?.status ?? outcome.status,
      phase: fresh?.phase ?? outcome.phase,
      breachReason: fresh?.breachReason ?? outcome.breachReason,
    },
    events: outcome.events,
  };
}

/**
 * Settles an expired OPEN trade with ownership validation.
 */
export async function settleTerminalTrade(
  userId: string,
  tradeId: string
): Promise<SettleResult> {
  const pre = await db.trade.findUnique({
    where: { id: tradeId },
    include: { challenge: true },
  });
  if (!pre || pre.challenge.userId !== userId)
    return { error: "Trade not found" };

  return settleTradeRecordCore(tradeId);
}

/**
 * Sweeps and settles all expired OPEN terminal trades across the entire system.
 * Designed for background workers and cron tasks so trades settle even when
 * the trader has closed their browser.
 */
export async function settleAllExpiredTerminalTrades(limit = 100): Promise<{
  settled: number;
  errors: string[];
}> {
  const now = new Date();
  const expired = await db.trade.findMany({
    where: {
      status: "OPEN",
      expiryAt: { lte: now },
    },
    select: { id: true },
    take: limit,
  });

  let settled = 0;
  const errors: string[] = [];
  for (const t of expired) {
    try {
      const res = await settleTradeRecordCore(t.id);
      if ("ok" in res) {
        settled++;
      } else {
        errors.push(`${t.id}: ${res.error}`);
      }
    } catch (e) {
      errors.push(`${t.id}: ${(e as Error).message}`);
    }
  }

  return { settled, errors };
}

export { dayKey };
