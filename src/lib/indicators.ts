import type { Candle } from "./market";

/** Aligned series — null where the indicator has no value yet (warm-up). */
export type Series = (number | null)[];

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** SMA over the defined segment of an aligned series (signal smoothing). */
function smaDefined(vals: Series, period: number): Series {
  const out: Series = new Array(vals.length).fill(null);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (v === null) continue;
    sum += v;
    n++;
    if (n > period) {
      const dropIdx = i - period;
      sum -= (vals[dropIdx] as number);
      n--;
    }
    if (n === period) out[i] = sum / period;
  }
  return out;
}

/** EMA over the defined segment of an aligned series (MACD signal line). */
function emaDefined(vals: Series, period: number): Series {
  const out: Series = new Array(vals.length).fill(null);
  const first: number[] = [];
  let firstIdx = -1;
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] !== null) {
      if (firstIdx < 0) firstIdx = i;
      first.push(vals[i] as number);
    }
  }
  if (firstIdx < 0 || first.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += first[i];
  let prev = sum / period;
  out[firstIdx + period - 1] = prev;
  for (let i = period; i < first.length; i++) {
    prev = first[i] * k + prev * (1 - k);
    out[firstIdx + i] = prev;
  }
  return out;
}

/** Wilder RSI. */
export function rsi(candles: Candle[], period = 14): Series {
  const out: Series = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].close - candles[i - 1].close;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgG = gain / period;
  let avgL = loss / period;
  const rs = () => (avgL === 0 ? 100 : avgG / avgL);
  out[period] = 100 - 100 / (1 + rs());
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i].close - candles[i - 1].close;
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = 100 - 100 / (1 + rs());
  }
  return out;
}

export function macd(
  candles: Candle[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): { macd: Series; signal: Series; hist: Series } {
  const closes = candles.map((c) => c.close);
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const line: Series = closes.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null
      ? (emaFast[i] as number) - (emaSlow[i] as number)
      : null
  );
  const signal = emaDefined(line, signalPeriod);
  const hist: Series = line.map((v, i) =>
    v !== null && signal[i] !== null ? v - (signal[i] as number) : null
  );
  return { macd: line, signal, hist };
}

export function bollinger(
  candles: Candle[],
  period = 20,
  mult = 2
): { upper: Series; mid: Series; lower: Series } {
  const closes = candles.map((c) => c.close);
  const mid = sma(closes, period);
  const upper: Series = new Array(closes.length).fill(null);
  const lower: Series = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const m = mid[i] as number;
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j] - m;
      acc += d * d;
    }
    const sd = Math.sqrt(acc / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { upper, mid, lower };
}

export function stochastic(
  candles: Candle[],
  kPeriod = 14,
  smoothK = 3,
  dPeriod = 3
): { k: Series; d: Series } {
  const raw: Series = new Array(candles.length).fill(null);
  for (let i = kPeriod - 1; i < candles.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (candles[j].high > hh) hh = candles[j].high;
      if (candles[j].low < ll) ll = candles[j].low;
    }
    // Float dust on high-priced symbols can push this a hair outside 0..100.
    raw[i] =
      hh === ll
        ? 50
        : Math.min(100, Math.max(0, ((candles[i].close - ll) / (hh - ll)) * 100));
  }
  const k = smaDefined(raw, smoothK);
  const d = smaDefined(k, dPeriod);
  // Incremental smoothing accumulates float drift; keep the %K/%D band exact.
  const clamp: (s: Series) => Series = (s) =>
    s.map((v) => (v === null ? null : Math.min(100, Math.max(0, v))));
  return { k: clamp(k), d: clamp(d) };
}

/** Wilder ATR — overlay on the price pane (same scale as price). */
export function atr(candles: Candle[], period = 14): Series {
  const out: Series = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr = (i: number): number => {
    const c = candles[i];
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  };
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr(i);
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr(i)) / period;
    out[i] = prev;
  }
  return out;
}
