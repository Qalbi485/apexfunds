export type Category = "forex" | "crypto" | "metals";

export type SymbolInfo = {
  name: string;
  base: number;
  payout: number;
  decimals: number;
  category: Category;
  /** Volatility multiplier applied to the synthetic price waves. */
  vol: number;
  /** Swissquote/TwelveData instrument for the live feed (absent = synthetic only). */
  provider?: string;
};

export const CATEGORY_LABELS: Record<Category, string> = {
  forex: "Forex",
  crypto: "Crypto",
  metals: "Metals",
};

/**
 * Live universe: real market instruments only — forex majors/crosses plus
 * gold (XAU/USD) and bitcoin (BTC/USD). Every instrument is anchored to the
 * real market via the Swissquote bank feed.
 */
type ForexDef = {
  sym: string;
  name: string;
  base: number;
  decimals: number;
  provider: string;
};

const FOREX: ForexDef[] = [
  { sym: "EURUSD", name: "EUR/USD", base: 1.124, decimals: 5, provider: "EUR/USD" },
  { sym: "GBPUSD", name: "GBP/USD", base: 1.333, decimals: 5, provider: "GBP/USD" },
  { sym: "USDJPY", name: "USD/JPY", base: 157.99, decimals: 3, provider: "USD/JPY" },
  { sym: "AUDUSD", name: "AUD/USD", base: 0.695, decimals: 5, provider: "AUD/USD" },
  { sym: "USDCAD", name: "USD/CAD", base: 1.414, decimals: 5, provider: "USD/CAD" },
  { sym: "USDCHF", name: "USD/CHF", base: 0.824, decimals: 5, provider: "USD/CHF" },
  { sym: "NZDUSD", name: "NZD/USD", base: 0.566, decimals: 5, provider: "NZD/USD" },
  { sym: "EURGBP", name: "EUR/GBP", base: 0.843, decimals: 5, provider: "EUR/GBP" },
  { sym: "EURJPY", name: "EUR/JPY", base: 177.1, decimals: 3, provider: "EUR/JPY" },
  { sym: "EURCHF", name: "EUR/CHF", base: 0.926, decimals: 5, provider: "EUR/CHF" },
  { sym: "EURAUD", name: "EUR/AUD", base: 1.617, decimals: 5, provider: "EUR/AUD" },
  { sym: "EURCAD", name: "EUR/CAD", base: 1.589, decimals: 5, provider: "EUR/CAD" },
  { sym: "EURNZD", name: "EUR/NZD", base: 1.987, decimals: 5, provider: "EUR/NZD" },
  { sym: "GBPAUD", name: "GBP/AUD", base: 1.919, decimals: 5, provider: "GBP/AUD" },
  { sym: "GBPCAD", name: "GBP/CAD", base: 1.884, decimals: 5, provider: "GBP/CAD" },
  { sym: "GBPCHF", name: "GBP/CHF", base: 1.098, decimals: 5, provider: "GBP/CHF" },
  { sym: "GBPJPY", name: "GBP/JPY", base: 210.58, decimals: 3, provider: "GBP/JPY" },
  { sym: "GBPNZD", name: "GBP/NZD", base: 2.357, decimals: 5, provider: "GBP/NZD" },
  { sym: "AUDCAD", name: "AUD/CAD", base: 0.981, decimals: 5, provider: "AUD/CAD" },
  { sym: "AUDCHF", name: "AUD/CHF", base: 0.572, decimals: 5, provider: "AUD/CHF" },
  { sym: "AUDJPY", name: "AUD/JPY", base: 109.75, decimals: 3, provider: "AUD/JPY" },
  { sym: "AUDNZD", name: "AUD/NZD", base: 1.228, decimals: 5, provider: "AUD/NZD" },
  { sym: "NZDCAD", name: "NZD/CAD", base: 0.799, decimals: 5, provider: "NZD/CAD" },
  { sym: "NZDCHF", name: "NZD/CHF", base: 0.466, decimals: 5, provider: "NZD/CHF" },
  { sym: "NZDJPY", name: "NZD/JPY", base: 89.31, decimals: 3, provider: "NZD/JPY" },
  { sym: "CADCHF", name: "CAD/CHF", base: 0.583, decimals: 5, provider: "CAD/CHF" },
  { sym: "CADJPY", name: "CAD/JPY", base: 111.71, decimals: 3, provider: "CAD/JPY" },
  { sym: "CHFJPY", name: "CHF/JPY", base: 191.77, decimals: 3, provider: "CHF/JPY" },
];

const METALS: ForexDef[] = [
  { sym: "XAUUSD", name: "Gold", base: 4300.55, decimals: 2, provider: "XAU/USD" },
];

const CRYPTO: ForexDef[] = [
  { sym: "BTCUSD", name: "Bitcoin", base: 98250.5, decimals: 1, provider: "BTC/USD" },
];

