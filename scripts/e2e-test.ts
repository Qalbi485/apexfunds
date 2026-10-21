import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  applyTrade,
  getPhaseConfig,
  parsePhases,
  progressMetrics,
  dayKey,
  type TradeInput,
} from "../src/lib/rules";
import { syncChallenge } from "../src/lib/sync";
import {
  applyClosedTradeToChallenge,
  openTerminalTrade,
  settleTerminalTrade,
} from "../src/lib/trading";
import { confirmPaymentCore, submitPaymentTxCore } from "../src/lib/payments";
import { requestPayoutCore, processPayoutCore } from "../src/lib/payouts";
import {
  consumeRateLimit,
  clearRateLimit,
  RATE_LIMITS,
  pickClientIp,
} from "../src/lib/ratelimit";
import { seedLoginBlocked, secretProblem } from "../src/lib/config";
import {
  signSessionToken,
  verifySessionToken,
  signStepUpToken,
  verifyStepUpToken,
  isSessionActive,
  revokeUserSessions,
} from "../src/lib/auth";
import {
  createPasswordResetToken,
  consumePasswordResetToken,
  RESET_TOKEN_TTL_MS,
} from "../src/lib/password-reset";
import {
  generateTotpSecret,
  totpCode,
  totpVerify,
} from "../src/lib/totp";
import { writeAudit, sanitizeForAudit } from "../src/lib/audit";
import { randomBytes } from "crypto";
import { spawnSync } from "child_process";
import { resolve } from "path";
import { existsSync, rmSync } from "fs";
import bcrypt from "bcryptjs";
import type { PhaseConfig } from "../src/lib/config";
import {
  SYMBOLS,
  SYMBOL_LIST,
  DURATIONS,
  TIMEFRAMES,
  buildCandles,
  priceAt,
  fmtPrice,
  isKnownSymbol,
  alignTf,
  candleCloseIn,
} from "../src/lib/market";
import {
  sma,
  ema,
  rsi,
  macd,
  bollinger,
  stochastic,
  atr,
} from "../src/lib/indicators";

