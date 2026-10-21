"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SYMBOLS,
  SYMBOL_LIST,
  DURATIONS,
  TIMEFRAMES,
  CATEGORY_LABELS,
  marketOpenFor,
  fmtPrice,
  candleCloseIn,
} from "@/lib/market";
import { BG, DOWN, MUTED, PANEL, UP } from "@/components/canvas-chart";
import { TradingViewChart } from "@/components/tradingview-chart";
import { money } from "@/lib/utils";

type ChallengeOption = {
  id: string;
  label: string;
  status: string;
  phase: string;
  currentBalance: number;
};

type TradeRow = {
  id: string;
  symbol: string;
  direction: string;
  stake: number;
  profit: number;
  status: string;
  entryPrice: number | null;
  closePrice: number | null;
  payoutPct: number | null;
  expiryAt: string;
  openedAt: string;
  closedAt: string;
};

type ChallengeSnap = {
  currentBalance: number;
  paidWithdrawals?: number;
  reservedExposure?: number;
  available?: number;
  status: string;
  phase: string;
  breachReason: string | null;
};

type Toast = {
  kind: "win" | "lose" | "info" | "error";
  title: string;
  body?: string;
};



const CAT_FILTERS = [
  { id: "all", label: "All" },
  { id: "forex", label: "Forex" },
  { id: "metals", label: "Metals" },
  { id: "crypto", label: "Crypto" },
] as const;
type CatFilter = (typeof CAT_FILTERS)[number]["id"];

