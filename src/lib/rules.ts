import { SITE, type PhaseConfig } from "./config";

export type TradeInput = {
  brokerTradeId: string;
  symbol: string;
  direction: string;
  stake: number;
  payout: number | null;
  profit: number;
  openedAt: Date;
  closedAt: Date;
};

export type ChallengeState = {
  accountSize: number;
  startBalance: number;
  currentBalance: number;
  peakBalance: number;
  dailyStartBalance: number | null;
  tradingDaysDone: number;
  lastTradeDay: string | null;
  tradingDayKeys: string; // JSON array of counted UTC day keys
  bestDayProfit: number;
  phase: string;
  status: string;
};

export type RuleEvent =
  | { type: "TRADE_APPLIED"; profit: number }
  | { type: "TRADE_IGNORED"; reason: string }
  | { type: "NEW_TRADING_DAY"; day: string }
  | { type: "BREACH_DAILY_LOSS"; dailyLossPct: number }
  | { type: "BREACH_TOTAL_DRAWDOWN"; drawdownPct: number }
  | { type: "PHASE_PASSED"; phase: string }
  | { type: "CONSISTENCY_WARNING"; bestDayPct: number; allowedPct: number }
  | { type: "MIN_DAYS_PENDING"; daysDone: number; daysRequired: number }
  | { type: "FUNDED" };

export type ApplyResult = {
  state: ChallengeState;
  events: RuleEvent[];
};