export const SYMBOLS: Record<string, SymbolInfo> = {};
for (const f of FOREX) {
  SYMBOLS[f.sym] = {
    name: f.name,
    base: f.base,
    payout: 85,
    decimals: f.decimals,
    category: "forex",
    vol: 1,
    provider: f.provider,
  };
}
for (const m of METALS) {
  SYMBOLS[m.sym] = {
    name: m.name,
    base: m.base,
    payout: 85,
    decimals: m.decimals,
    category: "metals",
    vol: 1.25,
    provider: m.provider,
  };
}
for (const c of CRYPTO) {
  SYMBOLS[c.sym] = {
    name: c.name,
    base: c.base,
    payout: 85,
    decimals: c.decimals,
    category: "crypto",
    vol: 2.4,
    provider: c.provider,
  };
}

export const SYMBOL_LIST = Object.keys(SYMBOLS);

export function isKnownSymbol(symbol: string): boolean {
  return !!SYMBOLS[symbol];
}

function seeded(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function symbolSeed(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) {
    h = (h * 31 + symbol.charCodeAt(i)) % 100000;
  }
  return h;
}

/**
 * Per-symbol price offsets that shift the synthetic series so it lines up
 * with the live market level. Populated at runtime by the market feed
 * (src/lib/feed.ts); left empty in tests / when offline so the pure synthetic
 * model — and therefore every determinism guarantee — is preserved.
 */
// Stored on globalThis so every bunded copy of this module (route handlers,
// instrumentation, client) shares the same offset map instead of each getting
// its own isolated instance.
const OFFSET_STORE = globalThis as unknown as {
  __apexLiveOffsets?: Record<string, number>;
};
const LIVE_OFFSETS: Record<string, number> = ((
  OFFSET_STORE.__apexLiveOffsets ??= {}
) as Record<string, number>);

/** Replace the live-offset map. Empty input clears all offsets. */
export function setLiveOffsets(next: Record<string, number>): void {
  for (const k of Object.keys(LIVE_OFFSETS)) delete LIVE_OFFSETS[k];
  for (const [k, v] of Object.entries(next)) {
    if (Number.isFinite(v) && SYMBOLS[k]) LIVE_OFFSETS[k] = v;
  }
}

/** Current live offset for a symbol (0 when none is set). */
export function liveOffsetOf(symbol: string): number {
  return LIVE_OFFSETS[symbol] || 0;
}

// ── Unpredictable price engine ────────────────────────────────────────
// The synthetic series must NOT be extrapolatable from the client bundle:
// a publicly-readable formula lets traders predict future prices and pass
// phases risk-free. Values are hashed with a server-only secret salt
// (PRICE_SALT env) across several time scales — continuous and
// deterministic on the server, unpredictable to anyone without the secret.
const PRICE_SALT =
  process.env.PRICE_SALT || "apex-demo-only-price-salt-change-me";

