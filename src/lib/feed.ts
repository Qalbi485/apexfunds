import { SYMBOLS, setLiveOffsets } from "./market";

/**
 * Live market feed — server-side.
 *
 * Real reference prices come from Swissquote's public BBO feed (bank quotes,
 * no API key). We compute a per-symbol offset so the deterministic synthetic
 * engine lines up with the live level; the offset is applied everywhere
 * (chart, price display, trade entry & settlement) via market.priceAt(), which
 * keeps the whole system internally consistent while showing real prices.
 *
 * All state lives on globalThis because Next.js bundles instrumentation and
 * route handlers separately — module-level state would otherwise be duplicated.
 *
 * If the upstream feed is unreachable the offsets keep their last good value,
 * or stay empty and the app keeps working on the pure synthetic feed.
 */

type FeedState = {
  offsets: Record<string, number>;
  changes: Record<string, number>;
  prices: Record<string, number>;
  /** Per-symbol recent real ticks (for building real sub-minute candles). */
  ticks: Record<string, { t: number; p: number }[]>;
  /** Per-instrument short-lived quote cache to avoid hammering upstream. */
  cache: Record<string, { at: number; price: number }>;
  /** Per-symbol reference price for the intraday change %. */
  refs: Record<string, { day: string; price: number }>;
  updatedAt: number;
  refreshing: boolean;
  started: boolean;
  lastError: string | null;
};

const FULL_REFRESH_MS = 60_000;
const CACHE_MS = 900;
const CONCURRENCY = 6;

function getState(): FeedState {
  const g = globalThis as unknown as { __apexFeedState?: FeedState };
  return (g.__apexFeedState ??= {
    offsets: {},
    changes: {},
    prices: {},
    ticks: {},
    cache: {},
    refs: {},
    updatedAt: 0,
    refreshing: false,
    started: false,
    lastError: null,
  });
}

function liveSymbols(): string[] {
  return Object.keys(SYMBOLS).filter((s) => !!SYMBOLS[s].provider);
}

function dayKeyStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Run `fn` over `items` with a bounded number of in-flight calls. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return out;
}

