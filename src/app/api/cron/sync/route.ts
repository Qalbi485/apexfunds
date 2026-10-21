import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { syncChallenge } from "@/lib/sync";
import { consumeRateLimit, RATE_LIMITS, pickClientIp } from "@/lib/ratelimit";
import { logger } from "@/lib/logger";
import { assertProductionSecret } from "@/lib/config";

// Production startup guard: refuse to boot with a missing/weak/placeholder
// cron secret (Phase D). The value itself is never printed.
assertProductionSecret("CRON_SECRET", process.env.CRON_SECRET);

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = pickClientIp(
    request.headers.get("x-forwarded-for"),
    request.headers.get("x-real-ip")
  );
  const rl = await consumeRateLimit(`cron:ip:${ip}`, RATE_LIMITS.cron);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Rate limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const challenges = await db.challenge.findMany({
    where: { status: { in: ["ACTIVE", "FUNDED"] } },
    select: { id: true },
  });

  let synced = 0;
  let newTrades = 0;
  const errors: string[] = [];

  for (const c of challenges) {
    // A single broken challenge (broker error, DB hiccup) must never fail
    // the whole cron run — isolate and report instead.
    try {
      const result = await syncChallenge(c.id);
      if (result.ok) {
        synced++;
        newTrades += result.newTrades || 0;
      } else if (result.error) {
        errors.push(`${c.id}: ${result.error}`);
      }
    } catch (e) {
      const msg = (e as Error).message;
      errors.push(`${c.id}: ${msg}`);
      logger.error("cron_sync_challenge_failed", { challengeId: c.id, error: msg });
    }
  }

  return NextResponse.json({
    ok: true,
    total: challenges.length,
    synced,
    newTrades,
    errors: errors.slice(0, 20),
    at: new Date().toISOString(),
  });
}
