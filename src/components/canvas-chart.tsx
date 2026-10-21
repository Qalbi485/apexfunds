"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Candle } from "@/lib/market";
import { fmtPrice } from "@/lib/market";

export const UP = "#0FAF59";
export const DOWN = "#FF4459";
export const BG = "#1C1F2D";
export const PANEL = "#292D36";
export const GRID = "#32374A";
export const MUTED = "#8A8FA3";

export type Tool = "cursor" | "trend" | "hline" | "fibo" | "rect";
export type DrawingType = "trend" | "hline" | "fibo" | "rect";
export type Pt = { time: number; price: number };
export type Drawing = { id: string; type: DrawingType; a: Pt; b?: Pt };

type Series = (number | null)[];

export type OverlayLine = {
  key: string;
  label: string;
  color: string;
  values: Series;
};
export type OverlayBand = {
  key: string;
  label: string;
  color: string;
  fill: string;
  upper: Series;
  mid: Series;
  lower: Series;
};
export type OscLine = { key: string; label: string; color: string; values: Series };
export type OscPane = {
  key: string;
  label: string;
  lines: OscLine[];
  hist?: { values: Series; up: string; down: string };
  bandLevels?: number[];
  fixedMin?: number;
  fixedMax?: number;
  zero?: boolean;
};

export type ChartTrade = {
  direction: string;
  stake: number;
  entryPrice: number | null;
};

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const PAD_R = 68;
const PAD_B = 22;
const OSC_PANE_H = 96;

type Props = {
  symbol: string;
  candles: Candle[];
  price: number;
  tfMs: number;
  lineMode: boolean;
  showVolume: boolean;
  overlayLines: OverlayLine[];
  overlayBands: OverlayBand[];
  oscPanes: OscPane[];
  trades: ChartTrade[];
  drawings: Drawing[];
  tool: Tool;
  selectedId: string | null;
  live: boolean;
  onSelect: (id: string | null) => void;
  onCommit: (d: Drawing) => void;
  onDelete: (id: string) => void;
  /** Signed candle shift: positive = move view forward (toward live). */
  onPan: (candleShift: number) => void;
  /** dir 1 = zoom in (fewer candles), -1 = zoom out. */
  onZoom: (dir: 1 | -1) => void;
};