function hashUnit(symbol: string, scale: number, bucket: number): number {
  const str = `${PRICE_SALT}|${symbol}|${scale}|${bucket}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function smooth01(x: number): number {
  return x * x * (3 - 2 * x);
}

function valueNoise(symbol: string, tSec: number, period: number): number {
  const x = tSec / period;
  const i = Math.floor(x);
  const f = smooth01(x - i);
  const a = hashUnit(symbol, period, i) * 2 - 1;
  const b = hashUnit(symbol, period, i + 1) * 2 - 1;
  return a + (b - a) * f;
}

/**
 * Pure synthetic price at an exact timestamp — deterministic on the server
 * (same input → same output), unpredictable without PRICE_SALT.
 */
export function syntheticPriceAt(symbol: string, tMs: number): number {
  const s = SYMBOLS[symbol];
  if (!s) return 0;
  const t = tMs / 1000;
  const v = s.vol;
  const wave =
    valueNoise(symbol, t, 1800) * 0.0024 +
    valueNoise(symbol, t, 420) * 0.0011 +
    valueNoise(symbol, t, 90) * 0.00055 +
    valueNoise(symbol, t, 15) * 0.00022;
  return s.base * (1 + wave * v);
}

export function isLiveSymbol(symbol: string): boolean {
  return !!SYMBOLS[symbol]?.provider;
}

/**
 * Standard spot-forex trading hours (UTC): opens Sunday 21:00 UTC, closes
 * Friday 21:00 UTC. Live symbols are frozen whenever the real market is closed
 * so the app never shows fake weekend movement.
 */
export function forexMarketOpen(tMs: number = Date.now()): boolean {
  const d = new Date(tMs);
  const day = d.getUTCDay();
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  if (day === 6) return false;
  if (day === 5 && hour >= 21) return false;
  if (day === 0 && hour < 21) return false;
  return true;
}

/** Crypto trades 24/7; everything else follows forex hours. */
export function marketOpenFor(symbol: string, tMs: number = Date.now()): boolean {
  if (SYMBOLS[symbol]?.category === "crypto") return true;
  return forexMarketOpen(tMs);
}

/**
 * Deterministic price at an exact timestamp.
 *
 * Live-anchored symbols (real feed) return the last real price observed from
 * the feed, shifted off the symbol's base — so they tick with the real market
 * and FREEZE exactly when the real market is closed (weekend), instead of
 * drifting on the synthetic wave engine. Any live symbol with no feed value
 * yet (e.g. in tests/offline) uses the pure synthetic series.
 */
export function priceAt(symbol: string, tMs: number): number {
  const s = SYMBOLS[symbol];
  if (!s) return 0;
  if (s.provider) {
    const off = LIVE_OFFSETS[symbol];
    if (off !== undefined) return s.base + off;
  }
  return syntheticPriceAt(symbol, tMs);
}

export function fmtPrice(symbol: string, price: number): string {
  const s = SYMBOLS[symbol];
  if (!s) return price.toFixed(2);
  return price.toFixed(s.decimals);
}

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/**
 * Builds `count` candles ending at the candle containing `now`.
 * Works for any point in time — pass a past timestamp to browse history.
 * Intra-candle sampling scales with the timeframe so 1h/4h/1D candles get
 * realistic wicks, and every candle carries deterministic volume.
 */
export function buildCandles(
  symbol: string,
  now: number,
  count: number,
  intervalMs: number
): Candle[] {
  return buildCandlesWith(symbol, now, count, intervalMs, priceAt);
}

/**
 * Synthetic series shifted by the live offset — a moving, market-level-anchored
 * fallback for live symbols when real candles cannot be fetched (e.g. no
 * TWELVEDATA_API_KEY). Keeps the chart alive instead of flat.
 */
export function buildCandlesAnchored(
  symbol: string,
  now: number,
  count: number,
  intervalMs: number
): Candle[] {
  return buildCandlesWith(
    symbol,
    now,
    count,
    intervalMs,
    (sym, t) => syntheticPriceAt(sym, t) + (LIVE_OFFSETS[sym] ?? 0)
  );
}

/**
 * A flat series at a single price — used to freeze live symbols when the real
 * market is closed and no real candle feed is available.
 */
export function buildFlatCandles(
  symbol: string,
  now: number,
  count: number,
  intervalMs: number,
  price: number
): Candle[] {
  const p = price > 0 ? price : SYMBOLS[symbol]?.base ?? 1;
  return buildCandlesWith(symbol, now, count, intervalMs, () => p);
}

function buildCandlesWith(
  symbol: string,
  now: number,
  count: number,
  intervalMs: number,
  priceOf: (symbol: string, tMs: number) => number
): Candle[] {
  const candles: Candle[] = [];
  const currentSlot = Math.floor(now / intervalMs) * intervalMs;
  const samples = Math.min(48, Math.max(6, Math.round(intervalMs / 4000)));
  const s = SYMBOLS[symbol];
  const seed = symbolSeed(symbol);

  for (let i = count - 1; i >= 0; i--) {
    const start = currentSlot - i * intervalMs;
    const end = start + intervalMs;
    const open = priceOf(symbol, start);
    const close = priceOf(symbol, Math.min(end, now));
    let high = Math.max(open, close);
    let low = Math.min(open, close);
    for (let j = 1; j < samples; j++) {
      const t = start + (intervalMs * j) / samples;
      if (t > now) break;
      const p = priceOf(symbol, t);
      if (p > high) high = p;
      if (p < low) low = p;
    }
    const base = s?.base || 1;
    const bodyMove = Math.abs(close - open) / (base * 0.0007);
    const vr = seeded(Math.floor(start / 1000) + seed * 13 + intervalMs / 1000);
    const volume = Math.round(400 + vr * 900 + Math.min(bodyMove, 6) * 160);
    candles.push({ time: start, open, high, low, close, volume });
  }
  return candles;
}

export function symbolChangePct(symbol: string, now: number): number {
  const hourAgo = priceAt(symbol, now - 3600000);
  const cur = priceAt(symbol, now);
  return ((cur - hourAgo) / hourAgo) * 100;
}

/** Floor a timestamp to the timeframe boundary. */
export function alignTf(tMs: number, tfMs: number): number {
  return Math.floor(tMs / tfMs) * tfMs;
}

/** Milliseconds until the current candle closes (for close countdowns). */
export function candleCloseIn(nowMs: number, tfMs: number): number {
  return Math.max(0, tfMs - (nowMs - alignTf(nowMs, tfMs)));
}

export const TIMEFRAMES = [
  { label: "5s", ms: 5_000 },
  { label: "15s", ms: 15_000 },
  { label: "30s", ms: 30_000 },
  { label: "1m", ms: 60_000 },
  { label: "5m", ms: 300_000 },
  { label: "15m", ms: 900_000 },
  { label: "30m", ms: 1_800_000 },
  { label: "1h", ms: 3_600_000 },
  { label: "4h", ms: 14_400_000 },
  { label: "1D", ms: 86_400_000 },
] as const;

export const DURATIONS = [
  { label: "30s", sec: 30 },
  { label: "1m", sec: 60 },
  { label: "2m", sec: 120 },
  { label: "5m", sec: 300 },
] as const;
