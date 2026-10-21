"use client";

import { useState } from "react";

export type FaqItem = {
  q: string;
  a: string;
  cat: "Challenge" | "Payouts" | "Rules" | "General";
};

const CATS = ["All", "Challenge", "Payouts", "Rules", "General"] as const;

export function FaqTabs({ items }: { items: FaqItem[] }) {
  const [cat, setCat] = useState<(typeof CATS)[number]>("All");
  const [open, setOpen] = useState<number | null>(0);

  const visible =
    cat === "All" ? items : items.filter((f) => f.cat === cat);

  return (
    <div>
      <div
        role="tablist"
        aria-label="FAQ categories"
        className="flex flex-wrap justify-center gap-2"
      >
        {CATS.map((c) => {
          const active = c === cat;
          return (
            <button
              key={c}
              role="tab"
              aria-selected={active}
              onClick={() => {
                setCat(c);
                setOpen(0);
              }}
              className={`cursor-pointer rounded-full border px-4 py-1.5 text-sm font-semibold transition-all ${
                active
                  ? "border-blue-500/60 bg-blue-500 text-white"
                  : "border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-600 hover:text-white"
              }`}
            >
              {c}
            </button>
          );
        })}
      </div>

      <div className="mt-8 space-y-3">
        {visible.map((f, i) => {
          const isOpen = open === i;
          return (
            <div
              key={f.q}
              className={`overflow-hidden rounded-2xl border transition-colors ${
                isOpen
                  ? "border-blue-500/30 bg-slate-900/70"
                  : "border-white/[0.06] bg-slate-900/40"
              }`}
            >
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <span className="font-semibold text-white">{f.q}</span>
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 text-slate-400 transition-transform duration-300 ${
                    isOpen ? "rotate-45 text-blue-400" : ""
                  }`}
                  aria-hidden
                >
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path d="M8 3v10M3 8h10" strokeLinecap="round" />
                  </svg>
                </span>
              </button>
              <div
                className="grid transition-[grid-template-rows] duration-300 ease-out"
                style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
              >
                <div className="overflow-hidden">
                  <p className="px-5 pb-5 text-sm leading-relaxed text-slate-400">
                    {f.a}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="text-center text-sm text-slate-500">
            No questions in this category yet.
          </p>
        )}
      </div>
    </div>
  );
}
