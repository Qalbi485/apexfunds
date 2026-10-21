import { SYMBOLS, type Candle } from "./market";

/**
 * TwelveData real candle history (free tier, requires TWELVEDATA_API_KEY).
 *
 * The live price comes from the Swissquote bank feed in feed.ts; TwelveData
 * only supplies real historical OHLC candles, which the /api/candles route
 * merges with the current live price to form the still-open last candle.
 */

const INTERVAL: Record<string, string> = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1h",
  "4h": "4h",
  "1D": "1day",
};

/** TwelveData interval for a UI timeframe label (null = not supported: 5s/15s/30s). */
export function tdInterval(tfLabel: string): string | null {
  return INTERVAL[tfLabel] ?? null;
}

type Entry = { at: number; candles: Candle[] };

const CACHE_MS = 10_000;
// Cache lives on globalThis so the dev/prod bundler can't duplicate it.
const STORE = globalThis as unknown as { __apexTdCache?: Map<string, Entry> };
const cache: Map<string, Entry> = (STORE.__apexTdCache ??= new Map());

function parseTime(raw: string): number {
  const s = raw.includes(" ") ? raw : `${raw} 00:00:00`;
  return Date.parse(`${s.replace(" ", "T")}Z`);
}

/**
 * Fetch real candles for a live symbol. Returns null on any failure (missing
 * key, unsupported interval, rate limit, network) so the caller can fall back
 * to the synthetic engine. Results are cached ~10s (free tier = 8 req/min).
 */
export async function fetchRealCandles(
  symbol: string,
  tfLabel: string,
  limit: number
): Promise<Candle[] | null> {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) return null;
  const interval = tdInterval(tfLabel);
  const provider = SYMBOLS[symbol]?.provider;
  if (!interval || !provider) return null;

  const ck = `${provider}:${interval}`;
  const now = Date.now();
  const hit = cache.get(ck);
  if (hit && now - hit.at < CACHE_MS && hit.candles.length >= limit) {
    return hit.candles;
  }

  try {
    const url =
      `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(provider)}` +
      `&interval=${interval}&outputsize=${Math.min(5000, Math.max(limit, 30))}` +
      `&timezone=UTC&order=asc&apikey=${key}`;
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      status?: string;
      values?: Array<Record<string, string>>;
    };
    if (j.status === "error" || !Array.isArray(j.values)) return null;

    const out: Candle[] = [];
    for (const v of j.values) {
      const t = parseTime(v.datetime);
      const open = Number(v.open);
      const high = Number(v.high);
      const low = Number(v.low);
      const close = Number(v.close);
      if (!Number.isFinite(t) || !Number.isFinite(close)) continue;
      const rawVol = Number(v.volume);
      // Forex has no real volume — derive a plausible value from the range so
      // the volume pane stays meaningful.
      let volume = Number.isFinite(rawVol) && rawVol > 0 ? rawVol : 0;
      if (!volume) {
        const base = close || 1;
        const range = Math.abs(high - low) / (base * 0.0001);
        const body = Math.abs(close - open) / (base * 0.0001);
        volume = Math.round(300 + Math.min(range, 300) * 12 + Math.min(body, 300) * 18);
      }
      out.push({ time: t, open, high, low, close, volume });
    }
    if (!out.length) return null;
    out.sort((a, b) => a.time - b.time);
    cache.set(ck, { at: now, candles: out });
    return out;
  } catch {
    return null;
  }
}
