"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { purchaseChallengeAction } from "@/lib/actions/trader";
import { money } from "@/lib/utils";
import { SITE } from "@/lib/config";

export type PhaseRow = {
  phase: string;
  targetPct: number;
  maxDailyLossPct: number;
  maxTotalDrawdownPct: number;
  minTradingDays: number;
};

export type PackageDTO = {
  id: string;
  slug: string;
  name: string;
  accountSize: number;
  price: number;
  phases: PhaseRow[];
};

type ChallengeType = "TWO_STEP" | "ONE_STEP" | "INSTANT";

const TYPE_TABS: {
  id: ChallengeType;
  label: string;
  blurb: string;
  badge?: string;
}[] = [
  {
    id: "TWO_STEP",
    label: "2-Step",
    blurb: "Two phases. Lowest entry price. Prove consistency.",
    badge: "Best Value",
  },
  {
    id: "ONE_STEP",
    label: "1-Step",
    blurb: "One phase straight to funded. Faster, slightly pricier.",
    badge: "Popular",
  },
  {
    id: "INSTANT",
    label: "Instant",
    blurb: "Skip the challenge. Funded from day one, tighter rules.",
    badge: "Pro",
  },
];

function typeOf(slug: string): ChallengeType | null {
  if (slug.startsWith("ONE_STEP")) return "ONE_STEP";
  if (slug.startsWith("TWO_STEP")) return "TWO_STEP";
  if (slug.startsWith("INSTANT")) return "INSTANT";
  return null;
}

export function ChallengePicker({ packages }: { packages: PackageDTO[] }) {
  const [type, setType] = useState<ChallengeType>("TWO_STEP");
  const [size, setSize] = useState<number | null>(null);

  const availableTabs = useMemo(() => {
    const present = new Set(
      packages.map((p) => typeOf(p.slug)).filter(Boolean)
    );
    return TYPE_TABS.filter((t) => present.has(t.id));
  }, [packages]);

  const effectiveType = useMemo(
    () =>
      availableTabs.some((t) => t.id === type)
        ? type
        : (availableTabs[0]?.id ?? type),
    [availableTabs, type]
  );

  const typePackages = useMemo(
    () => packages.filter((p) => typeOf(p.slug) === effectiveType),
    [packages, effectiveType]
  );

  const sizes = useMemo(
    () => Array.from(new Set(typePackages.map((p) => p.accountSize))).sort((a, b) => a - b),
    [typePackages]
  );

  const activeSize = size !== null && sizes.includes(size) ? size : (sizes[0] ?? 0);
  const selected = typePackages.find((p) => p.accountSize === activeSize) ?? typePackages[0];
  const activeTab = availableTabs.find((t) => t.id === effectiveType)!;

  if (packages.length === 0 || availableTabs.length === 0) return null;

  const cells = (selected?.phases.length ?? 0) + 1;
  const phaseGridCols =
    cells === 3 ? "sm:grid-cols-3" : cells === 2 ? "sm:grid-cols-2" : "sm:grid-cols-1";

  return (
    <div className="mx-auto max-w-5xl">
      {/* Challenge type tabs */}
      <div
        role="tablist"
        aria-label="Challenge type"
        className={`grid gap-3 ${availableTabs.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
      >
        {availableTabs.map((tab) => {
          const active = tab.id === effectiveType;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={active}
              onClick={() => setType(tab.id)}
              className={`group relative rounded-2xl border p-4 text-left transition-all cursor-pointer ${
                active
                  ? "border-blue-500/60 bg-blue-500/[0.07]"
                  : "border-slate-800 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-900/70"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-base font-bold ${active ? "text-white" : "text-slate-300"}`}
                >
                  {tab.label}
                </span>
                {tab.badge && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      active
                        ? "bg-blue-500/20 text-blue-300"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                {tab.blurb}
              </p>
              {active && (
                <span
                  className="absolute inset-x-4 -bottom-px h-px"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, rgba(59,130,246,0.85), transparent)",
                  }}
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Account size pills */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Account size
        </span>
        {sizes.map((s) => {
          const active = s === activeSize;
          return (
            <button
              key={s}
              onClick={() => setSize(s)}
              className={`tabular rounded-xl border px-4 py-2 text-sm font-semibold transition-all cursor-pointer ${
                active
                  ? "border-blue-500/60 bg-blue-500 text-white"
                  : "border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-600 hover:text-white"
              }`}
            >
              {(s / 1000) % 1 === 0 ? `$${s / 1000}K` : `$${s.toLocaleString()}`}
            </button>
          );
        })}
      </div>

      {/* Selected plan card */}
      {selected && (
        <div className="card mt-8 overflow-hidden p-0">
          <div
            className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] px-6 py-5"
            style={{
              background:
                "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(34,211,238,0.05))",
            }}
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">
                {activeTab.label} Challenge
              </p>
              <p className="tabular mt-1 text-2xl font-extrabold text-white">
                {money(selected.accountSize, "USD").replace(".00", "")}
                <span className="ml-2 text-sm font-medium text-slate-400">
                  account
                </span>
              </p>
            </div>
            <div className="text-right">
              <p className="tabular text-3xl font-extrabold text-blue-400">
                {money(selected.price)}
              </p>
              <p className="text-xs text-slate-500">one-time fee · no subscription</p>
            </div>
          </div>

          {/* Phase rule grid */}
          <div className={`grid gap-px bg-white/[0.05] ${phaseGridCols}`}>
            {selected.phases.map((phase, i) => (
              <div key={i} className="bg-[#0a0e16] px-6 py-5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  {phase.phase === "FUNDED"
                    ? "Funded rules"
                    : `Phase ${i + 1}`}
                </p>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-slate-400">Profit target</dt>
                    <dd className="tabular font-semibold text-white">
                      {phase.targetPct > 0 ? `${phase.targetPct}%` : "—"}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-slate-400">Daily loss limit</dt>
                    <dd className="tabular font-semibold text-white">
                      {phase.maxDailyLossPct}%
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-slate-400">Max drawdown (from peak)</dt>
                    <dd className="tabular font-semibold text-white">
                      {phase.maxTotalDrawdownPct}%
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-slate-400">Min trading days</dt>
                    <dd className="tabular font-semibold text-white">
                      {phase.minTradingDays > 0 ? phase.minTradingDays : "—"}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
            {/* Shared perks column */}
            <div className="bg-[#0a0e16] px-6 py-5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-blue-400">
                Included
              </p>
              <ul className="mt-3 space-y-2 text-sm text-slate-300">
                <li className="flex items-center gap-2">
                  <CheckIcon /> Profit split up to {SITE.payoutSplitPct}%
                </li>
                <li className="flex items-center gap-2">
                  <CheckIcon /> Payouts every {SITE.payoutDaysInterval} days
                </li>
                <li className="flex items-center gap-2">
                  <CheckIcon /> No time limit on phases
                </li>
                <li className="flex items-center gap-2">
                  <CheckIcon /> Auto trade sync dashboard
                </li>
              </ul>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
            <p className="text-xs text-slate-500">
              One-time payment. Non-refundable once activated —{" "}
              <Link
                href="/legal/refund"
                className="underline underline-offset-2 transition-colors hover:text-slate-300"
              >
                Refund Policy
              </Link>
              .
            </p>
            <form action={purchaseChallengeAction.bind(null, selected.id)}>
              <button type="submit" className="btn-primary px-8 py-3 text-base">
                Buy {activeTab.label} Challenge — {money(selected.price)}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-blue-400"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.3 3.3 6.8-6.8a1 1 0 0 1 1.4 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}
