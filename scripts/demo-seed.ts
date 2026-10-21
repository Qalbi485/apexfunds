import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";

const db = new PrismaClient();

const SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD"];

function makeTrades(
  challengeId: string,
  prefix: string,
  days: number[][],
  startDate: Date
) {
  const trades: Array<{
    challengeId: string;
    brokerTradeId: string;
    symbol: string;
    direction: string;
    stake: number;
    payout: number | null;
    profit: number;
    openedAt: Date;
    closedAt: Date;
  }> = [];
  let i = 0;
  days.forEach((dayProfits, d) => {
    const day = new Date(startDate.getTime() + d * 86400000);
    dayProfits.forEach((profit, j) => {
      const closedAt = new Date(
        day.getTime() + 9 * 3600000 + j * 25 * 60000
      );
      const stake = Math.round(Math.abs(profit) * 1.8 + 15);
      trades.push({
        challengeId,
        brokerTradeId: `${prefix}_${d}_${j}`,
        symbol: SYMBOLS[(i + d) % SYMBOLS.length],
        direction: profit >= 0 ? (j % 2 === 0 ? "UP" : "DOWN") : j % 2 === 0 ? "DOWN" : "UP",
        stake,
        payout: profit >= 0 ? stake + profit : 0,
        profit,
        openedAt: new Date(closedAt.getTime() - 8 * 60000),
        closedAt,
      });
      i++;
    });
  });
  return trades;
}