export function CanvasChart(props: Props) {
  const {
    symbol,
    candles,
    price,
    tfMs,
    lineMode,
    showVolume,
    overlayLines,
    overlayBands,
    oscPanes,
    trades,
    drawings,
    tool,
    selectedId,
    live,
    onSelect,
    onCommit,
    onDelete,
    onPan,
    onZoom,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [panPx, setPanPx] = useState(0);
  const [tick, setTick] = useState(0);
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const pendingRef = useRef<Pt | null>(null);
  const backingRef = useRef({ w: 0, h: 0, dpr: 0 });

  // ── measure ──
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () =>
      setSize({ w: wrap.clientWidth, h: wrap.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // ── wheel zoom (non-passive so preventDefault works) ──
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      onZoom(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onZoom]);

  // ── keyboard: cancel pending / delete selected ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape" && pendingRef.current) {
        pendingRef.current = null;
        setTick((t) => t + 1);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        onDelete(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, onDelete]);

  const n = candles.length;
  const plotW = Math.max(1, size.w - PAD_R);
  const fullH = Math.max(1, size.h - PAD_B);
  const nOsc = Math.min(oscPanes.length, 3);
  const mainH = Math.max(60, fullH - nOsc * OSC_PANE_H);
  const volH = showVolume && n > 0 ? Math.round(mainH * 0.18) : 0;
  const priceH = mainH - volH;
  const cw = plotW / Math.max(1, n);
  const t0 = candles.length > 0 ? candles[0].time : 0;

  const xOfTime = useCallback(
    (t: number) => ((t - t0) / tfMs + 0.5) * cw + panPx,
    [t0, tfMs, cw, panPx]
  );
  const timeOfX = (x: number) =>
    t0 + Math.round((x - panPx - cw / 2) / cw) * tfMs;

  // price range (candles + bands + trade entries)
  let pMin = Infinity;
  let pMax = -Infinity;
  for (const c of candles) {
    if (c.low < pMin) pMin = c.low;
    if (c.high > pMax) pMax = c.high;
  }
  for (const band of overlayBands) {
    for (const arr of [band.upper, band.lower]) {
      for (const v of arr) {
        if (v === null) continue;
        if (v < pMin) pMin = v;
        if (v > pMax) pMax = v;
      }
    }
  }
  for (const t of trades) {
    if (t.entryPrice == null) continue;
    if (t.entryPrice < pMin) pMin = t.entryPrice;
    if (t.entryPrice > pMax) pMax = t.entryPrice;
  }
  if (!Number.isFinite(pMin) || !Number.isFinite(pMax)) {
    pMin = 0;
    pMax = 1;
  }
  const padRange = (pMax - pMin || Math.abs(pMax) * 0.001 || 1) * 0.08;
  pMin -= padRange;
  pMax += padRange;
  const yOf = useCallback(
    (p: number) => ((pMax - p) / (pMax - pMin)) * (priceH - 12) + 6,
    [pMax, pMin, priceH]
  );
  const priceOfY = useCallback(
    (y: number) =>
      pMax - ((y - 6) / Math.max(1, priceH - 12)) * (pMax - pMin),
    [pMax, pMin, priceH]
  );

  // hovered candle index
  const hoverIdx =
    mouse && mouse.x <= plotW && mouse.y <= mainH && n > 0
      ? Math.min(
          n - 1,
          Math.max(0, Math.round((mouse.x - panPx - cw / 2) / cw))
        )
      : -1;

  const hitTest = (mx: number, my: number): string | null => {
    const tol = 6;
    for (let i = drawings.length - 1; i >= 0; i--) {
      const d = drawings[i];
      if (d.type === "hline") {
        if (Math.abs(yOf(d.a.price) - my) <= tol && mx <= plotW) return d.id;
      } else if (d.type === "trend" && d.b) {
        const x1 = xOfTime(d.a.time);
        const y1 = yOf(d.a.price);
        const x2 = xOfTime(d.b.time);
        const y2 = yOf(d.b.price);
        const dist = distToSeg(mx, my, x1, y1, x2, y2);
        if (dist <= tol) return d.id;
      } else if (d.type === "fibo" && d.b) {
        const x1 = xOfTime(d.a.time);
        const x2 = xOfTime(d.b.time);
        const lo = Math.min(x1, x2);
        const hi = Math.max(x1, x2);
        if (mx < lo - tol || mx > hi + tol) continue;
        for (const lvl of FIB_LEVELS) {
          const p = d.a.price + (d.b.price - d.a.price) * lvl;
          if (Math.abs(yOf(p) - my) <= tol) return d.id;
        }
      } else if (d.type === "rect" && d.b) {
        const x1 = xOfTime(d.a.time);
        const y1 = yOf(d.a.price);
        const x2 = xOfTime(d.b.time);
        const y2 = yOf(d.b.price);
        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        const top = Math.min(y1, y2);
        const bot = Math.max(y1, y2);
        const nearV = Math.abs(mx - left) <= tol || Math.abs(mx - right) <= tol;
        const inY = my >= top - tol && my <= bot + tol;
        const nearH = Math.abs(my - top) <= tol || Math.abs(my - bot) <= tol;
        const inX = mx >= left - tol && mx <= right + tol;
        if (((nearV && inY) || (nearH && inX)) && mx <= plotW) return d.id;
      }
    }
    return null;
  };

  // ── pointer handlers ──
  const localPt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    downRef.current = localPt(e);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = localPt(e);
    setMouse(pt);
    const down = downRef.current;
    if (down && tool === "cursor") {
      const dx = pt.x - down.x;
      const dy = pt.y - down.y;
      if (Math.abs(dx) > 4 && Math.abs(dx) > Math.abs(dy)) setPanPx(dx);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = localPt(e);
    const down = downRef.current;
    downRef.current = null;
    if (!down) return;
    const dx = pt.x - down.x;
    const dy = pt.y - down.y;
    const canPan = tool === "cursor";
    if (canPan && Math.abs(dx) > 4 && Math.abs(dx) > Math.abs(dy)) {
      setPanPx(0);
      onPan(-Math.round(dx / cw));
      return;
    }
    setPanPx(0);
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) return;

    // click
    if (pt.x > plotW || pt.y > size.h - PAD_B) return;
    if (tool === "cursor") {
      const hit = hitTest(pt.x, pt.y);
      onSelect(hit);
      return;
    }
    const snapTime = timeOfX(pt.x);
    const snapPrice = pt.y <= priceH ? priceOfY(pt.y) : null;
    if (snapPrice === null) return;
    const point: Pt = { time: snapTime, price: snapPrice };
    if (tool === "hline") {
      onCommit({ id: crypto.randomUUID(), type: "hline", a: point });
      return;
    }
    if (!pendingRef.current) {
      pendingRef.current = point;
      setTick((t) => t + 1);
    } else {
      onCommit({
        id: crypto.randomUUID(),
        type: tool as DrawingType,
        a: pendingRef.current,
        b: point,
      });
      pendingRef.current = null;
      setTick((t) => t + 1);
    }
  };

  // ── draw ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    // Only reallocate the backing store when the size actually changes —
    // reassigning canvas.width every frame forces a full clear + reallocation
    // (flicker + lag).
    const backing = backingRef.current;
    if (backing.w !== size.w || backing.h !== size.h || backing.dpr !== dpr) {
      canvas.width = size.w * dpr;
      canvas.height = size.h * dpr;
      canvas.style.width = size.w + "px";
      canvas.style.height = size.h + "px";
      backingRef.current = { w: size.w, h: size.h, dpr };
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    void tick;

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, size.w, size.h);
    if (n === 0) return;


    // ── grid + price axis ──
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.fillStyle = MUTED;
    ctx.font = "10px ui-monospace, monospace";
    for (let i = 0; i <= 5; i++) {
      const yy = 6 + ((priceH - 12) / 5) * i;
      if (yy > priceH) break;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(plotW, yy);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(fmtPrice(symbol, priceOfY(yy)), plotW + 7, yy + 3);
    }

    // vertical grid + time labels
    const step = Math.max(1, Math.ceil(n / 8));
    ctx.textAlign = "center";
    for (let i = 0; i < n; i += step) {
      const x = i * cw + cw / 2 + panPx;
      if (x < 0 || x > plotW) continue;
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, fullH);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = MUTED;
      ctx.fillText(
        new Date(candles[i].time).toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          second: tfMs < 60000 ? "2-digit" : undefined,
        }),
        x,
        size.h - 7
      );
    }
    ctx.textAlign = "left";

    // ── clip price content to main pane ──
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, plotW, priceH);
    ctx.clip();

    // volume
    if (showVolume && volH > 0) {
      let vMax = 0;
      for (const c of candles) if (c.volume > vMax) vMax = c.volume;
      const vTop = priceH;
      candles.forEach((c, i) => {
        const x = i * cw + cw / 2 + panPx;
        const h = (c.volume / (vMax || 1)) * volH;
        ctx.fillStyle = c.close >= c.open ? UP : DOWN;
        ctx.globalAlpha = 0.28;
        ctx.fillRect(x - Math.max(1, cw * 0.3), vTop + volH - h, Math.max(1.5, cw * 0.6), h);
        ctx.globalAlpha = 1;
      });
    }

    const xOf = (i: number) => i * cw + cw / 2 + panPx;

    // candles / line
    if (lineMode) {
      ctx.strokeStyle = candles[n - 1].close >= candles[0].close ? UP : DOWN;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      candles.forEach((c, i) => {
        const x = xOf(i);
        if (i === 0) ctx.moveTo(x, yOf(c.close));
        else ctx.lineTo(x, yOf(c.close));
      });
      ctx.stroke();
      ctx.lineWidth = 1;
    } else {
      const bodyW = Math.max(1.5, cw * 0.62);
      candles.forEach((c, i) => {
        const x = xOf(i);
        const up = c.close >= c.open;
        ctx.strokeStyle = up ? UP : DOWN;
        ctx.fillStyle = up ? UP : DOWN;
        ctx.beginPath();
        ctx.moveTo(x, yOf(c.high));
        ctx.lineTo(x, yOf(c.low));
        ctx.stroke();
        const top = yOf(Math.max(c.open, c.close));
        const bot = yOf(Math.min(c.open, c.close));
        ctx.fillRect(x - bodyW / 2, top, bodyW, Math.max(1, bot - top));
      });
    }

    // bollinger band fill
    for (const band of overlayBands) {
      let started = false;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const v = band.upper[i];
        if (v === null) continue;
        const x = xOf(i);
        const y = yOf(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      for (let i = n - 1; i >= 0; i--) {
        const v = band.lower[i];
        if (v === null) continue;
        ctx.lineTo(xOf(i), yOf(v));
      }
      if (started) {
        ctx.closePath();
        ctx.fillStyle = band.fill;
        ctx.fill();
      }
      const drawSeries = (vals: Series, color: string, width = 1) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        let pen = false;
        for (let i = 0; i < n; i++) {
          const v = vals[i];
          if (v === null) {
            pen = false;
            continue;
          }
          const x = xOf(i);
          const y = yOf(v);
          if (!pen) {
            ctx.moveTo(x, y);
            pen = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.lineWidth = 1;
      };
      drawSeries(band.upper, band.color);
      drawSeries(band.mid, band.color, 1);
      drawSeries(band.lower, band.color);
    }

    // overlay lines
    for (const line of overlayLines) {
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < n; i++) {
        const v = line.values[i];
        if (v === null) {
          pen = false;
          continue;
        }
        const x = xOf(i);
        const y = yOf(v);
        if (!pen) {
          ctx.moveTo(x, y);
          pen = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // ── drawings ──
    const drawPt = (p: Pt) => ({ x: xOfTime(p.time), y: yOf(p.price) });
    const pending = pendingRef.current;
    for (const d of drawings) {
      const sel = d.id === selectedId;
      ctx.strokeStyle = sel ? "#F0B90B" : "#2B99FF";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = sel ? 2 : 1.4;
      if (d.type === "hline") {
        const y = yOf(d.a.price);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(plotW, y);
        ctx.stroke();
        const label = fmtPrice(symbol, d.a.price);
        ctx.font = "bold 10px ui-monospace, monospace";
        ctx.fillRect(plotW + 1, y - 8, PAD_R - 2, 16);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, plotW + 6, y + 3);
        ctx.font = "10px ui-monospace, monospace";
      } else if (d.type === "trend" && d.b) {
        const p1 = drawPt(d.a);
        const p2 = drawPt(d.b);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        if (sel) {
          ctx.beginPath();
          ctx.arc(p1.x, p1.y, 3.5, 0, Math.PI * 2);
          ctx.arc(p2.x, p2.y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (d.type === "fibo" && d.b) {
        const p1 = drawPt(d.a);
        const p2 = drawPt(d.b);
        ctx.font = "10px ui-monospace, monospace";
        for (const lvl of FIB_LEVELS) {
          const price = d.a.price + (d.b.price - d.a.price) * lvl;
          const y = yOf(price);
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.moveTo(Math.min(p1.x, p2.x), y);
          ctx.lineTo(Math.max(p1.x, p2.x), y);
          ctx.stroke();
          ctx.globalAlpha = 1;
          const label = `${(lvl * 100).toFixed(1)}%  ${fmtPrice(symbol, price)}`;
          const lx = Math.max(p1.x, p2.x) + 6;
          if (lx < plotW - 4) {
            ctx.fillStyle = "#C7CDDF";
            ctx.fillText(label, lx, y + 3);
          }
        }
      } else if (d.type === "rect" && d.b) {
        const p1 = drawPt(d.a);
        const p2 = drawPt(d.b);
        const left = Math.min(p1.x, p2.x);
        const top = Math.min(p1.y, p2.y);
        const w = Math.abs(p2.x - p1.x);
        const h = Math.abs(p2.y - p1.y);
        ctx.globalAlpha = 0.12;
        ctx.fillRect(left, top, w, h);
        ctx.globalAlpha = 1;
        ctx.strokeRect(left, top, w, h);
      }
      ctx.lineWidth = 1;
    }

    // pending preview
    if (pending && mouse && mouse.x <= plotW && mouse.y <= priceH) {
      const p1 = drawPt(pending);
      ctx.strokeStyle = "#F0B90B";
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(mouse.x, mouse.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }

    // open trade entry lines
    for (const t of trades) {
      if (t.entryPrice == null) continue;
      const col = t.direction === "UP" ? UP : DOWN;
      const yy = yOf(t.entryPrice);
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.8;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(plotW, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      const label = `${t.direction} $${t.stake}`;
      ctx.font = "bold 10px ui-sans-serif, sans-serif";
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = col;
      ctx.fillRect(4, yy - 8, tw, 15);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, 9, yy + 3);
      ctx.font = "10px ui-monospace, monospace";
    }

    // current / window price line
    const lastClose = candles[n - 1].close;
    const lineUp = price >= lastClose;
    const py = yOf(price);
    if (live && py >= 0 && py <= priceH) {
      ctx.strokeStyle = lineUp ? UP : DOWN;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(plotW, py);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = lineUp ? UP : DOWN;
      ctx.fillRect(plotW + 1, py - 9, PAD_R - 2, 18);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 11px ui-monospace, monospace";
      ctx.fillText(fmtPrice(symbol, price), plotW + 6, py + 4);
      ctx.font = "10px ui-monospace, monospace";
    }
    ctx.restore();

    // ── oscillator panes ──
    oscPanes.slice(0, nOsc).forEach((pane, pi) => {
      const top = mainH + pi * OSC_PANE_H;
      const bot = top + OSC_PANE_H;
      ctx.fillStyle = "#191C28";
      ctx.fillRect(0, top, plotW, OSC_PANE_H);
      ctx.strokeStyle = GRID;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(0, top + 0.5);
      ctx.lineTo(size.w, top + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;

      const plotTop = top + 16;
      const plotBot = bot - 6;
      let lo = pane.fixedMin ?? Infinity;
      let hi = pane.fixedMax ?? -Infinity;
      if (pane.fixedMin === undefined || pane.fixedMax === undefined) {
        for (const line of pane.lines)
          for (const v of line.values) {
            if (v === null) continue;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        if (pane.hist)
          for (const v of pane.hist.values) {
            if (v === null) continue;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
          lo = 0;
          hi = 1;
        }
        const p2 = (hi - lo || 1) * 0.1;
        lo -= p2;
        hi += p2;
      }
      const yOsc = (v: number) =>
        plotBot - ((v - lo) / (hi - lo || 1)) * (plotBot - plotTop);

      // bands (30/70 etc)
      if (pane.bandLevels) {
        ctx.strokeStyle = "#4A5169";
        ctx.setLineDash([3, 4]);
        ctx.fillStyle = MUTED;
        ctx.font = "9px ui-monospace, monospace";
        for (const lvl of pane.bandLevels) {
          if (lvl < lo || lvl > hi) continue;
          const y = yOsc(lvl);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(plotW, y);
          ctx.stroke();
          ctx.fillText(String(lvl), plotW + 7, y + 3);
        }
        ctx.setLineDash([]);
      }
      // zero line
      if (pane.zero && lo < 0 && hi > 0) {
        ctx.strokeStyle = "#4A5169";
        ctx.beginPath();
        ctx.moveTo(0, yOsc(0));
        ctx.lineTo(plotW, yOsc(0));
        ctx.stroke();
      }

      // histogram
      if (pane.hist) {
        const hw = Math.max(1, cw * 0.55);
        pane.hist.values.forEach((v, i) => {
          if (v === null) return;
          const x = xOf(i);
          const y0 = yOsc(0);
          const y1 = yOsc(v);
          ctx.fillStyle = v >= 0 ? (pane.hist?.up ?? UP) : (pane.hist?.down ?? DOWN);
          ctx.globalAlpha = 0.75;
          ctx.fillRect(x - hw / 2, Math.min(y0, y1), hw, Math.max(1, Math.abs(y1 - y0)));
          ctx.globalAlpha = 1;
        });
      }

      // lines
      for (const line of pane.lines) {
        ctx.strokeStyle = line.color;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        let pen = false;
        for (let i = 0; i < n; i++) {
          const v = line.values[i];
          if (v === null) {
            pen = false;
            continue;
          }
          const x = xOf(i);
          const y = yOsc(v);
          if (!pen) {
            ctx.moveTo(x, y);
            pen = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.lineWidth = 1;
      }

      // label + last value
      ctx.font = "bold 9px ui-sans-serif, sans-serif";
      let lx = 8;
      ctx.fillStyle = MUTED;
      ctx.fillText(pane.label, lx, top + 11);
      lx += ctx.measureText(pane.label).width + 8;
      for (const line of pane.lines) {
        const last = line.values[n - 1];
        if (last === null) continue;
        ctx.fillStyle = line.color;
        const txt = `${line.label} ${last.toFixed(Math.abs(last) >= 100 ? 2 : 4)}`;
        ctx.fillText(txt, lx, top + 11);
        lx += ctx.measureText(txt).width + 8;
      }
      ctx.font = "10px ui-monospace, monospace";
    });

    // pane separators (right side labels for osc panes drawn above)

    // ── legend (OHLC) ──
    const li = hoverIdx >= 0 ? hoverIdx : n - 1;
    const lc = candles[li];
    if (lc) {
      ctx.font = "bold 11px ui-monospace, monospace";
      let x = 8;
      const yLeg = 13;
      const timeTxt = new Date(lc.time).toLocaleTimeString("en-GB", {
        hour12: false,
      });
      ctx.fillStyle = MUTED;
      ctx.fillText(timeTxt, x, yLeg);
      x += ctx.measureText(timeTxt).width + 10;
      const chg = ((lc.close - lc.open) / lc.open) * 100;
      const upCandle = lc.close >= lc.open;
      const labels: [string, string, string][] = [
        ["O", fmtPrice(symbol, lc.open), upCandle ? UP : DOWN],
        ["H", fmtPrice(symbol, lc.high), upCandle ? UP : DOWN],
        ["L", fmtPrice(symbol, lc.low), upCandle ? UP : DOWN],
        ["C", fmtPrice(symbol, lc.close), upCandle ? UP : DOWN],
      ];
      for (const [k, v, col] of labels) {
        ctx.fillStyle = MUTED;
        ctx.fillText(k, x, yLeg);
        x += ctx.measureText(k).width + 3;
        ctx.fillStyle = col;
        ctx.fillText(v, x, yLeg);
        x += ctx.measureText(v).width + 9;
      }
      ctx.fillStyle = chg >= 0 ? UP : DOWN;
      ctx.fillText(`${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`, x, yLeg);
      x += 50;
      ctx.fillStyle = MUTED;
      ctx.fillText(`V ${(lc.volume / 1000).toFixed(1)}k`, x, yLeg);
      // overlay legend
      x += 70;
      ctx.font = "10px ui-sans-serif, sans-serif";
      for (const line of overlayLines.slice(0, 5)) {
        const v = line.values[li] ?? line.values[n - 1];
        if (v === null || v === undefined) continue;
        ctx.fillStyle = line.color;
        const txt = `${line.label} ${fmtPrice(symbol, v)}`;
        ctx.fillText(txt, x, yLeg);
        x += ctx.measureText(txt).width + 10;
      }
      for (const band of overlayBands.slice(0, 2)) {
        ctx.fillStyle = band.color;
        const txt = `${band.label} ${fmtPrice(symbol, band.mid[li] ?? band.mid[n - 1] ?? 0)}`;
        ctx.fillText(txt, x, yLeg);
        x += ctx.measureText(txt).width + 10;
      }
    }

    // tool hint
    if (tool !== "cursor") {
      ctx.font = "bold 11px ui-sans-serif, sans-serif";
      ctx.fillStyle = "#F0B90B";
      const hint = pendingRef.current
        ? tool === "hline"
          ? ""
          : "Click second point · Esc to cancel"
        : tool === "hline"
          ? "Click to place horizontal line"
          : "Click first point";
      if (hint) {
        ctx.fillText(hint, 8, 30);
      }
    }

    // ── right price axis background strip ──
    ctx.fillStyle = "#1A1D29";
    ctx.globalAlpha = 0.6;
    ctx.fillRect(plotW, 0, PAD_R, size.h);
    ctx.globalAlpha = 1;
    // redraw price labels on top of strip
    ctx.fillStyle = MUTED;
    ctx.font = "10px ui-monospace, monospace";
    for (let i = 0; i <= 5; i++) {
      const yy = 6 + ((priceH - 12) / 5) * i;
      if (yy > priceH) break;
      ctx.fillText(fmtPrice(symbol, priceOfY(yy)), plotW + 7, yy + 3);
    }
    // current price tag on top
    if (live && py >= 0 && py <= priceH) {
      ctx.fillStyle = lineUp ? UP : DOWN;
      ctx.fillRect(plotW + 1, py - 9, PAD_R - 2, 18);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 11px ui-monospace, monospace";
      ctx.fillText(fmtPrice(symbol, price), plotW + 6, py + 4);
    }
    // osc pane last values on strip
    oscPanes.slice(0, nOsc).forEach((pane, pi) => {
      const top = mainH + pi * OSC_PANE_H;
      const first = pane.lines[0];
      if (!first) return;
      const v = first.values[n - 1];
      if (v === null) return;
      ctx.fillStyle = first.color;
      ctx.font = "bold 10px ui-monospace, monospace";
      ctx.fillText(v.toFixed(2), plotW + 7, top + 30);
    });

    // ── crosshair (on top of axis strip) ──
    if (mouse && mouse.x <= plotW && hoverIdx >= 0) {
      const cx = xOf(hoverIdx);
      ctx.strokeStyle = "#6B7285";
      ctx.setLineDash([4, 4]);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, fullH);
      ctx.stroke();
      if (mouse.y <= priceH) {
        ctx.beginPath();
        ctx.moveTo(0, mouse.y);
        ctx.lineTo(plotW, mouse.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        // price tag
        const pv = priceOfY(mouse.y);
        ctx.fillStyle = "#3A4157";
        ctx.fillRect(plotW + 1, mouse.y - 8, PAD_R - 2, 16);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px ui-monospace, monospace";
        ctx.fillText(fmtPrice(symbol, pv), plotW + 5, mouse.y + 3);
      } else {
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
      // time tag
      const tLabel = new Date(candles[hoverIdx].time).toLocaleString("en-GB", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: tfMs < 60000 ? "2-digit" : undefined,
        day: tfMs >= 86400000 ? "2-digit" : undefined,
        month: tfMs >= 86400000 ? "short" : undefined,
      });
      ctx.font = "10px ui-monospace, monospace";
      const tw = ctx.measureText(tLabel).width + 12;
      ctx.fillStyle = "#3A4157";
      ctx.fillRect(Math.min(cx - tw / 2, plotW - tw), size.h - PAD_B + 2, tw, 16);
      ctx.fillStyle = "#fff";
      ctx.fillText(
        tLabel,
        Math.min(Math.max(2, cx - tw / 2), plotW - tw + 5),
        size.h - PAD_B + 13
      );
      ctx.font = "10px ui-monospace, monospace";
    }

  }, [
    size,
    mouse,
    panPx,
    tick,
    candles,
    price,
    tfMs,
    lineMode,
    showVolume,
    overlayLines,
    overlayBands,
    oscPanes,
    trades,
    drawings,
    tool,
    selectedId,
    live,
    n,
    plotW,
    fullH,
    mainH,
    priceH,
    volH,
    cw,
    t0,
    pMin,
    pMax,
    symbol,
    onPan,
    onZoom,
    onSelect,
    onCommit,
    onDelete,
    hoverIdx,
    nOsc,
    priceOfY,
    xOfTime,
    yOf,
  ]);

  return (
    <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{
          cursor:
            tool !== "cursor"
              ? "crosshair"
              : panPx !== 0
                ? "grabbing"
                : "default",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setMouse(null)}
        onDoubleClick={() => {
          pendingRef.current = null;
          setTick((t) => t + 1);
        }}
      />
    </div>
  );
}

function distToSeg(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