/** Fetch the mid price for one instrument from Swissquote (bank BBO feed). */
async function fetchQuote(instrument: string): Promise<number | null> {
  const st = getState();
  const now = Date.now();
  const cached = st.cache[instrument];
  if (cached && now - cached.at < CACHE_MS) return cached.price;

  try {
    const url = `https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${instrument}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ApexFundsFeed/1.0)" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      st.lastError = `${instrument}: HTTP ${res.status}`;
      return null;
    }
    const arr = (await res.json()) as Array<{
      spreadProfilePrices?: Array<{ bid: number; ask: number }>;
    }>;
    const row = Array.isArray(arr) ? arr[0] : null;
    const profiles = row?.spreadProfilePrices;
    if (!Array.isArray(profiles) || profiles.length === 0) {
      st.lastError = `${instrument}: no quotes`;
      return null;
    }
    // Tightest spread = best mid.
    let best = profiles[0];
    for (const p of profiles) {
      if (p.ask - p.bid < best.ask - best.bid) best = p;
    }
    const price = (best.bid + best.ask) / 2;
    if (!Number.isFinite(price) || price <= 0) {
      st.lastError = `${instrument}: invalid price`;
      return null;
    }
    st.cache[instrument] = { at: now, price };
    return price;
  } catch (e) {
    st.lastError = `${instrument}: ${(e as Error).message}`;
    return null;
  }
}

function record(
  symbol: string,
  price: number,
  now: number,
  offsets: Record<string, number>,
  changes: Record<string, number>,
  prices: Record<string, number>
): void {
  const st = getState();
  const s = SYMBOLS[symbol];
  // Offset is relative to the (constant) base so priceAt() returns the real
  // price directly — no synthetic drift while the market is closed.
  offsets[symbol] = price - (s?.base ?? price);
  const day = dayKeyStr(now);
  let ref = st.refs[symbol];
  // Keep an explicitly-seeded previous close; otherwise fall back to the
  // first price seen today.
  if (!ref || (ref.day !== day && ref.day !== "PREVCLOSE")) {
    ref = { day, price };
    st.refs[symbol] = ref;
  }
  changes[symbol] =
    ref.price > 0
      ? Math.round((price / ref.price - 1) * 10000) / 100
      : 0;
  prices[symbol] = price;

  // Record a real tick so sub-minute candles can be built from observed prices.
  const buf = (st.ticks[symbol] ??= []);
  const last = buf[buf.length - 1];
  if (!last || last.p !== price || now - last.t > 500) {
    buf.push({ t: now, p: price });
    if (buf.length > 2400) buf.splice(0, buf.length - 2400);
    const cutoff = now - 30 * 60_000;
    while (buf.length > 1 && buf[0].t < cutoff) buf.shift();
  }
}

/**
 * Refresh a single symbol (used for the chart the trader is watching) so its
 * price tracks the real market in near real-time.
 */
export async function refreshOne(symbol: string): Promise<void> {
  const s = SYMBOLS[symbol];
  if (!s?.provider) return;
  const st = getState();
  const now = Date.now();
  const price = await fetchQuote(s.provider);
  if (price == null) return;
  const offsets = { ...st.offsets };
  const changes = { ...st.changes };
  const prices = { ...st.prices };
  record(symbol, price, now, offsets, changes, prices);
  st.offsets = offsets;
  st.changes = changes;
  st.prices = prices;
  st.lastError = null;
  setLiveOffsets(offsets);
}

/** Refresh the whole watchlist. */
export async function refreshAnchors(): Promise<void> {
  const st = getState();
  if (st.refreshing) return;
  st.refreshing = true;
  try {
    const syms = liveSymbols();
    const now = Date.now();
    const results = await mapLimit(syms, CONCURRENCY, async (s) => ({
      s,
      price: await fetchQuote(SYMBOLS[s].provider as string),
    }));

    const offsets = { ...st.offsets };
    const changes = { ...st.changes };
    const prices = { ...st.prices };
    let got = 0;
    for (const { s, price } of results) {
      if (price == null) continue;
      got++;
      record(s, price, now, offsets, changes, prices);
    }
    if (got > 0) {
      st.offsets = offsets;
      st.changes = changes;
      st.prices = prices;
      st.updatedAt = now;
      st.lastError = null;
      setLiveOffsets(offsets);
    }
  } finally {
    st.refreshing = false;
  }
}

/**
 * Seed each symbol's reference with the previous day's close (from Yahoo's
 * chart metadata) so the intraday change % is meaningful from the first tick.
 */
async function seedPrevCloses(): Promise<void> {
  const st = getState();
  const syms = liveSymbols();
  await mapLimit(syms, CONCURRENCY, async (s) => {
    const inst = SYMBOLS[s].provider as string;
    // Yahoo tickers: forex/XAU via "=X" suffix; bitcoin uses its own format.
    const yahoo =
      inst === "BTC/USD"
        ? "BTC-USD"
        : inst === "XAU/USD"
          ? "GC=F"
          : `${inst.replace("/", "")}=X`;
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${yahoo}?interval=1d&range=5d`,
        {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; ApexFundsFeed/1.0)" },
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        }
      );
      if (!res.ok) return;
      const j = (await res.json()) as {
        chart?: {
          result?: Array<{ meta?: { chartPreviousClose?: number } }>;
        };
      };
      const pc = j?.chart?.result?.[0]?.meta?.chartPreviousClose;
      if (typeof pc === "number" && pc > 0) {
        st.refs[s] = { day: "PREVCLOSE", price: pc };
      }
    } catch {
      // best-effort; fall back to first-seen reference
    }
  });
}

/** Idempotent. Starts the background refresh loop for the process lifetime. */
export function startFeed(): void {
  const st = getState();
  if (st.started) return;
  st.started = true;
  void seedPrevCloses().then(() => refreshAnchors());
  setInterval(() => void refreshAnchors(), FULL_REFRESH_MS);
  setInterval(() => void seedPrevCloses(), 6 * 60 * 60_000);
}

export function getOffsets(): Record<string, number> {
  return getState().offsets;
}

export function getChanges(): Record<string, number> {
  return getState().changes;
}

export function getPrices(): Record<string, number> {
  return getState().prices;
}

export function getTicks(symbol: string): { t: number; p: number }[] {
  return getState().ticks[symbol] || [];
}

export function feedStatus(): {
  live: string[];
  updatedAt: number;
  count: number;
  lastError: string | null;
} {
  const st = getState();
  return {
    live: liveSymbols(),
    updatedAt: st.updatedAt,
    count: Object.keys(st.offsets).length,
    lastError: st.lastError,
  };
}
