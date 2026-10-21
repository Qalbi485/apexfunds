import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Liveness/readiness probe for nginx/PM2/uptime monitors. Deliberately
 * minimal: no configuration values, no counts of sensitive entities, no
 * headers echo. `ok:false` with 503 lets a load balancer pull the node.
 */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json(
      {
        ok: true,
        db: "up",
        uptimeSec: Math.round(process.uptime()),
        at: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { ok: false, db: "down", error: "unavailable" },
      { status: 503 }
    );
  }
}