export function parsePhases(phasesJson: string): PhaseConfig[] {
  try {
    const parsed = JSON.parse(phasesJson);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  throw new Error("Invalid phasesJson on package");
}

export function getPhaseConfig(
  phases: PhaseConfig[],
  phase: string
): PhaseConfig {
  const found = phases.find((p) => p.phase === phase);
  if (found) return found;
  return phases[phases.length - 1];
}

export function nextPhase(
  phases: PhaseConfig[],
  phase: string
): PhaseConfig | null {
  const idx = phases.findIndex((p) => p.phase === phase);
  if (idx === -1 || idx === phases.length - 1) return null;
  return phases[idx + 1];
}

// Trading-day boundary: UTC calendar day (ISO date of the trade's economic
// close time — expiryAt for terminal trades, broker closedAt for synced trades).
// Chosen deliberately: server-authoritative, timezone-independent, and not
// affected by when the HTTP settlement request happened to arrive.
export const TRADING_TIMEZONE = "UTC" as const;

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function applyTrade(
  state: ChallengeState,
  cfg: PhaseConfig,
  trade: TradeInput,
  consistencyPct: number
): ApplyResult {
  const events: RuleEvent[] = [];
  const s: ChallengeState = { ...state };

  // Integrity guard: closed trades may only ever affect ACTIVE (evaluation)
  // or FUNDED accounts. FAILED / BREACHED / PENDING_PAYMENT challenges are
  // terminal for trading purposes and can never be revived by late trades,
  // broker re-syncs, or settlement arriving after a breach.
  if (s.status !== "ACTIVE" && s.status !== "FUNDED") {
    events.push({
      type: "TRADE_IGNORED",
      reason: `Challenge status ${s.status} does not accept trades`,
    });
    return { state: s, events };
  }

  const tradeDay = dayKey(trade.closedAt);
  let dayKeys: string[] = [];
  try {
    const parsed = JSON.parse(s.tradingDayKeys || "[]");
    if (Array.isArray(parsed))
      dayKeys = parsed.filter((k): k is string => typeof k === "string");
  } catch {}

  if (!dayKeys.includes(tradeDay)) {
    dayKeys.push(tradeDay);
    s.tradingDayKeys = JSON.stringify(dayKeys);
    s.tradingDaysDone = dayKeys.length;
    s.dailyStartBalance = s.currentBalance;
    s.lastTradeDay = tradeDay;
    events.push({ type: "NEW_TRADING_DAY", day: tradeDay });
  } else if (s.lastTradeDay !== tradeDay) {
    // Out-of-order settlement of an already-counted day: never recount,
    // just re-anchor the daily window to the day being applied.
    s.dailyStartBalance = s.currentBalance;
    s.lastTradeDay = tradeDay;
  }

  s.currentBalance = round2(s.currentBalance + trade.profit);
  if (s.currentBalance > s.peakBalance) s.peakBalance = s.currentBalance;

  const dailyStart = s.dailyStartBalance ?? s.startBalance;
  const dailyLoss = round2(dailyStart - s.currentBalance);
  const dailyLossLimit = (cfg.maxDailyLossPct / 100) * dailyStart;
  if (dailyLossLimit > 0 && dailyLoss >= dailyLossLimit) {
    events.push({
      type: "BREACH_DAILY_LOSS",
      dailyLossPct: round2((dailyLoss / dailyStart) * 100),
    });
    s.status = s.phase === "FUNDED" ? "BREACHED" : "FAILED";
    events.push({ type: "TRADE_APPLIED", profit: trade.profit });
    return { state: s, events };
  }

  // Hard rule: drawdown is measured from the equity peak (trailing), so
  // profits lock in a higher floor. Falls back to start balance when the
  // peak hasn't been established yet.
  const ddBase = SITE.trailingDrawdown
    ? Math.max(s.peakBalance, s.startBalance)
    : s.startBalance;
  const ddLimit = (cfg.maxTotalDrawdownPct / 100) * ddBase;
  const ddUsed = round2(ddBase - s.currentBalance);
  if (ddLimit > 0 && ddUsed >= ddLimit) {
    events.push({
      type: "BREACH_TOTAL_DRAWDOWN",
      drawdownPct: round2((ddUsed / ddBase) * 100),
    });
    s.status = s.phase === "FUNDED" ? "BREACHED" : "FAILED";
    events.push({ type: "TRADE_APPLIED", profit: trade.profit });
    return { state: s, events };
  }

  events.push({ type: "TRADE_APPLIED", profit: trade.profit });

  // Phase advancement only ever happens from an ACTIVE evaluation phase.
  // FUNDED accounts never re-trigger PHASE_PASSED (they have no target), and
  // the ACTIVE check double-guards against FUNDED downgrades.
  if (cfg.targetPct > 0 && s.status === "ACTIVE" && s.phase !== "FUNDED") {
    const dayProfit = round2(s.currentBalance - dailyStart);
    if (dayProfit > s.bestDayProfit) s.bestDayProfit = dayProfit;

    const targetBalance = round2(
      s.startBalance * (1 + cfg.targetPct / 100)
    );
    if (s.currentBalance >= targetBalance) {
      const totalProfit = round2(s.currentBalance - s.startBalance);
      const bestDayPct =
        totalProfit > 0 ? (s.bestDayProfit / totalProfit) * 100 : 0;
      const allowed = consistencyPct;

      if (totalProfit > 0 && bestDayPct > allowed) {
        events.push({
          type: "CONSISTENCY_WARNING",
          bestDayPct: round2(bestDayPct),
          allowedPct: allowed,
        });
      } else if (s.tradingDaysDone < cfg.minTradingDays) {
        events.push({
          type: "MIN_DAYS_PENDING",
          daysDone: s.tradingDaysDone,
          daysRequired: cfg.minTradingDays,
        });
      } else {
        events.push({ type: "PHASE_PASSED", phase: s.phase });
      }
    }
  }

  return { state: s, events };
}

export function progressMetrics(
  state: ChallengeState,
  cfg: PhaseConfig,
  consistencyPct: number
) {
  const dailyStart = state.dailyStartBalance ?? state.currentBalance;
  const dailyLoss = Math.max(0, round2(dailyStart - state.currentBalance));
  const dailyLimit = (cfg.maxDailyLossPct / 100) * dailyStart;
  const ddBase = SITE.trailingDrawdown
    ? Math.max(state.peakBalance, state.startBalance)
    : state.startBalance;
  const ddUsed = Math.max(0, round2(ddBase - state.currentBalance));
  const ddLimit = (cfg.maxTotalDrawdownPct / 100) * ddBase;
  const targetBalance = round2(state.startBalance * (1 + cfg.targetPct / 100));
  const profit = round2(state.currentBalance - state.startBalance);
  const targetPctDone =
    cfg.targetPct > 0
      ? Math.min(
          100,
          Math.max(0, (profit / ((cfg.targetPct / 100) * state.startBalance)) * 100)
        )
      : 100;

  const totalProfit = profit;
  const bestDayPct =
    totalProfit > 0 ? (state.bestDayProfit / totalProfit) * 100 : 0;
  const consistencyOk =
    cfg.targetPct === 0 ||
    totalProfit <= 0 ||
    bestDayPct <= consistencyPct;

  return {
    dailyLoss,
    dailyLimit: round2(dailyLimit),
    dailyLossPctUsed:
      dailyLimit > 0 ? Math.min(100, (dailyLoss / dailyLimit) * 100) : 0,
    drawdownUsed: ddUsed,
    drawdownLimit: round2(ddLimit),
    drawdownBase: round2(ddBase),
    trailingDrawdown: SITE.trailingDrawdown,
    peakBalance: state.peakBalance,
    drawdownPctUsed:
      ddLimit > 0 ? Math.min(100, (ddUsed / ddLimit) * 100) : 0,
    targetBalance,
    profit,
    targetPctDone: round2(targetPctDone),
    consistencyOk,
    consistencyPct,
    bestDayPct: round2(bestDayPct),
    daysDone: state.tradingDaysDone,
    daysRequired: cfg.minTradingDays,
  };
}