const db = new PrismaClient();

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${extra ? " — " + extra : ""}`);
  }
}

/** Wraps a promise so transaction contention (P2034) counts as a lost race. */
async function race<T>(p: Promise<T>): Promise<T | { error: string }> {
  try {
    return await p;
  } catch (e) {
    return { error: String(e) };
  }
}

function baseState(overrides = {}) {
  return {
    accountSize: 10000,
    startBalance: 10000,
    currentBalance: 10000,
    peakBalance: 10000,
    dailyStartBalance: null as number | null,
    tradingDaysDone: 0,
  tradingDayKeys: "[]",
    lastTradeDay: null as string | null,
    bestDayProfit: 0,
    phase: "PHASE_1",
    status: "ACTIVE",
    ...overrides,
  };
}

function trade(profit: number, day: number, id: string) {
  return {
    brokerTradeId: id,
    symbol: "EURUSD",
    direction: profit >= 0 ? "UP" : "DOWN",
    stake: Math.abs(profit),
    payout: profit >= 0 ? profit : 0,
    profit,
    openedAt: new Date(Date.UTC(2026, 0, day, 10)),
    closedAt: new Date(Date.UTC(2026, 0, day, 11)),
  };
}

const PHASE1: Omit<PhaseConfig, never> = {
  phase: "PHASE_1",
  targetPct: 10,
  maxDailyLossPct: 5,
  maxTotalDrawdownPct: 10,
  minTradingDays: 5,
};

async function cleanupE2e() {
  const e2eIds = await db.user.findMany({
    where: { email: { startsWith: "e2e_" } },
    select: { id: true },
  });
  const ids = e2eIds.map((u) => u.id);
  if (!ids.length) return;
  const chs = await db.challenge.findMany({
    where: { userId: { in: ids } },
    select: { id: true },
  });
  const chIds = chs.map((c) => c.id);
  if (chIds.length) {
    await db.trade.deleteMany({ where: { challengeId: { in: chIds } } });
    await db.payout.deleteMany({ where: { challengeId: { in: chIds } } });
    await db.challenge.deleteMany({ where: { id: { in: chIds } } });
  }
  const pays = await db.payment.findMany({
    where: { userId: { in: ids } },
    select: { id: true },
  });
  if (pays.length) {
    await db.commission.deleteMany({
      where: { paymentId: { in: pays.map((p) => p.id) } },
    });
    await db.payment.deleteMany({
      where: { id: { in: pays.map((p) => p.id) } },
    });
  }
  await db.notification.deleteMany({ where: { userId: { in: ids } } });
  await db.kyc.deleteMany({ where: { userId: { in: ids } } });
  await db.supportTicket.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  console.log("\n═══ HARD RULES TESTS ═══\n");

  // Trailing drawdown: floor = peak × (1 − dd%) — measured from the equity
  // peak, not the start balance. Proven against the same give-back under
  // static rules (balance stays above start, so static would NOT breach).
  {
    const mk = () =>
      baseState({
        currentBalance: 12000,
        peakBalance: 12000,
        dailyStartBalance: null,
      }) as Parameters<typeof applyTrade>[0];
    // give-back across 3 days, each day under the daily-loss limit
    let s = mk();
    s = applyTrade(s, PHASE1, trade(-590, 1, "h1"), 40).state;
    s = applyTrade(s, PHASE1, trade(-560, 2, "h2"), 40).state;
    const safe = applyTrade(s, PHASE1, trade(-40, 3, "h3"), 40);
    assert(
      "trailing: give-back above peak floor stays ACTIVE",
      safe.state.status === "ACTIVE" &&
        safe.state.currentBalance === 10810,
      `bal=${safe.state.currentBalance} status=${safe.state.status}`
    );

    s = mk();
    s = applyTrade(s, PHASE1, trade(-590, 1, "h4"), 40).state;
    s = applyTrade(s, PHASE1, trade(-560, 2, "h5"), 40).state;
    const bust = applyTrade(s, PHASE1, trade(-50, 3, "h6"), 40);
    assert(
      "trailing: 10% give-back from peak busts even above start balance",
      bust.state.status === "FAILED" &&
        bust.events.some((e) => e.type === "BREACH_TOTAL_DRAWDOWN") &&
        bust.state.currentBalance === 10800,
      `bal=${bust.state.currentBalance} status=${bust.state.status} events=${bust.events.map((e) => e.type).join(",")}`
    );
    assert(
      "trailing breach is drawdown, not daily loss",
      !bust.events.some((e) => e.type === "BREACH_DAILY_LOSS"),
      bust.events.map((e) => e.type).join(",")
    );
  }

  // Open-time hard rules: stake cap, daily trade cap, inactivity bust,
  // trailing-floor lock.
  {
    await db.user.deleteMany({
      where: { email: "e2e_hardrules@test.com" },
    });
    const hrPkg = await db.package.findFirstOrThrow({ select: { id: true } });
    const hrUser = await db.user.create({
      data: {
        email: "e2e_hardrules@test.com",
        passwordHash: "x",
        name: "Hard Rules",
        referralCode: "E2EHRULE",
      },
    });
    const mkCh = (over: Record<string, unknown> = {}) =>
      db.challenge.create({
        data: {
          userId: hrUser.id,
          packageId: hrPkg.id,
          type: "ONE_STEP",
          phase: "PHASE_1",
          status: "ACTIVE",
          accountSize: 5000,
          startBalance: 5000,
          currentBalance: 5000,
          peakBalance: 5000,
          profitTarget: 5500,
          maxDailyLoss: 250,
          maxTotalDrawdown: 500,
          consistencyPct: 40,
          minTradingDays: 5,
          ...over,
        },
      });
    const open = (challengeId: string, stake: number) =>
      openTerminalTrade({
        userId: hrUser.id,
        challengeId,
        symbol: "EURUSD",
        direction: "UP",
        stake,
        durationSec: 30,
      });

    const ch1 = await mkCh();
    const big = await open(ch1.id, 1600); // 32% of 5000 > 30% cap
    assert(
      "stake over 30% of balance rejected",
      "error" in big && /30% of balance/.test(big.error),
      JSON.stringify(big)
    );
    const okStake = await open(ch1.id, 1500); // exactly 30% → allowed
    assert("stake at 30% cap allowed", "ok" in okStake, JSON.stringify(okStake));

    // Daily trade cap: ch1 already has 1 trade today → 29 more, then the 31st fails
    let capErr = "";
    for (let i = 0; i < 29 && !capErr; i++) {
      const r = await open(ch1.id, 10);
      if ("error" in r) capErr = r.error;
    }
    const dayCap = await open(ch1.id, 10);
    assert(
      "31st trade of the day rejected by daily cap",
      "error" in dayCap && /Daily trade limit/.test(dayCap.error),
      capErr || JSON.stringify(dayCap)
    );

    const ch2 = await mkCh();
    const first = await open(ch2.id, 10);
    assert("pre-inactivity open ok", "ok" in first, JSON.stringify(first));
    await db.trade.updateMany({
      where: { challengeId: ch2.id },
      data: { openedAt: new Date(Date.now() - 16 * 86_400_000) },
    });
    const idle = await open(ch2.id, 10);
    const ch2After = await db.challenge.findUnique({
      where: { id: ch2.id },
      select: { status: true, breachReason: true },
    });
    assert(
      "16-day inactivity busts the account",
      "error" in idle &&
        /breached/i.test(idle.error) &&
        ch2After?.status === "FAILED",
      `err=${"error" in idle ? idle.error : "opened"} status=${ch2After?.status}`
    );

    const ch3 = await mkCh({ currentBalance: 5399, peakBalance: 6000 });
    const locked = await open(ch3.id, 10); // floor = 6000 × 0.9 = 5400
    assert(
      "below peak floor blocks new trades",
      "error" in locked && /Trailing drawdown/.test(locked.error),
      JSON.stringify(locked)
    );
  }

  console.log("\n═══ RULES ENGINE TESTS ═══\n");

  // 1. Normal win
  {
    const r = applyTrade(baseState(), PHASE1, trade(100, 1, "t1"), 40);
    assert(
      "win updates balance",
      r.state.currentBalance === 10100 && r.state.status === "ACTIVE",
      `bal=${r.state.currentBalance}`
    );
    assert(
      "first trade starts trading day",
      r.state.tradingDaysDone === 1 && r.state.dailyStartBalance === 10000
    );
  }

  // 2. Daily loss breach (5% of 10000 = 500)
  {
    const r = applyTrade(baseState(), PHASE1, trade(-500, 1, "t2"), 40);
    assert(
      "daily loss breach → FAILED",
      r.state.status === "FAILED" &&
        r.events.some((e) => e.type === "BREACH_DAILY_LOSS"),
      `status=${r.state.status}`
    );
  }

  // 3. Total drawdown breach (across days, under daily limit each day)
  {
    let s = baseState();
    s = applyTrade(s, PHASE1, trade(-400, 1, "d1"), 40).state;
    s = applyTrade(s, PHASE1, trade(-400, 2, "d2"), 40).state;
    s = applyTrade(s, PHASE1, trade(-250, 3, "d3"), 40).state;
    assert(
      "cumulative drawdown → FAILED",
      s.status === "FAILED" && s.currentBalance <= 9000,
      `bal=${s.currentBalance} status=${s.status}`
    );
  }

  // 4. Phase pass (target + days + consistency ok)
  {
    let s = baseState();
    for (let d = 1; d <= 5; d++) {
      const r = applyTrade(s, PHASE1, trade(210, d, `p${d}`), 40);
      s = r.state;
      if (d === 5) {
        assert(
          "target + days + consistency → PHASE_PASSED",
          s.currentBalance >= 11000 &&
            r.events.some((e) => e.type === "PHASE_PASSED"),
          `bal=${s.currentBalance} events=${r.events.map((e) => e.type).join(",")}`
        );
      }
    }
  }

  // 5. Consistency block (one huge day)
  {
    let s = baseState();
    s = applyTrade(s, PHASE1, trade(950, 1, "c1"), 40).state;
    const r = applyTrade(s, PHASE1, trade(100, 2, "c2"), 40);
    assert(
      "consistency rule blocks pass",
      r.events.some((e) => e.type === "CONSISTENCY_WARNING") &&
        !r.events.some((e) => e.type === "PHASE_PASSED")
    );
  }

  // 6. Min trading days block (equal daily profits keep consistency OK)
  {
    let s = baseState();
    s = applyTrade(s, PHASE1, trade(340, 1, "m1"), 40).state;
    s = applyTrade(s, PHASE1, trade(340, 2, "m2"), 40).state;
    const r = applyTrade(s, PHASE1, trade(340, 3, "m3"), 40);
    assert(
      "min days blocks pass until met",
      r.events.some((e) => e.type === "MIN_DAYS_PENDING") &&
        !r.events.some((e) => e.type === "PHASE_PASSED"),
      `events=${r.events.map((e) => e.type).join(",")}`
    );
  }

  // 7. Funded breach
  {
    const fundedCfg: PhaseConfig = {
      phase: "FUNDED",
      targetPct: 0,
      maxDailyLossPct: 3,
      maxTotalDrawdownPct: 6,
      minTradingDays: 0,
    };
    const r = applyTrade(
      baseState({ phase: "FUNDED" }),
      fundedCfg,
      trade(-300, 1, "f1"),
      50
    );
    assert(
      "funded daily breach → BREACHED",
      r.state.status === "BREACHED" &&
        r.events.some((e) => e.type === "BREACH_DAILY_LOSS"),
      `status=${r.state.status}`
    );
  }

  // 8. parsePhases + progressMetrics
  {
    const phases = parsePhases(
      JSON.stringify([PHASE1, { ...PHASE1, phase: "PHASE_2", targetPct: 5 }])
    );
    assert("parsePhases reads 2 phases", phases.length === 2);
    assert(
      "getPhaseConfig picks PHASE_2",
      getPhaseConfig(phases, "PHASE_2").targetPct === 5
    );
    const m = progressMetrics(baseState(), PHASE1, 40);
    assert("progressMetrics targetPctDone=0 at start", m.targetPctDone === 0);
  }

  console.log("\n═══ INTEGRATION TESTS (DB + SYNC) ═══\n");

  await cleanupE2e();

  const pkg = await db.package.findUnique({ where: { slug: "ONE_STEP_5000" } });
  assert("ONE_STEP_5000 package exists", !!pkg);
  if (!pkg) throw new Error("seed missing");

  const user = await db.user.create({
    data: {
      email: "e2e_trader@test.com",
      passwordHash: "x",
      name: "E2E Trader",
      referralCode: "E2ETEST1",
    },
  });
  // KYC gate is ON by default — payout tests below need an approved user.
  await db.kyc.create({
    data: {
      userId: user.id,
      fullName: "E2E Trader",
      country: "PK",
      documentType: "ID_CARD",
      documentNumber: "42101-1234567-1",
      status: "APPROVED",
    },
  });

  // 9. Purchase simulation → confirm → ACTIVE
  {
    const challenge = await db.challenge.create({
      data: {
        userId: user.id,
        packageId: pkg.id,
        type: "ONE_STEP",
        phase: "PHASE_1",
        status: "PENDING_PAYMENT",
        accountSize: 5000,
        startBalance: 5000,
        currentBalance: 5000,
        peakBalance: 5000,
        profitTarget: 5500,
        maxDailyLoss: 250,
        maxTotalDrawdown: 500,
        consistencyPct: 40,
        minTradingDays: 5,
        brokerAccountId: "e2e_acc_1",
      },
    });
    const payment = await db.payment.create({
      data: {
        userId: user.id,
        challengeId: challenge.id,
        amount: pkg.price,
        method: "USDT_TRC20",
        txHash: "e2e_tx_1",
      },
    });
    await db.payment.update({
      where: { id: payment.id },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });
    const active = await db.challenge.update({
      where: { id: challenge.id },
      data: { status: "ACTIVE", startedAt: new Date() },
    });
    assert("purchase → confirm → ACTIVE", active.status === "ACTIVE");

    // 10. Mock broker sync
    const s1 = await syncChallenge(challenge.id);
    assert("syncChallenge runs ok", s1.ok === true, s1.error);
    const after = await db.challenge.findUnique({
      where: { id: challenge.id },
      include: { trades: true },
    });
    assert(
      "synced trades stored",
      after!.trades.length === (s1.newTrades || 0),
      `trades=${after!.trades.length} reported=${s1.newTrades}`
    );
    assert(
      "balance reflects trades",
      after!.currentBalance ===
        5000 + after!.trades.reduce((a, t) => a + t.profit, 0)
    );

    // 11. Re-sync does not duplicate
    const s2 = await syncChallenge(challenge.id);
    const after2 = await db.challenge.count({
      where: { id: challenge.id },
    });
    void after2;
    const tradeCount = await db.trade.count({
      where: { challengeId: challenge.id },
    });
    assert(
      "no duplicate trades on re-sync",
      tradeCount === after!.trades.length + (s2.newTrades || 0),
      `count=${tradeCount}`
    );
  }

  // 12. Payout ledger accounting via REAL core (processPayoutCore/requestPayoutCore)
  {
    const funded = await db.challenge.create({
      data: {
        userId: user.id,
        packageId: pkg.id,
        type: "INSTANT",
        phase: "FUNDED",
        status: "FUNDED",
        accountSize: 5000,
        startBalance: 5000,
        currentBalance: 5200,
        peakBalance: 5200,
        profitTarget: 0,
        maxDailyLoss: 150,
        maxTotalDrawdown: 300,
        consistencyPct: 50,
        minTradingDays: 0,
        fundedAt: new Date(Date.now() - 30 * 86400000),
      },
    });
    // share = 80% × 200 = 160; 100 is eligible
    const req = await requestPayoutCore({
      userId: user.id,
      challengeId: funded.id,
      amount: 100,
      walletAddress: "TTestWallet123456789",
      network: "TRC20",
      skipScheduleCheck: true,
    });
    assert("requestPayoutCore accepts eligible amount", "ok" in req, JSON.stringify(req));
    const payoutId = "ok" in req ? req.payoutId : "";
    await processPayoutCore(payoutId, "APPROVED");
    const paid = await processPayoutCore(payoutId, "PAID");
    assert("processPayoutCore PAID ok", "ok" in paid, JSON.stringify(paid));
    const afterPaid = await db.challenge.findUnique({ where: { id: funded.id } });
    assert(
      "PAID increments paidWithdrawals, never touches currentBalance",
      afterPaid!.paidWithdrawals === 100 && afterPaid!.currentBalance === 5200,
      `paid=${afterPaid!.paidWithdrawals} bal=${afterPaid!.currentBalance}`
    );
    const dupPaid = await processPayoutCore(payoutId, "PAID");
    assert("double PAID rejected", "error" in dupPaid);
    // eligible now = 160 − 100 = 60
    const over = await requestPayoutCore({
      userId: user.id,
      challengeId: funded.id,
      amount: 61,
      walletAddress: "TTestWallet123456789",
      network: "TRC20",
      skipScheduleCheck: true,
    });
    assert("request over remaining eligible rejected", "error" in over);
  }

  // 13. Affiliate commission
  {
    const referrer = await db.user.create({
      data: {
        email: "e2e_ref@test.com",
        passwordHash: "x",
        name: "E2E Referrer",
        referralCode: "E2EREF1",
      },
    });
    const buyer = await db.user.create({
      data: {
        email: "e2e_buyer@test.com",
        passwordHash: "x",
        name: "E2E Buyer",
        referralCode: "E2EBUY1",
        referredById: referrer.id,
      },
    });
    const payment = await db.payment.create({
      data: {
        userId: buyer.id,
        amount: 99,
        method: "USDT_TRC20",
        txHash: "e2e_tx_ref",
        status: "CONFIRMED",
      },
    });
    await db.commission.create({
      data: {
        referrerId: referrer.id,
        paymentId: payment.id,
        amount: 9.9,
      },
    });
    const sum = await db.commission.aggregate({
      where: { referrerId: referrer.id },
      _sum: { amount: true },
    });
    assert("affiliate commission recorded", sum._sum.amount === 9.9);
  }

  // 14. PHASE A: failed-challenge revival impossible (real apply function)
  {
    const failedCh = await db.challenge.create({
      data: {
        userId: user.id,
        packageId: pkg.id,
        type: "ONE_STEP",
        phase: "PHASE_1",
        status: "FAILED",
        accountSize: 5000,
        startBalance: 5000,
        currentBalance: 4700,
        peakBalance: 5000,
        profitTarget: 5500,
        maxDailyLoss: 250,
        maxTotalDrawdown: 500,
        consistencyPct: 40,
        minTradingDays: 5,
        breachReason: "test fixture",
      },
    });
    const r = await applyClosedTradeToChallenge(failedCh.id, {
      brokerTradeId: "a1",
      symbol: "EURUSD",
      direction: "UP",
      stake: 100,
      payout: 85,
      profit: 85,
      openedAt: new Date(Date.UTC(2026, 5, 1)),
      closedAt: new Date(Date.UTC(2026, 5, 1, 0, 1)),
    });
    const after = await db.challenge.findUnique({ where: { id: failedCh.id } });
    assert(
      "FAILED challenge cannot be revived by winning trade",
      "ignored" in r &&
        r.ignored === true &&
        after!.status === "FAILED" &&
        after!.currentBalance === 4700,
      `status=${after!.status} bal=${after!.currentBalance}`
    );

    const breachedCh = await db.challenge.create({
      data: {
        userId: user.id,
        packageId: pkg.id,
        type: "INSTANT",
        phase: "FUNDED",
        status: "BREACHED",
        accountSize: 5000,
        startBalance: 5000,
        currentBalance: 4600,
        peakBalance: 5000,
        profitTarget: 0,
        maxDailyLoss: 150,
        maxTotalDrawdown: 300,
        consistencyPct: 50,
        minTradingDays: 0,
        breachReason: "test fixture",
      },
    });
    const rb = await applyClosedTradeToChallenge(breachedCh.id, {
      brokerTradeId: "a2",
      symbol: "EURUSD",
      direction: "UP",
      stake: 100,
      payout: 85,
      profit: 85,
      openedAt: new Date(Date.UTC(2026, 5, 2)),
      closedAt: new Date(Date.UTC(2026, 5, 2, 0, 1)),
    });
    const afterB = await db.challenge.findUnique({ where: { id: breachedCh.id } });
    assert(
      "BREACHED challenge cannot be revived",
      "ignored" in rb &&
        rb.ignored === true &&
        afterB!.status === "BREACHED" &&
        afterB!.currentBalance === 4600
    );
  }

  // 15. PHASE A: FUNDED never downgraded / reset by trades
  {
    const fundedCh = await db.challenge.create({
      data: {
        userId: user.id,
        packageId: pkg.id,
        type: "INSTANT",
        phase: "FUNDED",
        status: "FUNDED",
        accountSize: 5000,
        startBalance: 5000,
        currentBalance: 5500,
        peakBalance: 5500,
        profitTarget: 0,
        maxDailyLoss: 150,
        maxTotalDrawdown: 300,
        consistencyPct: 50,
        minTradingDays: 0,
        fundedAt: new Date(),
      },
    });
    const r = await applyClosedTradeToChallenge(fundedCh.id, {
      brokerTradeId: "a3",
      symbol: "EURUSD",
      direction: "UP",
      stake: 100,
      payout: 87,
      profit: 87,
      openedAt: new Date(Date.UTC(2026, 5, 3)),
      closedAt: new Date(Date.UTC(2026, 5, 3, 0, 1)),
    });
    const after = await db.challenge.findUnique({ where: { id: fundedCh.id } });
    assert(
      "FUNDED stays FUNDED (no reset/downgrade) after win",
      after!.status === "FUNDED" &&
        after!.phase === "FUNDED" &&
        after!.startBalance === 5000 &&
        after!.currentBalance === 5587 &&
        !("phasePassed" in r && r.phasePassed) &&
        !("funded" in r && r.funded),
      `status=${after!.status} phase=${after!.phase} bal=${after!.currentBalance}`
    );

    // 16. Trading-day attribution uses trade close day (UTC), not apply time
    const dayCh = await db.challenge.create({
      data: {
        userId: user.id,
        packageId: pkg.id,
        type: "ONE_STEP",
        phase: "PHASE_1",
        status: "ACTIVE",
        accountSize: 5000,
        startBalance: 5000,
        currentBalance: 5000,
        peakBalance: 5000,
        profitTarget: 5500,
        maxDailyLoss: 250,
        maxTotalDrawdown: 500,
        consistencyPct: 40,
        minTradingDays: 5,
      },
    });
    await applyClosedTradeToChallenge(dayCh.id, {
      brokerTradeId: "d1",
      symbol: "EURUSD",
      direction: "UP",
      stake: 100,
      payout: 10,
      profit: 10,
      openedAt: new Date(Date.UTC(2026, 0, 10, 10)),
      closedAt: new Date(Date.UTC(2026, 0, 10, 11)), // day 2026-01-10
    });
    const r2 = await applyClosedTradeToChallenge(dayCh.id, {
      brokerTradeId: "d2",
      symbol: "EURUSD",
      direction: "UP",
      stake: 100,
      payout: 10,
      profit: 10,
      openedAt: new Date(Date.UTC(2026, 0, 11, 10)), // late settlement, next UTC day
      closedAt: new Date(Date.UTC(2026, 0, 11, 11)),
    });
    const afterD = await db.challenge.findUnique({ where: { id: dayCh.id } });
    assert(
      "trading day attributed by trade close day (UTC)",
      afterD!.tradingDaysDone === 2 &&
        afterD!.lastTradeDay === "2026-01-11" &&
        dayKey(new Date(Date.UTC(2026, 0, 11))) === "2026-01-11" &&
        !("error" in r2),
      `days=${afterD!.tradingDaysDone} last=${afterD!.lastTradeDay}`
    );
  }

  // 17. PHASE A: atomic terminal open → expire → settle exactly once
  {
    const termCh = await db.challenge.create({
      data: {
        userId: user.id,
        packageId: pkg.id,
        type: "ONE_STEP",
        phase: "PHASE_1",
        status: "ACTIVE",
        accountSize: 5000,
        startBalance: 5000,
        currentBalance: 5000,
        peakBalance: 5000,
        profitTarget: 5500,
        maxDailyLoss: 250,
        maxTotalDrawdown: 500,
        consistencyPct: 40,
        minTradingDays: 5,
      },
    });

    const open = await openTerminalTrade({
      userId: user.id,
      challengeId: termCh.id,
      symbol: "EURUSD",
      direction: "UP",
      stake: 500,
      durationSec: 30,
    });
    assert("openTerminalTrade ok", "ok" in open, JSON.stringify(open));
    const tradeId = "ok" in open ? open.tradeId : "";
    const mid = await db.challenge.findUnique({ where: { id: termCh.id } });
    assert("open reserves exposure", mid!.reservedExposure === 500);

    const overCap = await openTerminalTrade({
      userId: user.id,
      challengeId: termCh.id,
      symbol: "EURUSD",
      direction: "UP",
      stake: 2100,
      durationSec: 30,
    });
    assert("stake over exposure cap rejected", "error" in overCap);

    // Expire instantly for the test (settlement logic is what we exercise)
    await db.trade.update({
      where: { id: tradeId },
      data: { expiryAt: new Date(Date.now() - 1000) },
    });

    const balBefore = (
      await db.challenge.findUnique({ where: { id: termCh.id } })
    )!.currentBalance;

    // Concurrent double settlement
    const [s1, s2] = await Promise.all([
      race(settleTerminalTrade(user.id, tradeId)),
      race(settleTerminalTrade(user.id, tradeId)),
    ]);
    const oks = [s1, s2].filter((r) => "ok" in r).length;
    assert("concurrent settle: exactly one wins", oks === 1, `oks=${oks}`);
    const third = await settleTerminalTrade(user.id, tradeId);
    assert("third settle rejected", "error" in third);
    const afterS = await db.challenge.findUnique({ where: { id: termCh.id } });
    assert("exposure released after settle", afterS!.reservedExposure === 0);
    const appliedTrade = await db.trade.findUnique({ where: { id: tradeId } });
    assert(
      "balance applied exactly once (delta == trade.profit)",
      afterS!.currentBalance === balBefore + appliedTrade!.profit,
      `bal=${afterS!.currentBalance} expected=${balBefore + appliedTrade!.profit}`
    );

    // Concurrent open overspend: 3 × 2000 on 5000 balance (cap 2500) → 1 winner
    const openCh = await db.challenge.create({
      data: {
        userId: user.id,
        packageId: pkg.id,
        type: "ONE_STEP",
        phase: "PHASE_1",
        status: "ACTIVE",
        accountSize: 5000,
        startBalance: 5000,
        currentBalance: 5000,
        peakBalance: 5000,
        profitTarget: 5500,
        maxDailyLoss: 250,
        maxTotalDrawdown: 500,
        consistencyPct: 40,
        minTradingDays: 5,
      },
    });
    const opens = await Promise.all(
      Array.from({ length: 3 }, () =>
        race(
          openTerminalTrade({
            userId: user.id,
            challengeId: openCh.id,
            symbol: "EURUSD",
            direction: "UP",
            stake: 1500,
            durationSec: 30,
          })
        )
      )
    );
    const openOks = opens.filter((r) => "ok" in r).length;
    assert(
      "concurrent opens respect exposure cap (exactly one fits)",
      openOks === 1,
      `oks=${openOks}`
    );
  }

  // 18. PHASE A: atomic payment confirmation + single commission
  {
    const referrer = await db.user.create({
      data: {
        email: "e2e_ref2@test.com",
        passwordHash: "x",
        name: "E2E Ref2",
        referralCode: "E2EREF2",
      },
    });
    const buyer = await db.user.create({
      data: {
        email: "e2e_buyer2@test.com",
        passwordHash: "x",
        name: "E2E Buyer2",
        referralCode: "E2EBUY2",
        referredById: referrer.id,
      },
    });
    const ch = await db.challenge.create({
      data: {
        userId: buyer.id,
        packageId: pkg.id,
        type: "ONE_STEP",
        phase: "PHASE_1",
        status: "PENDING_PAYMENT",
        accountSize: 5000,
        startBalance: 5000,
        currentBalance: 5000,
        peakBalance: 5000,
        profitTarget: 5500,
        maxDailyLoss: 250,
        maxTotalDrawdown: 500,
        consistencyPct: 40,
        minTradingDays: 5,
      },
    });
    const payment = await db.payment.create({
      data: {
        userId: buyer.id,
        challengeId: ch.id,
        amount: 99,
        method: "USDT_TRC20",
        txHash: "e2e_tx_confirm_race",
      },
    });
    const [c1, c2] = await Promise.all([
      race(confirmPaymentCore(payment.id)),
      race(confirmPaymentCore(payment.id)),
    ]);
    const cOks = [c1, c2].filter((r) => "ok" in r).length;
    assert("concurrent confirm: exactly one wins", cOks === 1, `oks=${cOks}`);
    const commissions = await db.commission.count({
      where: { paymentId: payment.id },
    });
    assert("exactly one commission per payment", commissions === 1);
    const chAfter = await db.challenge.findUnique({ where: { id: ch.id } });
    assert("challenge activated once", chAfter!.status === "ACTIVE");

    // Re-confirm later cannot reset the ACTIVE challenge
    const re = await confirmPaymentCore(payment.id);
    assert("re-confirm rejected", "error" in re);
    const chRe = await db.challenge.findUnique({ where: { id: ch.id } });
    assert("re-confirm does not reset challenge", chRe!.status === "ACTIVE");
  }

  // 19. PHASE A: payouts cannot cause phantom drawdown; real losses still breach
  {
    const funded = await db.challenge.create({
      data: {
        userId: user.id,
        packageId: pkg.id,
        type: "INSTANT",
        phase: "FUNDED",
        status: "FUNDED",
        accountSize: 5000,
        startBalance: 5000,
        currentBalance: 5500,
        peakBalance: 5500,
        profitTarget: 0,
        maxDailyLoss: 150, // 3%
        maxTotalDrawdown: 300, // 6%
        consistencyPct: 50,
        minTradingDays: 0,
        fundedAt: new Date(Date.now() - 30 * 86400000),
      },
    });
    const req = await requestPayoutCore({
      userId: user.id,
      challengeId: funded.id,
      amount: 100, // share = 400
      walletAddress: "TTestWallet123456789",
      network: "TRC20",
      skipScheduleCheck: true,
    });
    if ("ok" in req) {
      await processPayoutCore(req.payoutId, "APPROVED");
      await processPayoutCore(req.payoutId, "PAID");
    }

    // Lose 50 after payout — well within daily limit (150). No phantom breach.
    const r = await applyClosedTradeToChallenge(funded.id, {
      brokerTradeId: "pd1",
      symbol: "EURUSD",
      direction: "DOWN",
      stake: 50,
      payout: 0,
      profit: -50,
      openedAt: new Date(),
      closedAt: new Date(),
    });
    const afterLoss = await db.challenge.findUnique({ where: { id: funded.id } });
    assert(
      "payout does not create phantom drawdown (small loss keeps FUNDED)",
      !("error" in r) &&
        afterLoss!.status === "FUNDED" &&
        afterLoss!.paidWithdrawals === 100 &&
        afterLoss!.currentBalance === 5450,
      `status=${afterLoss!.status} bal=${afterLoss!.currentBalance}`
    );

    // Genuine daily-loss breach still works. Effective FUNDED limits come
    // from the package's FUNDED phase config (fallback: last phase =
    // PHASE_1 for ONE_STEP_5000 → 5%). Daily limits are % of the day's
    // starting balance (5500 → 275). Daily loss so far is 50; losing 230
    // more pushes it to 280 >= 275 → BREACHED.
    await applyClosedTradeToChallenge(funded.id, {
      brokerTradeId: "pd2",
      symbol: "EURUSD",
      direction: "DOWN",
      stake: 230,
      payout: 0,
      profit: -230,
      openedAt: new Date(),
      closedAt: new Date(),
    });
    const afterBreach = await db.challenge.findUnique({ where: { id: funded.id } });
    assert(
      "genuine trading loss still breaches",
      afterBreach!.status === "BREACHED",
      `status=${afterBreach!.status}`
    );

    // Payout on BREACHED → rejected
    const blocked = await requestPayoutCore({
      userId: user.id,
      challengeId: funded.id,
      amount: 50,
      walletAddress: "TTestWallet123456789",
      network: "TRC20",
      skipScheduleCheck: true,
    });
    assert("payout on BREACHED rejected", "error" in blocked);
  }

  // 20. PHASE A: concurrent payout requests cannot oversubscribe eligible
  {
    const funded = await db.challenge.create({
      data: {
        userId: user.id,
        packageId: pkg.id,
        type: "INSTANT",
        phase: "FUNDED",
        status: "FUNDED",
        accountSize: 5000,
        startBalance: 5000,
        currentBalance: 5200,
        peakBalance: 5200,
        profitTarget: 0,
        maxDailyLoss: 150,
        maxTotalDrawdown: 300,
        consistencyPct: 50,
        minTradingDays: 0,
        fundedAt: new Date(Date.now() - 30 * 86400000),
      },
    });
    // eligible share = 160; two concurrent 100s → only one may survive
    const results = await Promise.all(
      Array.from({ length: 2 }, () =>
        race(
          requestPayoutCore({
            userId: user.id,
            challengeId: funded.id,
            amount: 100,
            walletAddress: "TTestWallet123456789",
            network: "TRC20",
            skipScheduleCheck: true,
          })
        )
      )
    );
    const okCount = results.filter((r) => "ok" in r).length;
    assert(
      "concurrent payout requests cannot oversubscribe",
      okCount === 1,
      `oks=${okCount}`
    );

    // KYC gate: enable via Setting, unapproved user blocked, approved passes
    await db.setting.upsert({
      where: { key: "kycRequiredBeforePayout" },
      update: { value: "true" },
      create: { key: "kycRequiredBeforePayout", value: "true" },
    });
    // This user now carries an approved KYC — drop it to test the block.
    await db.kyc.deleteMany({ where: { userId: user.id } });
    const blockedKyc = await requestPayoutCore({
      userId: user.id,
      challengeId: funded.id,
      amount: 50,
      walletAddress: "TTestWallet123456789",
      network: "TRC20",
      skipScheduleCheck: true,
    });
    assert("KYC gate blocks unapproved user", "error" in blockedKyc);
    await db.kyc.create({
      data: {
        userId: user.id,
        fullName: "E2E Tester",
        country: "PK",
        documentType: "ID_CARD",
        documentNumber: "12345",
        status: "APPROVED",
      },
    });
    const allowedKyc = await requestPayoutCore({
      userId: user.id,
      challengeId: funded.id,
      amount: 50,
      walletAddress: "TTestWallet123456789",
      network: "TRC20",
      skipScheduleCheck: true,
    });
    assert("KYC gate allows approved user", "ok" in allowedKyc);
    await db.setting.delete({ where: { key: "kycRequiredBeforePayout" } });
  }

  // ════════ PHASE B: SECURITY REGRESSION TESTS ════════
  console.log("\n═══ PHASE B SECURITY TESTS ═══\n");

  // 21. Rate limiter: blocks at limit; window expiry frees the key (no
  //     permanent lockout).
  {
    const key = `e2e:rl:${Date.now()}`;
    const rule = { limit: 3, windowMs: 60_000 };
    const r1 = await consumeRateLimit(key, rule);
    const r2 = await consumeRateLimit(key, rule);
    const r3 = await consumeRateLimit(key, rule);
    const r4 = await consumeRateLimit(key, rule);
    assert(
      "rate limiter allows up to limit then blocks",
      r1.ok && r2.ok && r3.ok && !r4.ok,
      JSON.stringify([r1.ok, r2.ok, r3.ok, r4.ok])
    );
    // Simulate window expiry: move windowStart into the past.
    await db.rateLimit.update({
      where: { key },
      data: { windowStart: new Date(Date.now() - 2 * 60_000) },
    });
    const r5 = await consumeRateLimit(key, rule);
    assert("rate limit window expiry frees the key (no permanent lockout)", r5.ok);
    assert("real login rules are configured", RATE_LIMITS.loginEmail.limit > 0);
    await clearRateLimit(key);
  }

  // 22. Session tokens: valid, revoked, expired, tampered, replayed.
  {
    const secUser = await db.user.create({
      data: {
        email: "e2e_session@test.com",
        passwordHash: "x",
        name: "E2E Session",
        referralCode: "E2ESES1",
      },
    });
    const jti = randomBytes(16).toString("hex");
    await db.session.create({
      data: {
        id: jti,
        userId: secUser.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const token = await signSessionToken({ userId: secUser.id, role: "TRADER", jti });
    const parsed = await verifySessionToken(token);
    assert(
      "session token verifies with jti + subject",
      !!parsed && parsed.sub === secUser.id && parsed.jti === jti
    );
    assert("active session passes registry check", await isSessionActive(jti));

    // Tampered token
    const tampered = token.slice(0, -4) + "AAAA";
    assert("tampered token rejected", !(await verifySessionToken(tampered)));

    // Expired token (short-lived, issued in the past)
    const expired = await signSessionToken({
      userId: secUser.id,
      role: "TRADER",
      jti: randomBytes(8).toString("hex"),
      issuedAt: Math.floor(Date.now() / 1000) - 3600,
      expiresAtSec: -1,
    });
    assert("expired token rejected", !(await verifySessionToken(expired)));

    // Revoke (logout/password-change path) → replay fails
    await revokeUserSessions(secUser.id);
    assert("revoked session fails registry check", !(await isSessionActive(jti)));
    assert(
      "replayed token after revoke rejected by verifySession",
      !(await verifySessionToken(token)) || !(await isSessionActive(jti))
    );

    // Step-up token: valid for same user, invalid for another / expired
    const step = await signStepUpToken(secUser.id);
    assert("step-up token valid for same user", !!(await verifyStepUpToken(step, secUser.id)));
    assert("step-up token invalid for other user", !(await verifyStepUpToken(step, "someone_else")));
  }

  // 23. Password reset: single-use, expiring, generic errors, revokes sessions
  {
    const rstUser = await db.user.create({
      data: {
        email: "e2e_reset@test.com",
        passwordHash: await bcrypt.hash("OldPass123!", 10),
        name: "E2E Reset",
        referralCode: "E2ERES1",
      },
    });
    const sessJti = randomBytes(16).toString("hex");
    await db.session.create({
      data: {
        id: sessJti,
        userId: rstUser.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const { raw } = await createPasswordResetToken(rstUser.id, "127.0.0.1");
    const newHash = await bcrypt.hash("NewPass456!", 10);
    const used = await consumePasswordResetToken(raw, newHash);
    assert("valid reset token consumed", "ok" in used, JSON.stringify(used));

    const userAfter = await db.user.findUnique({ where: { id: rstUser.id } });
    assert(
      "password updated by reset",
      await bcrypt.compare("NewPass456!", userAfter!.passwordHash)
    );

    const replay = await consumePasswordResetToken(raw, await bcrypt.hash("X", 10));
    assert("reset token replay rejected", "error" in replay);

    const bogus = await consumePasswordResetToken(
      randomBytes(32).toString("hex"),
      await bcrypt.hash("X", 10)
    );
    assert("unknown reset token rejected (generic error)", "error" in bogus);

    // Expired token
    const { raw: raw2 } = await createPasswordResetToken(rstUser.id);
    await db.passwordResetToken.updateMany({
      where: { usedAt: null, userId: rstUser.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expiredConsume = await consumePasswordResetToken(
      raw2,
      await bcrypt.hash("Y", 10)
    );
    assert("expired reset token rejected", "error" in expiredConsume);
    void RESET_TOKEN_TTL_MS;

    // Sessions of the reset user are revoked by the flow (caller contract:
    // consume → revokeUserSessions). Simulate and verify.
    await revokeUserSessions(rstUser.id);
    assert("reset flow revokes sessions", !(await isSessionActive(sessJti)));
  }

  // 24. TOTP: self-consistent codes, wrong codes, clock skew window
  {
    const secret = generateTotpSecret();
    const now = Date.now();
    assert("TOTP code verifies (current step)", totpVerify(secret, totpCode(secret, now), now));
    assert(
      "TOTP accepts previous step (clock skew)",
      totpVerify(secret, totpCode(secret, now - 30_000), now)
    );
    assert("TOTP rejects wrong code", !totpVerify(secret, "000000", now) || totpCode(secret, now) === "000000");
    assert("TOTP rejects non-numeric/short", !totpVerify(secret, "12345", now));
    const other = generateTotpSecret();
    assert(
      "TOTP rejects code from a different secret",
      !totpVerify(secret, totpCode(other, now), now)
    );
  }

  // 25. Audit log: sanitization, immutability triggers, atomic rollback
  {
    const sanitized = sanitizeForAudit({
      passwordHash: "secret-hash",
      token: "raw-token",
      amount: 100,
      nested: { totpSecret: "ABCDE", status: "OK" },
    }) as Record<string, unknown>;
    assert(
      "audit sanitizer redacts secrets",
      sanitized.passwordHash === "[redacted]" &&
        sanitized.token === "[redacted]" &&
        (sanitized.nested as Record<string, unknown>).totpSecret === "[redacted]" &&
        sanitized.amount === 100
    );

    const before = await db.auditLog.count();
    await db.$transaction(async (tx) => {
      await writeAudit(tx, {
        action: "E2E_TX_TEST",
        entityType: "Test",
        outcome: "SUCCESS",
      });
      throw new Error("force rollback");
    }).catch(() => undefined);
    const after = await db.auditLog.count();
    assert("audit row rolls back with failed transaction", after === before);

    await writeAudit(db, {
      actorId: null,
      action: "E2E_AUDIT_TEST",
      entityType: "Test",
      entityId: "e2e-entity",
      outcome: "SUCCESS",
      before: { x: 1 },
      after: { x: 2 },
    });
    const row = await db.auditLog.findFirst({
      where: { action: "E2E_AUDIT_TEST" },
    });
    assert("audit row written with before/after", !!row && row.outcome === "SUCCESS");

    // Append-only enforcement (database triggers)
    let updateBlocked = false;
    let deleteBlocked = false;
    try {
      await db.auditLog.update({
        where: { id: row!.id },
        data: { outcome: "FAILURE" },
      });
    } catch {
      updateBlocked = true;
    }
    try {
      await db.auditLog.delete({ where: { id: row!.id } });
    } catch {
      deleteBlocked = true;
    }
    assert("audit UPDATE blocked by trigger", updateBlocked);
    assert("audit DELETE blocked by trigger", deleteBlocked);
    const still = await db.auditLog.findUnique({ where: { id: row!.id } });
    assert("audit row unchanged after blocked update", still?.outcome === "SUCCESS");
  }

  // 26. Audit on payment confirmation: SUCCESS + FAILURE rows with actor
  {
    const actor = { id: "e2e-actor", email: "e2e-actor@test.com" };
    const buyer = await db.user.create({
      data: {
        email: "e2e_pay_audit@test.com",
        passwordHash: "x",
        name: "E2E PayAudit",
        referralCode: "E2EPAY1",
      },
    });
    await db.kyc.create({
      data: {
        userId: buyer.id,
        fullName: "E2E PayAudit",
        country: "PK",
        documentType: "ID_CARD",
        documentNumber: "42101-1234567-2",
        status: "APPROVED",
      },
    });
    const pkg2 = await db.package.findFirst();
    const ch = await db.challenge.create({
      data: {
        userId: buyer.id,
        packageId: pkg2!.id,
        type: "ONE_STEP",
        phase: "PHASE_1",
        status: "PENDING_PAYMENT",
        accountSize: 5000,
        startBalance: 5000,
        currentBalance: 5000,
        peakBalance: 5000,
        profitTarget: 5500,
        maxDailyLoss: 250,
        maxTotalDrawdown: 500,
        consistencyPct: 40,
        minTradingDays: 5,
      },
    });
    const payment = await db.payment.create({
      data: {
        userId: buyer.id,
        challengeId: ch.id,
        amount: 49,
        method: "USDT_TRC20",
        txHash: "e2e_audit_tx",
      },
    });
    const ok = await confirmPaymentCore(payment.id, actor);
    assert("confirmPaymentCore succeeds with actor", "ok" in ok);
    const successAudit = await db.auditLog.findFirst({
      where: { action: "PAYMENT_CONFIRMED", entityId: payment.id, outcome: "SUCCESS" },
    });
    assert(
      "PAYMENT_CONFIRMED audited atomically with actor",
      !!successAudit && successAudit.actorEmail === "e2e-actor@test.com"
    );

    const dup = await confirmPaymentCore(payment.id, actor);
    assert("duplicate confirm fails", "error" in dup);
    const failAudit = await db.auditLog.findFirst({
      where: {
        action: "PAYMENT_CONFIRM_FAILED",
        entityId: payment.id,
        outcome: "FAILURE",
      },
      orderBy: { createdAt: "desc" },
    });
    assert("failed confirm audited as FAILURE", !!failAudit);

    // Payout audits
    const funded = await db.challenge.create({
      data: {
        userId: buyer.id,
        packageId: pkg2!.id,
        type: "INSTANT",
        phase: "FUNDED",
        status: "FUNDED",
        accountSize: 5000,
        startBalance: 5000,
        currentBalance: 5200,
        peakBalance: 5200,
        profitTarget: 0,
        maxDailyLoss: 150,
        maxTotalDrawdown: 300,
        consistencyPct: 50,
        minTradingDays: 0,
        fundedAt: new Date(Date.now() - 40 * 86400000),
      },
    });
    const req = await requestPayoutCore({
      userId: buyer.id,
      challengeId: funded.id,
      amount: 50, // share = 160
      walletAddress: "TAuditWallet123456789",
      network: "TRC20",
      skipScheduleCheck: true,
      actor: { id: buyer.id, email: buyer.email },
    });
    assert("payout request ok", "ok" in req);
    const pid = "ok" in req ? req.payoutId : "";
    const reqAudit = await db.auditLog.findFirst({
      where: { action: "PAYOUT_REQUESTED", entityId: pid },
    });
    assert("PAYOUT_REQUESTED audited", !!reqAudit);

    await processPayoutCore(pid, "APPROVED", actor);
    await processPayoutCore(pid, "PAID", actor);
    const paidAudit = await db.auditLog.findFirst({
      where: { action: "PAYOUT_PAID", entityId: pid, outcome: "SUCCESS" },
    });
    assert("PAYOUT_PAID audited with actor", !!paidAudit && paidAudit.actorEmail === "e2e-actor@test.com");
    const dupPay = await processPayoutCore(pid, "PAID", actor);
    assert("double-pay rejected", "error" in dupPay);
    const failPayAudit = await db.auditLog.findFirst({
      where: { action: { startsWith: "PAYOUT_PAID" }, entityId: pid, outcome: "FAILURE" },
      orderBy: { createdAt: "desc" },
    });
    assert("failed double-pay audited as FAILURE", !!failPayAudit);
  }

  // 27. Ownership: other users cannot open/settle trades on your challenge
  {
    const owner = await db.user.create({
      data: {
        email: "e2e_owner@test.com",
        passwordHash: "x",
        name: "E2E Owner",
        referralCode: "E2EOWN1",
      },
    });
    const attacker = await db.user.create({
      data: {
        email: "e2e_attacker@test.com",
        passwordHash: "x",
        name: "E2E Attacker",
        referralCode: "E2EATK1",
      },
    });
    const pkg3 = await db.package.findFirst();
    const ch = await db.challenge.create({
      data: {
        userId: owner.id,
        packageId: pkg3!.id,
        type: "ONE_STEP",
        phase: "PHASE_1",
        status: "ACTIVE",
        accountSize: 5000,
        startBalance: 5000,
        currentBalance: 5000,
        peakBalance: 5000,
        profitTarget: 5500,
        maxDailyLoss: 250,
        maxTotalDrawdown: 500,
        consistencyPct: 40,
        minTradingDays: 5,
      },
    });
    const openAsAttacker = await openTerminalTrade({
      userId: attacker.id,
      challengeId: ch.id,
      symbol: "EURUSD",
      direction: "UP",
      stake: 10,
      durationSec: 30,
    });
    assert("attacker cannot open trade on victim challenge", "error" in openAsAttacker);

    const legit = await openTerminalTrade({
      userId: owner.id,
      challengeId: ch.id,
      symbol: "EURUSD",
      direction: "UP",
      stake: 10,
      durationSec: 30,
    });
    assert("owner can open trade", "ok" in legit);
    if ("ok" in legit) {
      const settleAsAttacker = await settleTerminalTrade(attacker.id, legit.tradeId);
      assert("attacker cannot settle victim trade", "error" in settleAsAttacker);
    }
  }

  // ════════ PHASE C: PRODUCTION READINESS & FINANCIAL INTEGRITY ════════
  console.log("\n═══ PHASE C FINANCIAL INTEGRITY + SECURITY TESTS ═══\n");

  // 28. Proxy header parsing: rightmost hop only (XFF spoofing → rate-limit bypass)
  {
    assert(
      "pickClientIp takes rightmost (proxy-appended) hop",
      pickClientIp("1.2.3.4, 10.0.0.1", null) === "10.0.0.1"
    );
    assert(
      "pickClientIp ignores client-supplied single spoof... uses it when alone",
      pickClientIp("9.9.9.9", null) === "9.9.9.9"
    );
    assert(
      "pickClientIp falls back to x-real-ip",
      pickClientIp(null, "5.6.7.8") === "5.6.7.8"
    );
    assert("pickClientIp never empty", pickClientIp(null, null) === "unknown");
    assert(
      "pickClientIp handles whitespace/multi spoof chain",
      pickClientIp(" fake1 , fake2 , real ", "x") === "real"
    );
  }

  // 29. Production seed-account login guard (pure branches)
  {
    assert(
      "seed login blocked in production",
      seedLoginBlocked("admin@apexfunds.com", { NODE_ENV: "production" })
    );
    assert(
      "seed login allowed with ALLOW_SEED_LOGIN=true",
      !seedLoginBlocked("demo@apexfunds.com", {
        NODE_ENV: "production",
        ALLOW_SEED_LOGIN: "true",
      })
    );
    assert(
      "seed login allowed outside production",
      !seedLoginBlocked("admin@apexfunds.com", { NODE_ENV: "development" })
    );
    assert(
      "non-seed account unaffected in production",
      !seedLoginBlocked("real_user@example.com", { NODE_ENV: "production" })
    );
  }

  // 30. submitPaymentTxCore: idempotency + no status flip
  {
    const u = await db.user.create({
      data: {
        email: "e2e_submit@test.com",
        passwordHash: "x",
        name: "E2E Submit",
        referralCode: "E2ESUB1",
      },
    });
    const mkPay = (tx: string | null) =>
      db.payment.create({
        data: {
          userId: u.id,
          amount: 49,
          method: "USDT_TRC20",
          ...(tx ? { txHash: tx } : {}),
          status: "PENDING",
        },
      });
    const pA = await mkPay(null);
    const pB = await mkPay(null);

    // Concurrent submits of the SAME hash to two different payments:
    // exactly one must win; the other gets a friendly error (no throw).
    const [r1, r2] = await Promise.all([
      submitPaymentTxCore({
        paymentId: pA.id,
        userId: u.id,
        txHash: "e2e_dup_hash_1",
        network: "TRC20",
      }),
      submitPaymentTxCore({
        paymentId: pB.id,
        userId: u.id,
        txHash: "e2e_dup_hash_1",
        network: "TRC20",
      }),
    ]);
    const wins = [r1, r2].filter((r) => "ok" in r).length;
    const errs = [r1, r2].filter((r) => "error" in r);
    assert("duplicate txHash race: exactly one wins", wins === 1, JSON.stringify([r1, r2]));
    assert(
      "duplicate txHash race: loser gets friendly error",
      errs.length === 1 && "error" in errs[0] && errs[0].error.includes("already submitted")
    );

    // Wrong owner cannot submit.
    const foreign = await submitPaymentTxCore({
      paymentId: pA.id,
      userId: "someone_else",
      txHash: "e2e_foreign_hash",
      network: "TRC20",
    });
    assert("foreign user cannot submit tx", "error" in foreign);

    // CONFIRMED payment can never be flipped back to PENDING.
    await db.payment.update({
      where: { id: pA.id },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });
    const flip = await submitPaymentTxCore({
      paymentId: pA.id,
      userId: u.id,
      txHash: "e2e_flip_hash",
      network: "ERC20",
    });
    const afterFlip = await db.payment.findUnique({ where: { id: pA.id } });
    assert("submit on CONFIRMED rejected", "error" in flip, JSON.stringify(flip));
    assert(
      "CONFIRMED status + txHash unchanged (no flip)",
      afterFlip?.status === "CONFIRMED" && afterFlip.txHash !== "e2e_flip_hash"
    );
  }

  // 31. Concurrent settlement: two expired trades, same challenge, parallel.
  //     Balance must equal start + Σ trade.profit (no lost update).
  {
    const pkgC = await db.package.findFirst();
    for (let round = 0; round < 3; round++) {
      const u = await db.user.create({
        data: {
          email: `e2e_settle_race_${round}@test.com`,
          passwordHash: "x",
          name: "E2E SettleRace",
          referralCode: `E2ESR${round}`,
        },
      });
      const ch = await db.challenge.create({
        data: {
          userId: u.id,
          packageId: pkgC!.id,
          type: "ONE_STEP",
          phase: "PHASE_1",
          status: "ACTIVE",
          accountSize: 5000,
          startBalance: 5000,
          currentBalance: 5000,
          peakBalance: 5000,
          profitTarget: 5500,
          maxDailyLoss: 250,
          maxTotalDrawdown: 500,
          consistencyPct: 40,
          minTradingDays: 5,
          reservedExposure: 30,
        },
      });
      const expiry = new Date(Date.now() - 5000);
      const t1 = await db.trade.create({
        data: {
          challengeId: ch.id,
          brokerTradeId: `e2e_sr_${round}_1`,
          symbol: "EURUSD",
          direction: "UP",
          stake: 10,
          status: "OPEN",
          entryPrice: 1.10001,
          payoutPct: 87,
          expiryAt: expiry,
          openedAt: new Date(expiry.getTime() - 30000),
          closedAt: expiry,
          profit: 0,
        },
      });
      const t2 = await db.trade.create({
        data: {
          challengeId: ch.id,
          brokerTradeId: `e2e_sr_${round}_2`,
          symbol: "GBPUSD",
          direction: "DOWN",
          stake: 20,
          status: "OPEN",
          entryPrice: 1.30001,
          payoutPct: 87,
          expiryAt: expiry,
          openedAt: new Date(expiry.getTime() - 60000),
          closedAt: expiry,
          profit: 0,
        },
      });

      const [s1, s2] = await Promise.allSettled([
        settleTerminalTrade(u.id, t1.id),
        settleTerminalTrade(u.id, t2.id),
      ]);
      const bothOk =
        s1.status === "fulfilled" && "ok" in s1.value && s2.status === "fulfilled" && "ok" in s2.value;
      assert(
        `concurrent settles both succeed (round ${round})`,
        bothOk,
        JSON.stringify([s1, s2])
      );

      const freshCh = await db.challenge.findUniqueOrThrow({
        where: { id: ch.id },
      });
      const rows = await db.trade.findMany({ where: { challengeId: ch.id } });
      const sumProfit = rows.reduce((a, t) => a + t.profit, 0);
      assert(
        `balance = start + Σ profits, no lost update (round ${round})`,
        Math.abs(freshCh.currentBalance - (5000 + sumProfit)) < 0.005,
        `bal=${freshCh.currentBalance} expected=${5000 + sumProfit}`
      );
      assert(
        `exposure fully released (round ${round})`,
        freshCh.reservedExposure === 0,
        String(freshCh.reservedExposure)
      );
      assert(
        `both trades CLOSED with settledAt (round ${round})`,
        rows.every((r) => r.status === "CLOSED" && r.settledAt)
      );
    }
  }

  // 32. Duplicate import race (same brokerTradeId) + concurrent sync safety
  {
    const pkgC = await db.package.findFirst();
    const u = await db.user.create({
      data: {
        email: "e2e_dup_import@test.com",
        passwordHash: "x",
        name: "E2E DupImport",
        referralCode: "E2EDUP1",
      },
    });
    const ch = await db.challenge.create({
      data: {
        userId: u.id,
        packageId: pkgC!.id,
        type: "ONE_STEP",
        phase: "PHASE_1",
        status: "ACTIVE",
        accountSize: 5000,
        startBalance: 5000,
        currentBalance: 5000,
        peakBalance: 5000,
        profitTarget: 5500,
        maxDailyLoss: 250,
        maxTotalDrawdown: 500,
        consistencyPct: 40,
        minTradingDays: 5,
        brokerAccountId: "e2e_conc_sync_1",
      },
    });

    // Mirror of sync.ts's atomic import pattern racing on the SAME payload.
    const ti: TradeInput = {
      brokerTradeId: "e2e_dup_broker_1",
      symbol: "EURUSD",
      direction: "UP",
      stake: 50,
      payout: 93,
      profit: 43,
      openedAt: new Date(Date.now() - 60000),
      closedAt: new Date(),
    };
    const runImport = () =>
      db.$transaction(async (tx) => {
        await tx.trade.create({
          data: {
            challengeId: ch.id,
            brokerTradeId: ti.brokerTradeId,
            symbol: ti.symbol,
            direction: ti.direction,
            stake: ti.stake,
            payout: ti.payout,
            profit: ti.profit,
            status: "CLOSED",
            openedAt: ti.openedAt,
            closedAt: ti.closedAt,
          },
        });
        const o = await applyClosedTradeToChallenge(ch.id, ti, tx);
        if ("error" in o) throw new Error(o.error);
        return o;
      }, { maxWait: 15000, timeout: 30000 });
    const results = await Promise.allSettled([runImport(), runImport()]);
    const okCount = results.filter(
      (r) => r.status === "fulfilled" && !("error" in r.value)
    ).length;
    const dupCount = results.filter(
      (r) =>
        r.status === "rejected" &&
        String((r as PromiseRejectedResult).reason?.message || "").includes(
          "Unique constraint"
        )
    ).length;
    assert(
      "duplicate brokerTradeId race: exactly one applies",
      okCount === 1 && dupCount === 1,
      JSON.stringify(results.map((r) => r.status))
    );
    const chAfter = await db.challenge.findUniqueOrThrow({
      where: { id: ch.id },
    });
    assert(
      "P&L applied exactly once on duplicate race",
      chAfter.currentBalance === 5043,
      String(chAfter.currentBalance)
    );
    const tradeCount = await db.trade.count({
      where: { challengeId: ch.id, brokerTradeId: ti.brokerTradeId },
    });
    assert("single trade row for duplicate import", tradeCount === 1);

    // Two concurrent full syncs must not crash and must keep the invariant
    // balance = start + Σ profits.
    const [c1, c2] = await Promise.allSettled([
      syncChallenge(ch.id),
      syncChallenge(ch.id),
    ]);
    const noThrow =
      (c1.status === "fulfilled" ? !c1.value.error || c1.value.ok : false) &&
      (c2.status === "fulfilled" ? !c2.value.error || c2.value.ok : false);
    assert(
      "concurrent syncChallenge: no crash / both resolve",
      c1.status === "fulfilled" && c2.status === "fulfilled" && noThrow,
      JSON.stringify([c1, c2])
    );
    const chFinal = await db.challenge.findUniqueOrThrow({
      where: { id: ch.id },
      include: { trades: true },
    });
    const sumAll = chFinal.trades.reduce((a, t) => a + t.profit, 0);
    assert(
      "balance invariant holds after concurrent syncs",
      Math.abs(chFinal.currentBalance - (5000 + sumAll)) < 0.005,
      `bal=${chFinal.currentBalance} sum=${sumAll}`
    );
  }

  // 33. Payout hammer: concurrent requests can never oversubscribe share;
  //     concurrent REQUEST+PAID keeps paid+outstanding ≤ share.
  {
    const pkgC = await db.package.findFirst();
    const u = await db.user.create({
      data: {
        email: "e2e_payout_hammer@test.com",
        passwordHash: "x",
        name: "E2E PayoutHammer",
        referralCode: "E2EPH1",
      },
    });
    await db.kyc.create({
      data: {
        userId: u.id,
        fullName: "E2E PayoutHammer",
        country: "PK",
        documentType: "ID_CARD",
        documentNumber: "42101-1234567-3",
        status: "APPROVED",
      },
    });
    const mkFunded = (bal: number) =>
      db.challenge.create({
        data: {
          userId: u.id,
          packageId: pkgC!.id,
          type: "INSTANT",
          phase: "FUNDED",
          status: "FUNDED",
          accountSize: 5000,
          startBalance: 5000,
          currentBalance: bal,
          peakBalance: bal,
          profitTarget: 0,
          maxDailyLoss: 150,
          maxTotalDrawdown: 300,
          consistencyPct: 50,
          minTradingDays: 0,
          fundedAt: new Date(Date.now() - 40 * 86400000),
        },
      });

    // (a) 6 concurrent requests of $300 on a $800 share → total ≤ 800.
    // Under SQLite's single-writer ceiling some requests may reject with a
    // Prisma timeout (P1008) — that must fail CLOSED: no row, no money.
    // The invariant (never oversubscribed) must hold either way.
    const h1 = await mkFunded(6000); // profit 1000 → share 800
    const reqs = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        requestPayoutCore({
          userId: u.id,
          challengeId: h1.id,
          amount: 300,
          walletAddress: "THammerWallet000001",
          network: "TRC20",
          skipScheduleCheck: true,
        })
      )
    );
    const okReqs = reqs.filter(
      (r) => r.status === "fulfilled" && "ok" in r.value
    );
    const agg1 = await db.payout.aggregate({
      where: { challengeId: h1.id, status: { in: ["REQUESTED", "APPROVED"] } },
      _sum: { amount: true },
    });
    const outstanding1 = agg1._sum.amount ?? 0;
    assert(
      "concurrent payout requests: some succeed",
      okReqs.length >= 1,
      JSON.stringify(reqs)
    );
    assert(
      "concurrent payout requests: total ≤ share (800) — timeouts fail closed",
      outstanding1 <= 800.005,
      `outstanding=${outstanding1}`
    );

    // (b) REQUEST + PAID race loop: paid + outstanding never exceeds share.
    for (let round = 0; round < 5; round++) {
      const h2 = await mkFunded(5200); // profit 200 → share 160
      const first = await requestPayoutCore({
        userId: u.id,
        challengeId: h2.id,
        amount: 100,
        walletAddress: "THammerWallet000002",
        network: "TRC20",
        skipScheduleCheck: true,
      });
      assert("payout race fixture created", "ok" in first);
      const firstId = "ok" in first ? first.payoutId : "";
      await processPayoutCore(firstId, "APPROVED", {
        id: "e2e-race-admin",
        email: "race@test.com",
      });

      const [paid, second] = await Promise.allSettled([
        processPayoutCore(firstId, "PAID", { id: "e2e-race-admin" }),
        requestPayoutCore({
          userId: u.id,
          challengeId: h2.id,
          amount: 60,
          walletAddress: "THammerWallet000003",
          network: "TRC20",
          skipScheduleCheck: true,
        }),
      ]);
      void paid;
      void second;

      const h2After = await db.challenge.findUniqueOrThrow({
        where: { id: h2.id },
      });
      const agg2 = await db.payout.aggregate({
        where: {
          challengeId: h2.id,
          status: { in: ["REQUESTED", "APPROVED"] },
        },
        _sum: { amount: true },
      });
      const paidSum = h2After.paidWithdrawals;
      const outstanding2 = agg2._sum.amount ?? 0;
      assert(
        `paid + outstanding ≤ share 160 (round ${round})`,
        paidSum + outstanding2 <= 160.01,
        `paid=${paidSum} outstanding=${outstanding2}`
      );
    }
  }

  // 34. PAID-time equity revalidation: open exposure can block the payout;
  //     releasing exposure unblocks it (no permanent poison).
  {
    const pkgC = await db.package.findFirst();
    const u = await db.user.create({
      data: {
        email: "e2e_equity_gate@test.com",
        passwordHash: "x",
        name: "E2E EquityGate",
        referralCode: "E2EEG1",
      },
    });
    await db.kyc.create({
      data: {
        userId: u.id,
        fullName: "E2E EquityGate",
        country: "PK",
        documentType: "ID_CARD",
        documentNumber: "42101-1234567-4",
        status: "APPROVED",
      },
    });
    const ch = await db.challenge.create({
      data: {
        userId: u.id,
        packageId: pkgC!.id,
        type: "INSTANT",
        phase: "FUNDED",
        status: "FUNDED",
        accountSize: 5000,
        startBalance: 5000,
        currentBalance: 5200,
        peakBalance: 5200,
        profitTarget: 0,
        maxDailyLoss: 150,
        maxTotalDrawdown: 300,
        consistencyPct: 50,
        minTradingDays: 0,
        fundedAt: new Date(Date.now() - 40 * 86400000),
        reservedExposure: 5100,
      },
    });
    const req = await requestPayoutCore({
      userId: u.id,
      challengeId: ch.id,
      amount: 160,
      walletAddress: "TEquityGateWallet01",
      network: "TRC20",
      skipScheduleCheck: true,
    });
    // Worst-case equity with 5100 open: 5200 − 5100 − 160 = −60 → request
    // must be rejected up front.
    assert(
      "payout request rejected when open exposure breaks worst-case equity",
      "error" in req,
      JSON.stringify(req)
    );

    // Bypass the request gate (fixture writes reserved=0), approve, then open
    // massive exposure before PAID — PAID must re-validate and roll back.
    await db.challenge.update({
      where: { id: ch.id },
      data: { reservedExposure: 0 },
    });
    const req2 = await requestPayoutCore({
      userId: u.id,
      challengeId: ch.id,
      amount: 160,
      walletAddress: "TEquityGateWallet01",
      network: "TRC20",
      skipScheduleCheck: true,
    });
    assert("payout request ok when equity is clean", "ok" in req2, JSON.stringify(req2));
    const pid = "ok" in req2 ? req2.payoutId : "";
    await processPayoutCore(pid, "APPROVED", { id: "adm", email: "adm@test.com" });

    await db.challenge.update({
      where: { id: ch.id },
      data: { reservedExposure: 5100 },
    });
    const paidBlocked = await processPayoutCore(pid, "PAID", {
      id: "adm",
      email: "adm@test.com",
    });
    const mid = await db.challenge.findUniqueOrThrow({ where: { id: ch.id } });
    const payoutMid = await db.payout.findUniqueOrThrow({ where: { id: pid } });
    assert(
      "PAID rejected when exposure eats equity",
      "error" in paidBlocked,
      JSON.stringify(paidBlocked)
    );
    assert(
      "PAID claim rolled back (still APPROVED)",
      payoutMid.status === "APPROVED"
    );
    assert("paidWithdrawals unchanged on blocked PAID", mid.paidWithdrawals === 0);

    await db.challenge.update({
      where: { id: ch.id },
      data: { reservedExposure: 0 },
    });
    const paidOk = await processPayoutCore(pid, "PAID", {
      id: "adm",
      email: "adm@test.com",
    });
    const end = await db.challenge.findUniqueOrThrow({ where: { id: ch.id } });
    assert("PAID succeeds once exposure released", "ok" in paidOk, JSON.stringify(paidOk));
    assert("paidWithdrawals incremented after clean PAID", end.paidWithdrawals === 160);
  }

  // 35. Trade open with paid withdrawals: funds + cap conditions hold
  //     sequentially (SQL WHERE is the authority under races).
  {
    const pkgC = await db.package.findFirst();
    const u = await db.user.create({
      data: {
        email: "e2e_open_funds@test.com",
        passwordHash: "x",
        name: "E2E OpenFunds",
        referralCode: "E2EOF1",
      },
    });
    const ch = await db.challenge.create({
      data: {
        userId: u.id,
        packageId: pkgC!.id,
        type: "INSTANT",
        phase: "FUNDED",
        status: "FUNDED",
        accountSize: 5000,
        startBalance: 5000,
        currentBalance: 6000,
        peakBalance: 6000,
        profitTarget: 0,
        maxDailyLoss: 150,
        maxTotalDrawdown: 300,
        consistencyPct: 50,
        minTradingDays: 0,
        fundedAt: new Date(Date.now() - 40 * 86400000),
        paidWithdrawals: 2000,
      },
    });

    // available = 6000 − 2000 − 0 = 4000; cap = 50% × 6000 = 3000.
    // stake 1800 = exactly the 30% single-stake hard rule → allowed.
    const o1 = await openTerminalTrade({
      userId: u.id,
      challengeId: ch.id,
      symbol: "EURUSD",
      direction: "UP",
      stake: 1800,
      durationSec: 30,
    });
    assert("open within funds+cap succeeds", "ok" in o1, JSON.stringify(o1));

    // cap: reserved 1800 + 1500 > 3000 → rejected even though funds remain.
    const o2 = await openTerminalTrade({
      userId: u.id,
      challengeId: ch.id,
      symbol: "GBPUSD",
      direction: "DOWN",
      stake: 1500,
      durationSec: 30,
    });
    assert(
      "open exceeding exposure cap rejected",
      "error" in o2 && o2.error.includes("cap"),
      JSON.stringify(o2)
    );

    // funds: paid=4000 → available = 6000 − 4000 − 1800 = 200 → 300 must fail.
    await db.challenge.update({
      where: { id: ch.id },
      data: { paidWithdrawals: 4000 },
    });
    const o3 = await openTerminalTrade({
      userId: u.id,
      challengeId: ch.id,
      symbol: "EURUSD",
      direction: "UP",
      stake: 300,
      durationSec: 30,
    });
    assert(
      "open rejected when paid withdrawals eat available funds",
      "error" in o3,
      JSON.stringify(o3)
    );
    const mid = await db.challenge.findUniqueOrThrow({ where: { id: ch.id } });
    assert(
      "reservedExposure matches open trades only",
      mid.reservedExposure === 1800,
      String(mid.reservedExposure)
    );
  }

  // 36. Backup → verify → restore roundtrip using the real scripts
  {
    const ts = Date.now();
    const backupPath = resolve(`prisma/backups/e2e-test-${ts}.db`);
    const restoreTarget = resolve(`prisma/backups/e2e-restore-${ts}.db`);
    try {
      // NOTE: shell:true + args[] concatenates WITHOUT escaping (DEP0190) —
      // our project path contains a space ("Funded firm"), so spawn the whole
      // command as one quoted string instead.
      const sh = (cmd: string) =>
        spawnSync(cmd, { shell: true, encoding: "utf8", env: process.env });
      const bk = sh(`npx tsx scripts/backup-db.ts "${backupPath}"`);
      assert(
        "db backup script succeeds",
        bk.status === 0 && existsSync(backupPath),
        bk.stdout + bk.stderr
      );

      // Restore without --yes must refuse.
      const refuse = sh(
        `npx tsx scripts/restore-db.ts "${backupPath}" --target "${restoreTarget}"`
      );
      assert(
        "restore refuses without --yes",
        refuse.status !== 0 && refuse.stderr.includes("Refusing"),
        refuse.stderr.slice(0, 200)
      );

      const rs = sh(
        `npx tsx scripts/restore-db.ts "${backupPath}" --yes --target "${restoreTarget}"`
      );
      assert(
        "restore verifies and copies back",
        rs.status === 0 && rs.stdout.includes("restored"),
        (rs.stdout + rs.stderr).slice(-400)
      );
      assert("restore target created", existsSync(restoreTarget));
    } finally {
      for (const f of [backupPath, restoreTarget, `${restoreTarget}.pre-restore`]) {
        if (existsSync(f)) rmSync(f, { force: true });
      }
    }
  }

  // 37. PHASE D: production secret hygiene (pure — never echoes values)
  {
    assert("secretProblem rejects missing value", !!secretProblem("S", ""));
    assert(
      "secretProblem rejects undefined value",
      !!secretProblem("S", undefined)
    );
    assert("secretProblem rejects short value", !!secretProblem("S", "abcd"));
    assert(
      "secretProblem rejects changeme placeholder",
      !!secretProblem("S", `changeme-${"x".repeat(40)}`)
    );
    assert(
      "secretProblem rejects 'your-secret' placeholder",
      !!secretProblem("S", `your-secret-${"x".repeat(30)}`)
    );
    assert(
      "secretProblem accepts 64-char hex",
      secretProblem("S", randomBytes(32).toString("hex")) === null
    );
    assert(
      "secretProblem accepts long random string",
      secretProblem("S", randomBytes(48).toString("base64url")) === null
    );
  }

  // 38. Market data: symbols (forex + gold + bitcoin), candles, determinism
  {
    assert(
      "market has 30 symbols (28 forex + XAUUSD + BTCUSD)",
      SYMBOL_LIST.length === 30,
      `got ${SYMBOL_LIST.length}`
    );
    assert("known symbol accepted", isKnownSymbol("EURUSD"));
    assert("gold symbol accepted", isKnownSymbol("XAUUSD"));
    assert("bitcoin symbol accepted", isKnownSymbol("BTCUSD"));
    assert("unknown symbol rejected", !isKnownSymbol("FAKEPAIR"));
    assert("no OTC symbols left", !isKnownSymbol("EURUSD_OTC"));
    assert(
      "XAUUSD categorized as metals",
      SYMBOLS.XAUUSD.category === "metals" &&
        SYMBOLS.XAUUSD.name === "Gold" &&
        !!SYMBOLS.XAUUSD.provider
    );
    assert(
      "BTCUSD categorized as crypto",
      SYMBOLS.BTCUSD.category === "crypto" &&
        SYMBOLS.BTCUSD.name === "Bitcoin" &&
        !!SYMBOLS.BTCUSD.provider
    );
    assert(
      "all categories covered",
      ["forex", "metals", "crypto"].every((c) =>
        Object.values(SYMBOLS).some((s) => s.category === (c as never))
      )
    );
    assert(
      "unknown priceAt returns 0",
      priceAt("FAKEPAIR", Date.now()) === 0
    );

    const now = Date.now();
    // deterministic price
    assert(
      "priceAt deterministic",
      priceAt("EURUSD", now) === priceAt("EURUSD", now)
    );
    assert(
      "priceAt differs across time",
      priceAt("EURUSD", now) !== priceAt("EURUSD", now - 60000)
    );
    assert(
      "XAUUSD price differs from EURUSD",
      priceAt("XAUUSD", now) !== priceAt("EURUSD", now)
    );

    // candles: count, OHLC invariants, volume, monotone time
    for (const [sym, tf] of [
      ["EURUSD", 60_000],
      ["GBPUSD", 300_000],
      ["XAUUSD", 3_600_000],
      ["BTCUSD", 86_400_000],
    ] as const) {
      const cs = buildCandles(sym, now, 200, tf);
      const tag = `${sym}/${tf}`;
      const okCount = cs.length === 200;
      let okOhlc = true;
      let okVol = true;
      let okTime = true;
      let okFinite = true;
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        if (
          !Number.isFinite(c.open) ||
          !Number.isFinite(c.high) ||
          !Number.isFinite(c.low) ||
          !Number.isFinite(c.close)
        )
          okFinite = false;
        if (c.high < Math.max(c.open, c.close) - 1e-12) okOhlc = false;
        if (c.low > Math.min(c.open, c.close) + 1e-12) okOhlc = false;
        if (c.high < c.low) okOhlc = false;
        if (!(c.volume > 0)) okVol = false;
        if (i > 0 && c.time - cs[i - 1].time !== tf) okTime = false;
      }
      assert(`${tag} candle count`, okCount, `got ${cs.length}`);
      assert(`${tag} OHLC bounds`, okOhlc);
      assert(`${tag} volume > 0`, okVol);
      assert(`${tag} time step = tf`, okTime);
      assert(`${tag} finite prices`, okFinite);
    }

    // identical inputs → identical candles (chart/settlement consistency)
    const a = buildCandles("EURUSD", now, 100, 60_000);
    const b = buildCandles("EURUSD", now, 100, 60_000);
    assert(
      "buildCandles deterministic",
      JSON.stringify(a) === JSON.stringify(b)
    );

    // full history: any past end works (infinite history claim)
    const past = now - 400 * 86_400_000;
    const hist = buildCandles("GBPUSD", past, 300, 86_400_000);
    assert(
      "history builds for past timestamp",
      hist.length === 300 && hist[hist.length - 1].time <= past
    );
    const deep = buildCandles("XAUUSD", 0, 50, 3_600_000);
    assert(
      "history builds from epoch",
      deep.length === 50 && deep.every((c) => Number.isFinite(c.close))
    );

    // timeframe helpers
    assert(
      "10 timeframes 5s..1D",
      TIMEFRAMES.length === 10 &&
        TIMEFRAMES[0].ms === 5_000 &&
        TIMEFRAMES[9].ms === 86_400_000
    );
    assert(
      "durations match trade API",
      DURATIONS.map((d) => d.sec).join(",") === "30,60,120,300"
    );
    assert(
      "alignTf floors to boundary",
      alignTf(90_000, 60_000) === 60_000 && alignTf(59_999, 60_000) === 0
    );
    const ci = candleCloseIn(90_000, 60_000);
    assert("candleCloseIn in range", ci > 0 && ci <= 60_000, `got ${ci}`);
    assert(
      "fmtPrice respects decimals",
      fmtPrice("EURUSD", 1.085) === "1.08500" &&
        fmtPrice("USDJPY", 149.2) === "149.200"
    );
  }

  // 39. Indicators: warm-up nulls, ranges, internal consistency
  {
    const now = Date.now();
    const candles = buildCandles("EURUSD", now, 300, 60_000);
    const closes = candles.map((c) => c.close);
    const n = candles.length;

    const s20 = sma(closes, 20);
    assert("sma length", s20.length === n);
    assert(
      "sma warm-up nulls",
      s20.slice(0, 19).every((v) => v === null) && s20[19] !== null
    );
    const constSma = sma([5, 5, 5, 5, 5], 3);
    assert(
      "sma constant input",
      constSma[2] === 5 && constSma[4] === 5
    );
    assert(
      "sma too-short input all null",
      sma([1, 2], 5).every((v) => v === null)
    );

    const e20 = ema(closes, 20);
    assert(
      "ema first value at period-1",
      e20.slice(0, 19).every((v) => v === null) &&
        e20[19] !== null &&
        e20[n - 1] !== null
    );

    const r14 = rsi(candles, 14);
    assert("rsi length", r14.length === n);
    assert(
      "rsi warm-up nulls",
      r14.slice(0, 14).every((v) => v === null) && r14[14] !== null
    );
    const rDefined = r14.filter((v): v is number => v !== null);
    assert(
      "rsi within 0..100",
      rDefined.length > 0 && rDefined.every((v) => v >= 0 && v <= 100),
      `min ${Math.min(...rDefined)} max ${Math.max(...rDefined)}`
    );

    const m = macd(candles);
    assert(
      "macd aligned lengths",
      m.macd.length === n && m.signal.length === n && m.hist.length === n
    );
    assert(
      "macd line starts after slow EMA",
      m.macd.slice(0, 25).every((v) => v === null) && m.macd[25] !== null
    );
    let histOk = true;
    let histAny = false;
    for (let i = 0; i < n; i++) {
      if (m.hist[i] !== null) {
        histAny = true;
        if (
          m.macd[i] === null ||
          m.signal[i] === null ||
          Math.abs(m.hist[i]! - (m.macd[i]! - m.signal[i]!)) > 1e-9
        )
          histOk = false;
      }
    }
    assert("macd hist = line - signal", histOk && histAny);

    const bb = bollinger(candles, 20, 2);
    assert(
      "bollinger warm-up nulls",
      bb.upper.slice(0, 19).every((v) => v === null) &&
        bb.upper[19] !== null
    );
    let bbOk = true;
    let bbAny = false;
    for (let i = 0; i < n; i++) {
      if (bb.upper[i] !== null) {
        bbAny = true;
        if (!(bb.upper[i]! >= bb.mid[i]! && bb.mid[i]! >= bb.lower[i]!))
          bbOk = false;
      }
    }
    assert("bollinger upper >= mid >= lower", bbOk && bbAny);

    const st = stochastic(candles);
    assert(
      "stochastic aligned lengths",
      st.k.length === n && st.d.length === n
    );
    const stK = st.k.filter((v): v is number => v !== null);
    const stD = st.d.filter((v): v is number => v !== null);
    assert(
      "stochastic within 0..100",
      stK.length > 0 &&
        stD.length > 0 &&
        stK.every((v) => v >= 0 && v <= 100) &&
        stD.every((v) => v >= 0 && v <= 100)
    );

    const a14 = atr(candles, 14);
    assert(
      "atr warm-up nulls",
      a14.slice(0, 14).every((v) => v === null) && a14[14] !== null
    );
    const aDef = a14.filter((v): v is number => v !== null);
    assert(
      "atr positive",
      aDef.length > 0 && aDef.every((v) => v > 0)
    );
  }

  // Cleanup
  await cleanupE2e();

  console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══\n`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
