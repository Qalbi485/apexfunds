import { NextResponse, type NextRequest } from "next/server";
import { priceAt, SYMBOLS } from "@/lib/market";
import {
  startFeed,
  refreshAnchors,
  refreshOne,
  getOffsets,
  getChanges,
  getPrices,
  feedStatus,
} from "@/lib/feed";

export const dynamic = "force-dynamic";

/**
 * Live market snapshot: per-symbol offsets (shift the synthetic price engine so
 * it tracks the real market), real day-change percentages, and last real
 * prices.
 *
 * - No query: returns the whole watchlist (refreshed in the background).
 * - `?symbol=EURUSD`: refreshes and returns just that pair, so the chart being
 *   watched tracks the real market in near real-time (~1s).
 */
export async function GET(request: NextRequest) {
  startFeed();
  const symbol = request.nextUrl.searchParams.get("symbol");

  if (symbol) {
    try {
      await refreshOne(symbol);
    } catch {
      // best-effort; keep last known offset
    }
  } else if (Object.keys(getOffsets()).length === 0) {
    try {
      await refreshAnchors();
    } catch {
      // best-effort; fall back to empty offsets
    }
  }

  const now = Date.now();
  // Server-computed tradeable prices (secret-salted engine). The client can
  // never derive future prices locally — it only ever sees this snapshot.
  const tick: Record<string, number> = {};
  for (const sym of Object.keys(SYMBOLS)) tick[sym] = priceAt(sym, now);

  return NextResponse.json(
    {
      offsets: getOffsets(),
      changes: getChanges(),
      prices: getPrices(),
      tick,
      status: feedStatus(),
      at: now,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
