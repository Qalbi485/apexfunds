"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  LineStyle,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { TIMEFRAMES, type Candle } from "@/lib/market";

const UP = "#0FAF59";
const DOWN = "#FF4459";
const BG = "#1C1F2D";
const GRID = "rgba(50,55,74,0.5)";
const BORDER = "rgba(255,255,255,.08)";
const MUTED = "#8A8FA3";
const ACCENT = "#2B99FF";
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

type ToolId = "cursor" | "trend" | "hline" | "fibo" | "rect" | "text";
type DrawingType = "trend" | "hline" | "fibo" | "rect" | "text";
type Pt = { time: Time; price: number };
type Drawing = { id: string; type: DrawingType; a: Pt; b?: Pt; text?: string };

export type TradeOverlay = {
  entryPrice: number;
  openedAt: number; // ms epoch
  expiryAt: number; // ms epoch
  direction: string; // UP | DOWN
};

function rr(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const TOOLS: { id: ToolId; label: string; d: string }[] = [
  {
    id: "cursor",
    label: "Cursor / pan",
    d: "M12 4v16M4 12h16M12 4l-2.5 2.5M12 4l2.5 2.5M12 20l-2.5-2.5M12 20l2.5-2.5M4 12l2.5-2.5M4 12l2.5 2.5M20 12l-2.5-2.5M20 12l-2.5 2.5",
  },
  { id: "trend", label: "Trend line", d: "M4 19L20 5M4 19l3-.4M4 19l.4-3M20 5l-3 .4M20 5l-.4 3" },
  { id: "hline", label: "Horizontal line", d: "M3 12h7m4 0h7M6 9v6M18 9v6" },
  { id: "fibo", label: "Fibonacci retracement", d: "M3 6h18M3 11h18M3 16h18M3 21h18" },
  { id: "rect", label: "Rectangle zone", d: "M4 7h16v10H4z" },
  { id: "text", label: "Text note", d: "M6 6h12M12 6v13M9.5 19h5" },
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  X: (t: Time) => number | null,
  Y: (p: number) => number | null,
  plotW: number
) {
  ctx.save();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = ACCENT;
  ctx.fillStyle = ACCENT;

  if (d.type === "hline") {
    const y = Y(d.a.price);
    if (y !== null) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(plotW, y);
      ctx.stroke();
      ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(d.a.price.toFixed(5), 4, y - 4);
    }
  } else if (d.type === "text") {
    const x = X(d.a.time);
    const y = Y(d.a.price);
    if (x !== null && y !== null) {
      ctx.fillStyle = "#F0B90B";
      ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(d.text ?? "", x + 4, y - 4);
    }
  } else if (d.b) {
    const x1 = X(d.a.time);
    const y1 = Y(d.a.price);
    const x2 = X(d.b.time);
    const y2 = Y(d.b.price);
    if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
      if (d.type === "trend") {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      } else if (d.type === "rect") {
        ctx.beginPath();
        ctx.rect(
          Math.min(x1, x2),
          Math.min(y1, y2),
          Math.abs(x2 - x1),
          Math.abs(y2 - y1)
        );
        ctx.fillStyle = "rgba(43,153,255,0.10)";
        ctx.fill();
        ctx.stroke();
      } else if (d.type === "fibo") {
        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        for (const L of FIB) {
          const price = d.a.price + (d.b.price - d.a.price) * L;
          const y = Y(price);
          if (y === null) continue;
          ctx.setLineDash(L === 0 || L === 1 ? [] : [5, 4]);
          ctx.strokeStyle = "rgba(43,153,255,0.85)";
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = "rgba(205,214,232,0.9)";
          ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText(`${(L * 100).toFixed(1)}%  ${price.toFixed(5)}`, right + 4, y + 3);
        }
      }
    }
  }
  ctx.restore();
}