async function main() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_SEED_LOGIN !== "true"
  ) {
    console.error(
      "demo-seed refused: NODE_ENV=production (set ALLOW_SEED_LOGIN=true to override)"
    );
    process.exit(1);
  }
  console.log("Seeding demo data...");

  const now = new Date();
  const d20 = new Date(now.getTime() - 20 * 86400000);
  const d10 = new Date(now.getTime() - 10 * 86400000);
  const d3 = new Date(now.getTime() - 3 * 86400000);

  const pw = await bcrypt.hash("Demo@12345", 10);

  const demo = await db.user.upsert({
    where: { email: "demo@apexfunds.com" },
    update: {},
    create: {
      email: "demo@apexfunds.com",
      passwordHash: pw,
      name: "Demo Trader",
      referralCode: "DEMO2026",
    },
  });

  const t1 = await db.user.upsert({
    where: { email: "trader1@example.com" },
    update: {},
    create: {
      email: "trader1@example.com",
      passwordHash: pw,
      name: "Ahmed Khan",
      referralCode: "AHMED101",
      referredById: demo.id,
    },
  });

  const t2 = await db.user.upsert({
    where: { email: "trader2@example.com" },
    update: {},
    create: {
      email: "trader2@example.com",
      passwordHash: pw,
      name: "Sara Ali",
      referralCode: "SARA202",
    },
  });

  const pkgTwo10k = await db.package.findUniqueOrThrow({
    where: { slug: "TWO_STEP_10000" },
  });
  const pkgInstant5k = await db.package.findUniqueOrThrow({
    where: { slug: "INSTANT_5000" },
  });
  const pkgOne5k = await db.package.findUniqueOrThrow({
    where: { slug: "ONE_STEP_5000" },
  });
  const pkgTwo25k = await db.package.findUniqueOrThrow({
    where: { slug: "TWO_STEP_25000" },
  });
  const pkgOne10k = await db.package.findUniqueOrThrow({
    where: { slug: "ONE_STEP_10000" },
  });

  // ── Challenge A: ACTIVE 2-step PHASE_1, healthy progress ──
  const existingA = await db.challenge.findFirst({
    where: { userId: demo.id, brokerAccountId: "demo_active_10k" },
  });
  if (!existingA) {
    const a = await db.challenge.create({
      data: {
        userId: demo.id,
        packageId: pkgTwo10k.id,
        type: "TWO_STEP",
        phase: "PHASE_1",
        status: "ACTIVE",
        accountSize: 10000,
        startBalance: 10000,
        currentBalance: 10520,
        peakBalance: 10580,
        dailyStartBalance: 10450,
        profitTarget: 10800,
        maxDailyLoss: 500,
        maxTotalDrawdown: 1000,
        consistencyPct: 40,
        minTradingDays: 5,
        tradingDaysDone: 4,
        lastTradeDay: d3.toISOString().slice(0, 10),
        bestDayProfit: 210,
        brokerAccountId: "demo_active_10k",
        startedAt: d10,
      },
    });
    const tradesA = makeTrades(
      a.id,
      "demoA",
      [
        [55, 70, -30, 45, 60, -50],
        [80, -40, 95, 65, -25, 25],
        [-60, 35, 20, -55, 40, 20],
        [90, 75, -40, 85, -30, 30],
      ],
      d10
    );
    await db.trade.createMany({ data: tradesA });
    console.log("✓ Active 2-step challenge with", tradesA.length, "trades");
  }

  // ── Challenge B: FUNDED instant with payouts ──
  const existingB = await db.challenge.findFirst({
    where: { userId: demo.id, brokerAccountId: "demo_funded_5k" },
  });
  if (!existingB) {
    const b = await db.challenge.create({
      data: {
        userId: demo.id,
        packageId: pkgInstant5k.id,
        type: "INSTANT",
        phase: "FUNDED",
        status: "FUNDED",
        accountSize: 5000,
        startBalance: 5000,
        // Trading-only balance under the Phase A ledger model:
        // trading profit 460; the $150 already paid out is tracked in
        // paidWithdrawals instead of reducing the trading balance.
        currentBalance: 5460,
        peakBalance: 5480,
        dailyStartBalance: 5530,
        paidWithdrawals: 150,
        profitTarget: 0,
        maxDailyLoss: 150,
        maxTotalDrawdown: 300,
        consistencyPct: 50,
        minTradingDays: 0,
        tradingDaysDone: 9,
        lastTradeDay: now.toISOString().slice(0, 10),
        bestDayProfit: 160,
        brokerAccountId: "demo_funded_5k",
        startedAt: d20,
        fundedAt: d20,
      },
    });
    const tradesB = makeTrades(
      b.id,
      "demoB",
      [
        [60, -30, 85, 45, -20, 70, 55, -40],
        [90, 50, -35, 75, 60, -25, 80, 40],
        [-45, 65, 95, 50, -30, 70, 55, 60],
        [80, -40, 100, 65, 45, -25, 75, 50],
        [70, 55, -30, 85, 60, 40, -20, 90],
      ],
      d20
    );
    await db.trade.createMany({ data: tradesB });

    await db.payout.createMany({
      data: [
        {
          userId: demo.id,
          challengeId: b.id,
          amount: 150,
          traderAmount: 150,
          profitConsumed: 187.5,
          firmAmount: 37.5,
          walletAddress: "TDemoWalletForShowcase1234",
          network: "TRC20",
          status: "PAID",
          createdAt: d10,
          processedAt: d9(d10),
        },
        {
          userId: demo.id,
          challengeId: b.id,
          amount: 100,
          traderAmount: 100,
          profitConsumed: 125,
          firmAmount: 25,
          walletAddress: "TDemoWalletForShowcase1234",
          network: "TRC20",
          status: "REQUESTED",
          createdAt: d3,
        },
      ],
    });
    console.log("✓ Funded account with 2 payouts +", tradesB.length, "trades");
  }

  // ── Challenge C: FAILED with breach ──
  const existingC = await db.challenge.findFirst({
    where: { userId: demo.id, brokerAccountId: "demo_failed_5k" },
  });
  if (!existingC) {
    const c = await db.challenge.create({
      data: {
        userId: demo.id,
        packageId: pkgOne5k.id,
        type: "ONE_STEP",
        phase: "PHASE_1",
        status: "FAILED",
        accountSize: 5000,
        startBalance: 5000,
        currentBalance: 4730,
        peakBalance: 5120,
        dailyStartBalance: 4990,
        profitTarget: 5500,
        maxDailyLoss: 250,
        maxTotalDrawdown: 500,
        consistencyPct: 40,
        minTradingDays: 5,
        tradingDaysDone: 3,
        lastTradeDay: d3.toISOString().slice(0, 10),
        bestDayProfit: 130,
        brokerAccountId: "demo_failed_5k",
        startedAt: d10,
        failedAt: d3,
        breachReason: "Daily loss limit breached (5.20%)",
      },
    });
    const tradesC = makeTrades(
      c.id,
      "demoC",
      [
        [70, -35, 90, 55, -20, 60],
        [50, -90, 40, -75, 30, 85],
        [-120, 45, -95, 60, -85, -135],
      ],
      d10
    );
    await db.trade.createMany({ data: tradesC });
    console.log("✓ Failed challenge with breach");
  }

  // ── Notifications for demo trader ──
  const notifCount = await db.notification.count({
    where: { userId: demo.id },
  });
  if (notifCount === 0) {
    await db.notification.createMany({
      data: [
        {
          userId: demo.id,
          type: "SYSTEM",
          title: "Welcome to ApexFunds 🎉",
          body: "Your demo account is ready. Explore the dashboard!",
          createdAt: d10,
        },
        {
          userId: demo.id,
          type: "PAYMENT",
          title: "Challenge activated 🎉",
          body: "Your 2-Step Challenge $10,000 is now active. Good luck!",
          createdAt: d10,
        },
        {
          userId: demo.id,
          type: "PAYOUT",
          title: "Payout sent 💰",
          body: "$150.00 has been sent to your wallet.",
          createdAt: d9(d10),
        },
        {
          userId: demo.id,
          type: "BREACH",
          title: "Challenge failed",
          body: "Daily loss limit breached (5.20%)",
          createdAt: d3,
        },
      ],
    });
  }

  // ── KYC approved ──
  await db.kyc.upsert({
    where: { userId: demo.id },
    update: {},
    create: {
      userId: demo.id,
      fullName: "Demo Trader",
      country: "Pakistan",
      documentType: "PASSPORT",
      documentNumber: "DEMO12345",
      status: "APPROVED",
      reviewedAt: d10,
    },
  });

  // ── Filler traders with confirmed payments (admin looks alive) ──
  for (const [user, pkg, acc, start] of [
    [t1, pkgTwo25k, "demo_t1_25k", d10],
    [t2, pkgOne10k, "demo_t2_10k", d3],
  ] as const) {
    const exists = await db.challenge.findFirst({
      where: { brokerAccountId: acc },
    });
    if (exists) continue;
    const ch = await db.challenge.create({
      data: {
        userId: user.id,
        packageId: pkg.id,
        type: pkg.slug.startsWith("TWO") ? "TWO_STEP" : "ONE_STEP",
        phase: "PHASE_1",
        status: "ACTIVE",
        accountSize: pkg.accountSize,
        startBalance: pkg.accountSize,
        currentBalance: pkg.accountSize + 120,
        peakBalance: pkg.accountSize + 200,
        dailyStartBalance: pkg.accountSize + 50,
        profitTarget: Math.round(
          pkg.accountSize * (pkg.slug.startsWith("TWO") ? 1.08 : 1.1)
        ),
        maxDailyLoss: Math.round(pkg.accountSize * 0.05),
        maxTotalDrawdown: Math.round(pkg.accountSize * 0.1),
        consistencyPct: 40,
        minTradingDays: 5,
        tradingDaysDone: 2,
        lastTradeDay: now.toISOString().slice(0, 10),
        bestDayProfit: 80,
        brokerAccountId: acc,
        startedAt: start,
      },
    });
    await db.payment.create({
      data: {
        userId: user.id,
        challengeId: ch.id,
        amount: pkg.price,
        method: "USDT_TRC20",
        txHash: `demo_tx_${acc}`,
        status: "CONFIRMED",
        createdAt: start,
        confirmedAt: start,
      },
    });
    await db.trade.createMany({
      data: makeTrades(
        ch.id,
        `tr_${acc}`,
        [
          [60, -25, 85],
          [40, -20, -15],
        ],
        start
      ),
    });
  }
  console.log("✓ Filler traders with payments");

  // ── Support tickets ──
  const ticketCount = await db.supportTicket.count();
  if (ticketCount === 0) {
    const tk1 = await db.supportTicket.create({
      data: {
        userId: t1.id,
        subject: "Payout wallet change",
        messages: {
          create: {
            authorId: t1.id,
            authorRole: "TRADER",
            body: "Hi, I need to change my payout wallet address before the next withdrawal. Please advise.",
          },
        },
      },
    });
    await db.supportTicket.create({
      data: {
        userId: t2.id,
        subject: "Trade not syncing",
        status: "REPLIED",
        messages: {
          create: [
            {
              authorId: t2.id,
              authorRole: "TRADER",
              body: "My last 3 trades are not showing in the dashboard.",
            },
            {
              authorId: t1.id,
              authorRole: "ADMIN",
              body: "Please click Sync trades on your challenge page. If still missing, send your broker account ID.",
            },
          ],
        },
      },
    });
    void tk1;
    console.log("✓ Support tickets");
  }

  console.log("\nDemo data ready!");
  console.log("Demo login: demo@apexfunds.com / Demo@12345");
}

function d9(base: Date) {
  return new Date(base.getTime() + 86400000);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
