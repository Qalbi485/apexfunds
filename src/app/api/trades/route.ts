import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { verifySession } from "@/lib/auth";
import { openTerminalTrade } from "@/lib/trading";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

export async function GET(request: NextRequest) {
  const session = await verifySession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const challengeId = request.nextUrl.searchParams.get("challengeId");
  if (!challengeId)
    return NextResponse.json({ error: "challengeId required" }, { status: 400 });

  const challenge = await db.challenge.findUnique({
    where: { id: challengeId },
  });
  if (!challenge || challenge.userId !== session.sub)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [open, closed] = await Promise.all([
    db.trade.findMany({
      where: { challengeId, status: "OPEN" },
      orderBy: { openedAt: "desc" },
    }),
    db.trade.findMany({
      where: { challengeId, status: "CLOSED" },
      orderBy: { closedAt: "desc" },
      take: 15,
    }),
  ]);

  return NextResponse.json({
    open,
    closed,
    challenge: {
      id: challenge.id,
      name: challenge.packageId,
      status: challenge.status,
      phase: challenge.phase,
      currentBalance: challenge.currentBalance,
      startBalance: challenge.startBalance,
      paidWithdrawals: challenge.paidWithdrawals,
      reservedExposure: challenge.reservedExposure,
      available:
        Math.round(
          (challenge.currentBalance -
            challenge.paidWithdrawals -
            challenge.reservedExposure) *
            100
        ) / 100,
      profitTarget: challenge.profitTarget,
      maxDailyLoss: challenge.maxDailyLoss,
      maxTotalDrawdown: challenge.maxTotalDrawdown,
      breachReason: challenge.breachReason,
    },
  });
}

export async function POST(request: NextRequest) {
  const session = await verifySession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await consumeRateLimit(
    `trade:open:${session.sub}`,
    RATE_LIMITS.tradeOpen
  );
  if (!rl.ok)
    return NextResponse.json(
      { error: `Rate limit — retry in ${rl.retryAfterSec}s` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );

  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const result = await openTerminalTrade({
    userId: session.sub,
    challengeId: String(body.challengeId || ""),
    symbol: String(body.symbol || ""),
    direction: body.direction === "DOWN" ? "DOWN" : "UP",
    stake: Number(body.stake),
    durationSec: Number(body.durationSec),
  });

  if ("error" in result)
    return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json(result);
}