export function PriceChart({
  symbol,
  tfLabel,
  price,
  decimals = 5,
  overlays = [],
}: {
  symbol: string;
  tfLabel: string;
  price: number;
  decimals?: number;
  overlays?: TradeOverlay[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lastBarRef = useRef<CandlestickData | null>(null);

  const toolRef = useRef<ToolId>("cursor");
  const drawingsRef = useRef<Drawing[]>([]);
  const pendingRef = useRef<Pt | null>(null);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const overlaysRef = useRef<TradeOverlay[]>(overlays);
  const decimalsRef = useRef(decimals);

  useEffect(() => {
    overlaysRef.current = overlays;
  }, [overlays]);
  useEffect(() => {
    decimalsRef.current = decimals;
  }, [decimals]);

  // candle slot size (seconds) so entry/expiry times snap to real bar times
  const tfSecRef = useRef(60);
  useEffect(() => {
    const ms = TIMEFRAMES.find((t) => t.label === tfLabel)?.ms ?? 60000;
    tfSecRef.current = Math.max(1, Math.floor(ms / 1000));
  }, [tfLabel]);

  // native price lines (line + price-axis label) per open trade
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const plKeyRef = useRef("");
  const applyPriceLines = useCallback((s: ISeriesApi<"Candlestick">) => {
    const list = overlaysRef.current;
    const key = list
      .map((o) => `${o.entryPrice}|${o.openedAt}|${o.expiryAt}|${o.direction}`)
      .join(";");
    if (key === plKeyRef.current) return;
    plKeyRef.current = key;
    for (const l of priceLinesRef.current) {
      try {
        s.removePriceLine(l);
      } catch {}
    }
    priceLinesRef.current = [];
    for (const o of list) {
      if (!Number.isFinite(o.entryPrice) || o.entryPrice <= 0) continue;
      priceLinesRef.current.push(
        s.createPriceLine({
          price: o.entryPrice,
          color: o.direction === "UP" ? UP : DOWN,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `E ${o.entryPrice.toFixed(decimalsRef.current)}`,
        })
      );
    }
  }, []);
  useEffect(() => {
    const s = seriesRef.current;
    if (s) applyPriceLines(s);
  }, [overlays, applyPriceLines]);

  const [tool, setTool] = useState<ToolId>("cursor");
  const [count, setCount] = useState(0);
  const [pending, setPending] = useState(false);

  const storeKey = `apex_tools_v1_${symbol}`;

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  useEffect(() => {
    drawingsRef.current = [];
    pendingRef.current = null;
    try {
      const raw = localStorage.getItem(storeKey);
      const parsed = raw ? (JSON.parse(raw) as Drawing[]) : [];
      if (Array.isArray(parsed)) drawingsRef.current = parsed;
    } catch {
      drawingsRef.current = [];
    }
    setCount(drawingsRef.current.length);
  }, [storeKey]);

  const persist = useCallback(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(drawingsRef.current));
    } catch {}
    setCount(drawingsRef.current.length);
  }, [storeKey]);

  // ── create chart (once) ──
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!host || !canvas || !wrap) return;

    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: BG },
        textColor: MUTED,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: { borderColor: BORDER },
      timeScale: {
        borderColor: BORDER,
        timeVisible: true,
        secondsVisible: true,
      },
      crosshair: { mode: CrosshairMode.Normal },
    });
    chartRef.current = chart;
    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceLineColor: MUTED,
    });
    seriesRef.current = series;
    applyPriceLines(series);

    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (
        canvas.width !== Math.round(w * dpr) ||
        canvas.height !== Math.round(h * dpr)
      ) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const ts = chart.timeScale();
      const X = (t: Time) => {
        const v = ts.timeToCoordinate(t);
        return v === null ? null : (v as number);
      };
      const Y = (p: number) => {
        const v = series.priceToCoordinate(p);
        return v === null ? null : (v as number);
      };
      const plotW = w - (chart.priceScale("right").width() || 0);

      for (const d of drawingsRef.current) drawShape(ctx, d, X, Y, plotW);

      // ── open-trade overlays: entry line + expiry marker ──
      const dec = decimalsRef.current;
      for (const o of overlaysRef.current) {
        if (!Number.isFinite(o.entryPrice) || o.entryPrice <= 0) continue;
        const color = o.direction === "UP" ? UP : DOWN;
        const y = Y(o.entryPrice);
        if (y !== null) {
          ctx.save();
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(plotW, y);
          ctx.stroke();
          ctx.restore();

          const barT = Math.floor(
            Math.floor(o.openedAt / 1000) / tfSecRef.current
          ) * tfSecRef.current;
          const xt = X(barT as Time);
          const label = `E ${o.entryPrice.toFixed(dec)}  ·  exp ${new Date(
            o.expiryAt
          ).toLocaleTimeString("en-GB", { hour12: false })}`;
          ctx.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
          const tw = ctx.measureText(label).width;
          const boxW = tw + 12;
          const px =
            xt === null
              ? 8
              : Math.min(Math.max(xt + 6, 8), Math.max(plotW - boxW - 8, 8));
          const py = Math.max(y - 20, 4);
          ctx.fillStyle = "rgba(18,20,32,.94)";
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          rr(ctx, px, py, boxW, 16, 4);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = color;
          ctx.fillText(label, px + 6, py + 11.5);
        }

        const barTe = Math.floor(
          Math.floor(o.expiryAt / 1000) / tfSecRef.current
        ) * tfSecRef.current;
        const xe = X(barTe as Time);
        if (xe !== null && xe >= 0 && xe <= plotW) {
          ctx.save();
          ctx.setLineDash([3, 5]);
          ctx.strokeStyle = "rgba(240,185,11,.75)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(xe, 0);
          ctx.lineTo(xe, h);
          ctx.stroke();
          ctx.restore();
          const tl = new Date(o.expiryAt).toLocaleTimeString("en-GB", {
            hour12: false,
          });
          ctx.font = "600 9px ui-monospace, SFMono-Regular, Menlo, monospace";
          const tw2 = ctx.measureText(tl).width;
          const lx = Math.min(Math.max(xe + 4, 3), Math.max(plotW - tw2 - 10, 3));
          ctx.fillStyle = "rgba(240,185,11,.18)";
          rr(ctx, lx, 3, tw2 + 8, 14, 3);
          ctx.fill();
          ctx.fillStyle = "#F0B90B";
          ctx.fillText(tl, lx + 4, 13);
        }
      }

      const pending = pendingRef.current;
      const m = mouseRef.current;
      if (pending && m && toolRef.current !== "cursor") {
        const t = ts.coordinateToTime(m.x);
        const p = series.coordinateToPrice(m.y);
        if (t !== null && p !== null) {
          drawShape(
            ctx,
            { id: "preview", type: toolRef.current as DrawingType, a: pending, b: { time: t, price: p as number } },
            X,
            Y,
            plotW
          );
        }
        const px = X(pending.time);
        const py = Y(pending.price);
        if (px !== null && py !== null) {
          ctx.fillStyle = "#F0B90B";
          ctx.beginPath();
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      lastBarRef.current = null;
      priceLinesRef.current = [];
      plKeyRef.current = "";
    };
  }, [applyPriceLines]);

  // ── load candles (real for live pairs, synthetic when offline) ──
  useEffect(() => {
    let stop = false;
    let first = true;
    async function load() {
      try {
        const res = await fetch(
          `/api/candles?symbol=${symbol}&tf=${tfLabel}&limit=300`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const j = (await res.json()) as { candles?: Candle[] };
        const s = seriesRef.current;
        const chart = chartRef.current;
        if (stop || !s || !chart || !Array.isArray(j.candles)) return;
        const data: CandlestickData[] = j.candles.map((c) => ({
          time: Math.floor(c.time / 1000) as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));
        const range = chart.timeScale().getVisibleLogicalRange();
        s.setData(data);
        if (data.length) lastBarRef.current = data[data.length - 1];
        if (first) {
          chart.timeScale().fitContent();
          first = false;
        } else if (range) {
          chart.timeScale().setVisibleLogicalRange(range);
        }
      } catch {}
    }
    void load();
    const iv = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, [symbol, tfLabel]);

  // ── live tick: nudge the last candle to the current price ──
  useEffect(() => {
    const s = seriesRef.current;
    const bar = lastBarRef.current;
    if (!s || !bar || !price || price <= 0) return;
    const next: CandlestickData = {
      time: bar.time,
      open: bar.open,
      high: Math.max(bar.high, price),
      low: Math.min(bar.low, price),
      close: price,
    };
    s.update(next);
    lastBarRef.current = next;
  }, [price]);

  function toPoint(clientX: number, clientY: number): Pt | null {
    const canvas = canvasRef.current;
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!canvas || !chart || !series) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const t = chart.timeScale().coordinateToTime(x);
    const p = series.coordinateToPrice(y);
    if (t === null || p === null) return null;
    return { time: t, price: p as number };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (toolRef.current === "cursor") return;
    const pt = toPoint(e.clientX, e.clientY);
    if (!pt) return;
    if (toolRef.current === "text") {
      const text = window.prompt("Text note:");
      if (text && text.trim()) {
        drawingsRef.current.push({ id: uid(), type: "text", a: pt, text: text.trim() });
        persist();
      }
      setTool("cursor");
      return;
    }
    if (!pendingRef.current) {
      pendingRef.current = pt;
      setPending(true);
      return;
    }
    drawingsRef.current.push({
      id: uid(),
      type: toolRef.current as DrawingType,
      a: pendingRef.current,
      b: pt,
    });
    pendingRef.current = null;
    setPending(false);
    persist();
    setTool("cursor");
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== "Escape") return;
      pendingRef.current = null;
      setPending(false);
      setTool("cursor");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <div ref={hostRef} className="absolute inset-0" />
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{
          pointerEvents: tool === "cursor" ? "none" : "auto",
          cursor: tool === "cursor" ? "default" : "crosshair",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => {
          mouseRef.current = null;
        }}
      />

      {/* ── our firm's tool rail ── */}
      <div
        className="absolute left-2 top-2 z-30 flex flex-col gap-0.5 rounded-lg p-1 shadow-xl"
        style={{ background: "rgba(28,31,45,.86)", border: "1px solid rgba(255,255,255,.08)" }}
      >
        {TOOLS.map((t) => (
          <button
            key={t.id}
            title={t.label}
            onClick={() => {
              pendingRef.current = null;
              setPending(false);
              setTool(t.id);
            }}
            className="rounded-md p-2 transition-colors hover:bg-white/10"
            style={{
              color: tool === t.id ? "#fff" : MUTED,
              background: tool === t.id ? ACCENT : "transparent",
            }}
          >
            <Icon d={t.d} />
          </button>
        ))}
        <div className="mx-1 my-0.5 h-px bg-white/10" />
        <button
          title="Undo last"
          onClick={() => {
            drawingsRef.current = drawingsRef.current.slice(0, -1);
            pendingRef.current = null;
            setPending(false);
            persist();
          }}
          className="rounded-md p-2 transition-colors hover:bg-white/10"
          style={{ color: MUTED }}
        >
          <Icon d="M9 14L4 9l5-5M4 9h10a6 6 0 016 6v1a6 6 0 01-6 6H8" />
        </button>
        <button
          title="Clear all"
          onClick={() => {
            drawingsRef.current = [];
            pendingRef.current = null;
            setPending(false);
            persist();
          }}
          className="rounded-md p-2 transition-colors hover:bg-white/10"
          style={{ color: count > 0 ? DOWN : MUTED }}
        >
          <Icon d="M5 7h14M9 7V4.8A.8.8 0 019.8 4h4.4a.8.8 0 01.8.8V7M7 7l.9 12.2a.8.8 0 00.8.8h6.6a.8.8 0 00.8-.8L17 7" />
        </button>
      </div>

      {pending && tool !== "cursor" && (
        <div
          className="absolute left-1/2 top-2 z-30 -translate-x-1/2 rounded-md px-2 py-1 text-[11px] font-semibold"
          style={{ background: "rgba(240,185,11,.16)", color: "#F0B90B" }}
        >
          Click second point · Esc to cancel
        </div>
      )}
    </div>
  );
}
