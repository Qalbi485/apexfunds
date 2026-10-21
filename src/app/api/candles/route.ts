import { NextResponse, type NextRequest } from "next/server";
import {
  buildCandles,
  buildCandlesAnchored,
  buildFlatCandles,
  marketOpenFor,
  isKnownSymbol,
  isLiveSymbol,
  TIMEFRAMES,
  type Candle,
} from "@/lib/market";
import { fetchRealCandles, tdInterval } from "@/lib/twelvedata";
import { getPrices, getTicks } from "@/lib/feed";

export const dynamic = "force-dynamic";

/**
 * Candles for the chart.
 *
 * - Live symbols (forex, gold, bitcoin) → REAL candles (TwelveData history
 *   merged with the current Swissquote live price for the still-open candle).
 *   Sub-minute timeframes (5s/15s/30s) are built from real ticks observed by
 *   the feed.
 * - Historical browsing or when the live sources are unavailable → the
 *   deterministic synthetic engine (unchanged).
 */

/** Build candles from real ticks recorded by the feed (sub-minute timeframes). */
function candlesFromTicks(
  ticks: { t: number; p: number }[],
  end: number,
  count: number,
  tfMs: number,
  fallback: number
): Candle[] {
  const lastSlot = Math.floor(end / tfMs) * tfMs;
  const first = ticks.length ? ticks[0].p : fallback;
  const out: Candle[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = lastSlot - i * tfMs;
    const stop = start + tfMs;
    let open = NaN;
    let high = -Infinity;
    let low = Infinity;
    let close = NaN;
    let n = 0;
    for (const tk of ticks) {
      if (tk.t < start || tk.t >= stop) continue;
      if (n === 0) {
        open = tk.p;
        high = tk.p;
        low = tk.p;
      }
      if (tk.p > high) high = tk.p;
      if (tk.p < low) low = tk.p;
      close = tk.p;
      n++;
    }
    if (n === 0) {
      const p = start < (ticks[0]?.t ?? Infinity) ? first : fallback;
      open = high = low = close = p;
    }
    out.push({ time: start, open, high, low, close, volume: n });
  }
  return out;
}

/** Merge real history with the live price, filling gaps up to the open candle. */
function mergeLive(
  real: Candle[],
  symbol: string,
  tfMs: number,
  limit: number,
  now: number
): Candle[] {
  const slot = Math.floor(now / tfMs) * tfMs;
  const price = getPrices()[symbol];
  const arr = real.filter((c) => c.time < slot).slice();
  const prev = arr.length
    ? arr[arr.length - 1].close
    : real[real.length - 1]?.close ?? price ?? 0;

  const lastReal = arr.length ? arr[arr.length - 1].time : null;
  if (lastReal != null) {
    let filled = 0;
    for (let t = lastReal + tfMs; t < slot && filled < 2000; t += tfMs) {
      arr.push({ time: t, open: prev, high: prev, low: prev, close: prev, volume: 0 });
      filled++;
    }
  }

  const existing = real.find((c) => c.time === slot);
  const live = price && price > 0 ? price : prev;
  const open = existing ? existing.open : prev;
  let high = Math.max(open, live);
  let low = Math.min(open, live);
  if (existing) {
    high = Math.max(high, existing.high);
    low = Math.min(low, existing.low);
  }
  arr.push({
    time: slot,
    open,
    high,
    low,
    close: live,
    volume: existing?.volume ?? 0,
  });
  return arr.slice(-limit);
}

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const symbol = p.get("symbol") || "";
  const tfLabel = p.get("tf") || "1m";
  const limitRaw = Number(p.get("limit") || 300);
  const endRaw = p.get("end");

  if (!isKnownSymbol(symbol))
    return NextResponse.json({ error: "Unknown symbol" }, { status: 400 });

  const tf = TIMEFRAMES.find((t) => t.label === tfLabel);
  if (!tf)
    return NextResponse.json({ error: "Unknown timeframe" }, { status: 400 });

  const limit = Math.min(1000, Math.max(1, Math.round(limitRaw || 300)));
  const now = Date.now();
  let end = now;
  const browsing =
    endRaw !== null && endRaw !== undefined && endRaw !== "";
  if (browsing) {
    const n = Number(endRaw);
    if (!Number.isFinite(n) || n <= 0 || n > now + tf.ms)
      return NextResponse.json({ error: "Invalid end" }, { status: 400 });
    end = Math.round(n);
  }

  let candles: Candle[] | null = null;
  let isReal = false;

  if (isLiveSymbol(symbol) && !browsing) {
    if (tdInterval(tfLabel)) {
      const real = await fetchRealCandles(symbol, tfLabel, limit);
      if (real && real.length) {
        candles = mergeLive(real, symbol, tf.ms, limit, now);
        isReal = true;
      }
    } else {
      const ticks = getTicks(symbol);
      if (ticks.length) {
        candles = candlesFromTicks(
          ticks,
          end,
          limit,
          tf.ms,
          getPrices()[symbol] || ticks[ticks.length - 1].p
        );
        isReal = true;
      }
    }
  }

  if (!candles) {
    if (isLiveSymbol(symbol)) {
      const p = getPrices()[symbol] || 0;
      // Freeze live symbols when the real market is closed (weekend) so no
      // fake movement is ever shown without a real candle feed. Crypto (24/7)
      // never freezes.
      candles = !marketOpenFor(symbol, now)
        ? buildFlatCandles(symbol, end, limit, tf.ms, p)
        : buildCandlesAnchored(symbol, end, limit, tf.ms);
    } else {
      candles = buildCandles(symbol, end, limit, tf.ms);
    }
  }

  return NextResponse.json(
    {
      symbol,
      tf: tf.label,
      tfMs: tf.ms,
      end,
      count: candles.length,
      real: isReal,
      candles,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
