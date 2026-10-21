import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@/lib/auth";
import { settleTerminalTrade } from "@/lib/trading";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

export async function POST(request: NextRequest) {
  const session = await verifySession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await consumeRateLimit(
    `trade:settle:${session.sub}`,
    RATE_LIMITS.tradeSettle
  );
  if (!rl.ok)
    return NextResponse.json(
      { error: `Rate limit — retry in ${rl.retryAfterSec}s` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );

  const body = await request.json().catch(() => null);
  const tradeId = String(body?.tradeId || "");
  if (!tradeId)
    return NextResponse.json({ error: "tradeId required" }, { status: 400 });

  const result = await settleTerminalTrade(session.sub, tradeId);
  if ("error" in result)
    return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json(result);
}