function Icon({ d, size = 18 }: { d: string; size?: number }) {
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

function tvIntervalFor(ms: number): string {
  if (ms <= 60000) return "1";
  if (ms <= 300000) return "5";
  if (ms <= 900000) return "15";
  if (ms <= 1800000) return "30";
  if (ms <= 3600000) return "60";
  if (ms <= 14400000) return "240";
  return "D";
}

export function Terminal({ challenges }: { challenges: ChallengeOption[] }) {
  const [challengeId, setChallengeId] = useState(challenges[0]?.id || "");
  const [symbol, setSymbol] = useState("EURUSD");
  const [stake, setStake] = useState("10");
  const [duration, setDuration] = useState(60);
  const [tfMs, setTfMs] = useState(60000);
  const [assetOpen, setAssetOpen] = useState(false);
  const [catFilter, setCatFilter] = useState<CatFilter>("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<TradeRow[]>([]);
  const [closed, setClosed] = useState<TradeRow[]>([]);
  const [snap, setSnap] = useState<ChallengeSnap | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [liveChanges, setLiveChanges] = useState<Record<string, number>>({});
  const [ticks, setTicks] = useState<Record<string, number>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const challenge = challenges.find((c) => c.id === challengeId);
  const info = SYMBOLS[symbol];
  const price = ticks[symbol] ?? info?.base ?? 0;
  const change = liveChanges[symbol] ?? 0;
const hasLiveFeed = !!info?.provider;
const tvSymbol =
  symbol === "XAUUSD"
    ? "OANDA:XAUUSD"
    : symbol === "BTCUSD"
      ? "COINBASE:BTCUSD"
      : `FX:${symbol}`;
const tvInterval = tvIntervalFor(tfMs);
const closeIn = useMemo(() => candleCloseIn(now, tfMs), [now, tfMs]);
const marketOpen = hasLiveFeed ? marketOpenFor(symbol, now) : true;
const chartOverlays = open
  .filter((t) => t.symbol === symbol && t.entryPrice != null)
  .map((t) => ({
    entryPrice: t.entryPrice as number,
    openedAt: new Date(t.openedAt).getTime(),
    expiryAt: new Date(t.expiryAt).getTime(),
    direction: t.direction,
  }));
  const amt = parseFloat(stake) || 0;
  const netProfit = amt * (info.payout / 100);
  const balance = snap?.currentBalance ?? challenge?.currentBalance ?? 0;
  const paidWithdrawals = snap?.paidWithdrawals ?? 0;
  const reserved = snap?.reservedExposure ?? 0;
  const available =
    snap?.available ?? Math.round((balance - paidWithdrawals - reserved) * 100) / 100;
  const equity = Math.round((balance - paidWithdrawals) * 100) / 100;
  const status = snap?.status ?? challenge?.status ?? "";
  const isTrading = status === "ACTIVE" || status === "FUNDED";
  const expiryClock = new Date(now + duration * 1000).toLocaleTimeString(
    "en-GB",
    { hour12: false }
  );

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 400);
    return () => clearInterval(t);
  }, []);

  // ── live market: pull real quotes and anchor the price engine to them ──
  useEffect(() => {
    let stop = false;
    async function pull() {
      try {
        const res = await fetch("/api/quotes", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as {
          changes?: Record<string, number>;
          tick?: Record<string, number>;
        };
        if (stop) return;
        if (j.tick) setTicks((prev) => ({ ...prev, ...j.tick }));
        if (j.changes) setLiveChanges(j.changes);
      } catch {}
    }
    void pull();
    const t = setInterval(pull, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  // ── fast poll for the pair on screen: keep it locked to the real market ──
  useEffect(() => {
    let stop = false;
    async function pullOne() {
      try {
        const res = await fetch(`/api/quotes?symbol=${symbol}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const j = (await res.json()) as {
          changes?: Record<string, number>;
          tick?: Record<string, number>;
        };
        if (stop) return;
        if (j.tick) setTicks((prev) => ({ ...prev, ...j.tick }));
        if (j.changes) setLiveChanges(j.changes);
      } catch {}
    }
    void pullOne();
    const t = setInterval(pullOne, 1000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [symbol]);

  function pickSymbol(next: string) {
    if (next === symbol) return;
    setSymbol(next);
  }

  function fireToast(t: Toast) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }

  // ── poll + settle ──
  const refresh = useCallback(async () => {
    if (!challengeId) return;
    try {
      const res = await fetch(`/api/trades?challengeId=${challengeId}`);
      if (!res.ok) return;
      const data = await res.json();
      setOpen(data.open || []);
      setClosed(data.closed || []);
      setSnap(data.challenge || null);

      const due = (data.open || [])
        .filter(
          (t: TradeRow) => new Date(t.expiryAt).getTime() <= Date.now()
        )
        .sort(
          (a: TradeRow, b: TradeRow) =>
            new Date(a.expiryAt).getTime() - new Date(b.expiryAt).getTime()
        );
      for (const t of due as TradeRow[]) {
        const sres = await fetch("/api/trades/settle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tradeId: t.id }),
        });
        const sdata = await sres.json();
        if (sres.ok && sdata.ok) {
          setSnap(sdata.challenge);
          if (sdata.won === true)
            fireToast({
              kind: "win",
              title: `+$${sdata.profit.toFixed(2)} won`,
              body: `${t.symbol} ${t.direction} • ${money(t.stake)}`,
            });
          else if (sdata.won === false)
            fireToast({
              kind: "lose",
              title: `-$${Math.abs(sdata.profit).toFixed(2)} lost`,
              body: `${t.symbol} ${t.direction} • ${money(t.stake)}`,
            });
          else fireToast({ kind: "info", title: "Draw — stake refunded" });

          if (sdata.challenge?.breachReason) {
            fireToast({
              kind: "error",
              title: "Account breached",
              body: sdata.challenge.breachReason,
            });
          }
        }
      }
    } catch {}
  }, [challengeId]);

  useEffect(() => {
    // Initial fetch is deferred off the effect body so the polling loop is
    // the only state-update trigger (react-hooks/set-state-in-effect).
    const init = setTimeout(() => {
      void refresh();
    }, 0);
    const t = setInterval(() => {
      void refresh();
    }, 1000);
    return () => {
      clearTimeout(init);
      clearInterval(t);
    };
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  async function place(direction: "UP" | "DOWN") {
    if (busy) return;
    if (!amt || amt < 1) {
      fireToast({ kind: "error", title: "Enter a valid amount (min $1)" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId,
          symbol,
          direction,
          stake: amt,
          durationSec: duration,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        fireToast({ kind: "error", title: data.error || "Trade failed" });
      } else {
        fireToast({
          kind: "info",
          title: `${direction} ${money(amt)} — ${info.name}`,
          body: `Expires in ${duration}s`,
        });
        refresh();
      }
    } catch {
      fireToast({ kind: "error", title: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  }

  const groups = useMemo(() => {
    const match = (s: string) =>
      !search ||
      SYMBOLS[s].name.toLowerCase().includes(search.toLowerCase()) ||
      s.toLowerCase().includes(search.toLowerCase());
    return (["forex", "metals", "crypto"] as const)
      .map((cat) => ({
        key: cat,
        label: CATEGORY_LABELS[cat],
        syms: SYMBOL_LIST.filter(
          (s) => SYMBOLS[s].category === cat && match(s)
        ),
      }))
      .filter(
        (g) => g.syms.length > 0 && (catFilter === "all" || g.key === catFilter)
      );
  }, [search, catFilter]);

  if (challenges.length === 0) {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 text-center"
        style={{ background: BG }}
      >
        <p className="text-lg font-semibold text-white">
          No active challenges to trade on
        </p>
        <p className="max-w-sm text-sm" style={{ color: MUTED }}>
          Buy a challenge or activate a demo account to start trading in the
          terminal.
        </p>
        <Link href="/dashboard" className="btn-primary">
          Go to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col select-none"
      style={{ background: BG, color: "#fff" }}
    >
      {/* ── top bar ── */}
      <header
        className="flex h-12 shrink-0 items-center gap-3 border-b px-3"
        style={{ borderColor: "rgba(255,255,255,.07)", background: PANEL }}
      >
        <div className="flex items-center gap-2">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-md text-sm font-black text-slate-950"
            style={{ background: UP }}
          >
            A
          </span>
          <span className="text-sm font-bold tracking-wide">ApexFunds</span>
        </div>

        <div className="ml-4 flex items-center gap-2">
          <select
            value={challengeId}
            onChange={(e) => setChallengeId(e.target.value)}
            className="rounded-md border-none px-2 py-1.5 text-xs font-semibold text-white outline-none"
            style={{ background: "#222634" }}
          >
            {challenges.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
            style={{
              background:
                status === "FUNDED"
                  ? "rgba(15,175,89,.18)"
                  : status === "ACTIVE"
                    ? "rgba(43,153,255,.18)"
                    : "rgba(255,68,89,.18)",
              color:
                status === "FUNDED"
                  ? UP
                  : status === "ACTIVE"
                    ? "#2B99FF"
                    : DOWN,
            }}
          >
            {status || "—"}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <div className="text-right leading-tight">
            <div className="text-[10px] uppercase" style={{ color: MUTED }}>
              Available
            </div>
            <div className="font-mono text-base font-bold" style={{ color: UP }}>
              {money(available)}
            </div>
            <div className="font-mono text-[10px]" style={{ color: MUTED }}>
              Equity {money(equity)}
            </div>
          </div>
          <button
            onClick={toggleFullscreen}
            className="rounded-md p-2 transition-colors hover:bg-white/10"
            style={{ color: MUTED }}
            title="Toggle fullscreen"
          >
            <Icon d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </button>
          <Link
            href="/dashboard"
            className="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-white/10"
            style={{ background: "rgba(255,255,255,.06)", color: MUTED }}
          >
            ← Dashboard
          </Link>
        </div>
      </header>

      {snap?.breachReason && (
        <div
          className="shrink-0 px-4 py-2 text-xs font-semibold"
          style={{ background: "rgba(255,68,89,.12)", color: DOWN }}
        >
          Account closed: {snap.breachReason} — new trades are disabled.
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── chart column ── */}
        <section className="flex min-w-0 flex-1 flex-col">
          {/* asset bar */}
          <div
            className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b px-3"
            style={{ borderColor: "rgba(255,255,255,.07)" }}
          >
            <button
              onClick={() => setAssetOpen((v) => !v)}
              className="flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 font-semibold transition-colors hover:bg-white/5"
              style={{ background: "rgba(255,255,255,.05)" }}
            >
              <span className="flex h-2 w-2 rounded-full" style={{ background: UP }} />
              {info.name}
              <span
                className="rounded px-1 py-0.5 text-[9px] font-black uppercase"
                style={{
                  background: marketOpen
                    ? "rgba(15,175,89,.18)"
                    : "rgba(240,185,11,.18)",
                  color: marketOpen ? UP : "#F0B90B",
                }}
                title={
                  marketOpen
                    ? "Real market open — live feed"
                    : "Market closed — price frozen"
                }
              >
                {marketOpen ? "Live" : "Closed"}
              </span>
              <span style={{ color: UP }}>{info.payout}%</span>
              <span style={{ color: MUTED }}>▾</span>
            </button>

            <div className="mx-1 h-5 w-px shrink-0 bg-white/10" />

            <div
              className="shrink-0 font-mono text-lg font-bold"
              style={{ color: change >= 0 ? UP : DOWN }}
            >
              {fmtPrice(symbol, price)}
            </div>
            <div
              className="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold"
              style={{
                background: change >= 0 ? "rgba(15,175,89,.12)" : "rgba(255,68,89,.12)",
                color: change >= 0 ? UP : DOWN,
              }}
            >
              {change >= 0 ? "+" : ""}
              {change.toFixed(2)}%
            </div>

            <span
              className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-bold"
              style={{ background: "rgba(255,255,255,.06)", color: MUTED }}
              title="Time until current candle closes"
            >
              ⏱ {(closeIn / 1000).toFixed(0)}s
            </span>

            <div className="ml-auto flex shrink-0 items-center gap-1">
              {TIMEFRAMES.map((t) => (
                <button
                  key={t.ms}
                  onClick={() => setTfMs(t.ms)}
                  className="rounded px-2 py-1 text-xs font-semibold transition-colors"
                  style={{
                    background: tfMs === t.ms ? "rgba(43,153,255,.2)" : "transparent",
                    color: tfMs === t.ms ? "#2B99FF" : MUTED,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* chart + dropdowns */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="relative min-h-0 flex-1">
              <TradingViewChart symbol={tvSymbol} interval={tvInterval} />
              {chartOverlays.length > 0 && (
                <div className="pointer-events-none absolute right-2 top-2 z-10 space-y-1">
                  {chartOverlays.map((o, i) => {
                    const color = o.direction === "UP" ? UP : DOWN;
                    const expIn = Math.max(
                      0,
                      Math.round((o.expiryAt - now) / 1000)
                    );
                    return (
                      <div
                        key={`${o.openedAt}-${i}`}
                        className="rounded-md px-2 py-1 font-mono text-[10px] font-semibold shadow-lg"
                        style={{
                          background: "rgba(18,20,32,.92)",
                          border: `1px solid ${color}`,
                          color,
                        }}
                      >
                        {o.direction === "UP" ? "▲" : "▼"} E{" "}
                        {fmtPrice(symbol, o.entryPrice)} · exp{" "}
                        {new Date(o.expiryAt).toLocaleTimeString("en-GB", {
                          hour12: false,
                        })}{" "}
                        ({expIn}s)
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* asset dropdown */}
            {assetOpen && (
              <>
                <button
                  className="absolute inset-0 z-20 cursor-default"
                  aria-label="Close assets"
                  onClick={() => setAssetOpen(false)}
                />
                <div
                  className="absolute left-3 top-3 z-30 w-80 overflow-hidden rounded-lg shadow-2xl"
                  style={{ background: PANEL, border: "1px solid rgba(255,255,255,.08)" }}
                >
                  <div
                    className="p-2"
                    style={{ borderBottom: "1px solid rgba(255,255,255,.07)" }}
                  >
                    <input
                      autoFocus
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search asset…"
                      className="w-full rounded-md px-3 py-2 text-sm outline-none"
                      style={{ background: "#222634", color: "#fff" }}
                    />
                    <div className="mt-2 flex flex-wrap gap-1">
                      {CAT_FILTERS.map((f) => (
                        <button
                          key={f.id}
                          onClick={() => setCatFilter(f.id)}
                          className="rounded px-2 py-1 text-[11px] font-semibold transition-colors"
                          style={{
                            background:
                              catFilter === f.id ? "rgba(43,153,255,.22)" : "rgba(255,255,255,.05)",
                            color: catFilter === f.id ? "#2B99FF" : MUTED,
                          }}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {groups.map((g) => (
                      <div key={g.key}>
                        <div
                          className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider"
                          style={{ background: "#222634", color: MUTED }}
                        >
                          {g.label}
                        </div>
                        {g.syms.map((s) => {
                          const ch = liveChanges[s] ?? 0;
                          const active = s === symbol;
                          return (
                            <button
                              key={s}
                              onClick={() => {
                                pickSymbol(s);
                                setAssetOpen(false);
                                setSearch("");
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/5"
                              style={active ? { background: "rgba(43,153,255,.12)" } : undefined}
                            >
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: UP }} />
                              <span className="flex-1 text-sm font-semibold">
                                {SYMBOLS[s].name}
                              </span>
                              <span
                                className="text-xs font-medium"
                                style={{ color: ch >= 0 ? UP : DOWN }}
                              >
                                {ch >= 0 ? "+" : ""}
                                {ch.toFixed(2)}%
                              </span>
                              <span className="w-9 text-right text-xs font-bold" style={{ color: UP }}>
                                {SYMBOLS[s].payout}%
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                    {groups.length === 0 && (
                      <p className="px-3 py-4 text-center text-xs" style={{ color: MUTED }}>
                        No assets found
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* open trades strip */}
          <div
            className="h-24 shrink-0 overflow-x-auto border-t px-3 py-2"
            style={{ borderColor: "rgba(255,255,255,.07)", background: "#20242F" }}
          >
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>
                Open trades
              </span>
              <span className="rounded bg-white/10 px-1.5 text-[10px] font-bold">
                {open.length}
              </span>
            </div>
            {open.length === 0 ? (
              <p className="text-xs" style={{ color: "#4B5163" }}>
                No active trades — pick ↑ UP or ↓ DOWN to place one
              </p>
            ) : (
              <div className="flex gap-2">
                {open.map((t) => {
                  const exp = new Date(t.expiryAt).getTime();
                  const left = Math.max(0, Math.ceil((exp - now) / 1000));
                  const cur = ticks[t.symbol] ?? t.entryPrice ?? 0;
                  const ahead =
                    t.direction === "UP"
                      ? cur > (t.entryPrice || cur)
                      : cur < (t.entryPrice || cur);
                  const winAmt = ((t.stake * (t.payoutPct || 85)) / 100).toFixed(2);
                  return (
                    <button
                      key={t.id}
                      onClick={() => pickSymbol(t.symbol)}
                      className="w-40 shrink-0 rounded-md px-2.5 py-1.5 text-left"
                      style={{
                        background: PANEL,
                        border: `1px solid ${ahead ? UP : DOWN}55`,
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">
                          {SYMBOLS[t.symbol]?.name || t.symbol}
                        </span>
                        <span
                          className="rounded px-1 text-[10px] font-black"
                          style={{
                            background: (t.direction === "UP" ? UP : DOWN) + "22",
                            color: t.direction === "UP" ? UP : DOWN,
                          }}
                        >
                          {t.direction === "UP" ? "↑" : "↓"}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between text-[11px]">
                        <span style={{ color: MUTED }}>${t.stake}</span>
                        <span
                          className="font-mono font-bold"
                          style={{ color: left <= 5 ? "#F0B90B" : "#fff" }}
                        >
                          0:{String(left).padStart(2, "0")}
                        </span>
                        <span style={{ color: ahead ? UP : DOWN }}>
                          {ahead ? "+$" : "-$"}
                          {ahead ? winAmt : t.stake}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between font-mono text-[10px]">
                        <span style={{ color: MUTED }}>
                          E {fmtPrice(t.symbol, t.entryPrice ?? cur)}
                        </span>
                        <span style={{ color: ahead ? UP : DOWN }}>
                          {fmtPrice(t.symbol, cur)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* ── right trade panel ── */}
        <aside
          className="flex w-[290px] shrink-0 flex-col"
          style={{ background: PANEL, borderLeft: "1px solid rgba(255,255,255,.07)" }}
        >
          {/* time */}
          <div className="p-3" style={{ borderBottom: "1px solid rgba(255,255,255,.07)" }}>
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>
              Time
            </div>
            <div
              className="mb-2 flex items-center justify-center gap-2 rounded-md py-2.5 font-mono text-xl font-bold"
              style={{ background: "#222634" }}
            >
              <Icon d="M12 8v4l2.5 2.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={16} />
              {expiryClock}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {DURATIONS.map((d) => (
                <button
                  key={d.sec}
                  onClick={() => setDuration(d.sec)}
                  className="rounded-md py-1.5 text-xs font-bold transition-colors"
                  style={{
                    background: duration === d.sec ? UP : "#222634",
                    color: duration === d.sec ? "#0B1116" : MUTED,
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* investment */}
          <div className="p-3" style={{ borderBottom: "1px solid rgba(255,255,255,.07)" }}>
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>
              Investment
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setStake(String(Math.max(1, amt - 5)))}
                className="h-10 w-10 shrink-0 rounded-md text-lg font-bold"
                style={{ background: "#222634", color: MUTED }}
              >
                −
              </button>
              <div className="relative flex-1">
                <span
                  className="absolute left-3 top-1/2 -translate-y-1/2 font-mono"
                  style={{ color: MUTED }}
                >
                  $
                </span>
                <input
                  value={stake}
                  onChange={(e) => setStake(e.target.value.replace(/[^\d.]/g, ""))}
                  className="h-10 w-full rounded-md pl-7 pr-3 text-center font-mono text-base font-bold outline-none"
                  style={{ background: "#222634", color: "#fff" }}
                />
              </div>
              <button
                onClick={() => setStake(String(amt + 5))}
                className="h-10 w-10 shrink-0 rounded-md text-lg font-bold"
                style={{ background: "#222634", color: MUTED }}
              >
                +
              </button>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {[5, 10, 25, 50].map((v) => (
                <button
                  key={v}
                  onClick={() => setStake(String(v))}
                  className="rounded-md py-1.5 text-xs font-semibold transition-colors hover:bg-white/10"
                  style={{ background: "rgba(255,255,255,.05)", color: MUTED }}
                >
                  ${v}
                </button>
              ))}
            </div>
            <div
              className="mt-2 flex items-center justify-between rounded-md px-2.5 py-2 text-xs"
              style={{ background: "#222634" }}
            >
              <span style={{ color: MUTED }}>
                Payout <b style={{ color: "#fff" }}>{info.payout}%</b>
              </span>
              <span style={{ color: MUTED }}>
                Profit{" "}
                <b style={{ color: UP }}>+${netProfit.toFixed(2)}</b>
              </span>
            </div>
          </div>

          {/* buttons */}
          <div className="space-y-2 p-3">
            <button
              disabled={!isTrading || busy}
              onClick={() => place("UP")}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-lg text-base font-black tracking-wide text-white transition-transform active:scale-[0.98] disabled:opacity-40"
              style={{ background: `linear-gradient(180deg, ${UP}, #0B9150)` }}
            >
              <span className="text-xl">↑</span> UP
            </button>
            <button
              disabled={!isTrading || busy}
              onClick={() => place("DOWN")}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-lg text-base font-black tracking-wide text-white transition-transform active:scale-[0.98] disabled:opacity-40"
              style={{ background: `linear-gradient(180deg, ${DOWN}, #D32B3E)` }}
            >
              <span className="text-xl">↓</span> DOWN
            </button>
            {!isTrading && (
              <p className="text-center text-[11px]" style={{ color: DOWN }}>
                This account is not tradable
              </p>
            )}
          </div>

          {/* history */}
          <div
            className="flex min-h-0 flex-1 flex-col border-t"
            style={{ borderColor: "rgba(255,255,255,.07)" }}
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>
                Trades
              </span>
              <span className="rounded bg-white/10 px-1.5 text-[10px] font-bold">
                {closed.length}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {closed.length === 0 ? (
                <p className="px-1 py-3 text-xs" style={{ color: "#4B5163" }}>
                  Closed trades will appear here
                </p>
              ) : (
                closed.map((t) => (
                  <div
                    key={t.id}
                    className="mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
                    style={{ background: "rgba(255,255,255,.03)" }}
                  >
                    <span style={{ color: MUTED }}>
                      {new Date(t.closedAt).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">
                        {SYMBOLS[t.symbol]?.name || t.symbol}
                      </div>
                      <div
                        className="truncate font-mono text-[10px]"
                        style={{ color: MUTED }}
                        title="entry → close"
                      >
                        {t.entryPrice != null
                          ? fmtPrice(t.symbol, t.entryPrice)
                          : "—"}
                        {" → "}
                        {t.closePrice != null
                          ? fmtPrice(t.symbol, t.closePrice)
                          : "—"}
                      </div>
                    </div>
                    <span style={{ color: t.direction === "UP" ? UP : DOWN }}>
                      {t.direction === "UP" ? "↑" : "↓"}
                    </span>
                    <span style={{ color: MUTED }}>${t.stake}</span>
                    <span
                      className="w-16 text-right font-mono font-bold"
                      style={{
                        color: t.profit > 0 ? UP : t.profit < 0 ? DOWN : MUTED,
                      }}
                    >
                      {t.profit > 0 ? "+" : ""}
                      {t.profit.toFixed(2)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* toast */}
      {toast && (
        <div
          className="fixed bottom-5 left-16 z-50 w-72 rounded-lg border px-4 py-3 shadow-2xl"
          style={{
            background: PANEL,
            borderColor:
              toast.kind === "win"
                ? UP
                : toast.kind === "lose" || toast.kind === "error"
                  ? DOWN
                  : "#3A4157",
          }}
        >
          <p
            className="text-sm font-bold"
            style={{
              color:
                toast.kind === "win"
                  ? UP
                  : toast.kind === "info"
                    ? "#F0B90B"
                    : DOWN,
            }}
          >
            {toast.title}
          </p>
          {toast.body && (
            <p className="mt-0.5 text-xs" style={{ color: MUTED }}>
              {toast.body}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
