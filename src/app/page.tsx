import Link from "next/link";
import { db } from "@/lib/db";
import { SITE } from "@/lib/config";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import {
  ChallengePicker,
  type PackageDTO,
  type PhaseRow,
} from "@/components/challenge-picker";
import { FaqTabs, type FaqItem } from "@/components/faq-tabs";
import { money } from "@/lib/utils";

const buildFaqs = (kycRequired: boolean): FaqItem[] => [
  {
    q: "What is a funded trading account?",
    cat: "Challenge",
    a: `A funded account lets you trade with ${SITE.name}'s capital after passing a challenge. You keep up to ${SITE.payoutSplitPct}% of profits and risk nothing beyond the challenge fee.`,
  },
  {
    q: "How do I become a funded trader?",
    cat: "Challenge",
    a: "Choose a challenge size, complete the trading objectives (profit target within the loss limits), and pass every phase. Your account activates in your dashboard as soon as payment is confirmed, and you get an email the moment it goes funded — trade it straight from the built-in web terminal.",
  },
  {
    q: "Which challenge should I pick?",
    cat: "Challenge",
    a: "2-Step has the lowest entry price and is best for most traders. 1-Step gets you funded faster at a slightly higher fee. Instant skips the evaluation entirely — funded from day one with tighter risk rules.",
  },
  {
    q: "How do payouts work?",
    cat: "Payouts",
    a: `First payout is available ${SITE.firstPayoutDays} days after your account goes funded, then every ${SITE.payoutDaysInterval} days. Minimum payout is $${SITE.minPayout}. Profits are split ${SITE.payoutSplitPct}/${100 - SITE.payoutSplitPct} in your favor.`,
  },
  {
    q: "Which payout methods do you support?",
    cat: "Payouts",
    a: "Payouts are sent to your USDT wallet (TRC-20 or ERC-20). Network selection and wallet address are configured in your dashboard settings.",
  },
  {
    q: "Is KYC required?",
    cat: "Payouts",
    a: kycRequired
      ? "KYC is required before your first payout to comply with anti-money-laundering regulations. Complete it early in dashboard settings to avoid payout delays."
      : "KYC is not required before payouts right now — you can request a withdrawal to your USDT wallet as soon as your payout cycle opens. You may still submit verification any time in dashboard settings; if the requirement is switched on later, an approved profile means no delays.",
  },
  {
    q: "What happens if I break a rule?",
    cat: "Rules",
    a: "If you hit the daily loss limit or maximum drawdown, the account is closed immediately. On challenge accounts you can buy a new one; on funded accounts the account is breached.",
  },
  {
    q: "What are the daily loss and drawdown limits?",
    cat: "Rules",
    a: "Daily loss limits are 3–5% and maximum drawdown is 6–10% depending on the challenge type — and drawdown is trailing: it is measured from your highest balance, so giving back 10% from your peak closes the account. Limits are checked in real time on closed trades and vary per phase — the exact numbers for each plan are shown on its pricing card.",
  },
  {
    q: "Is there a consistency rule?",
    cat: "Rules",
    a: "No single day may represent more than 40% of total profit when you hit the target, and minimum trading days must be met per phase.",
  },
  {
    q: "Which platform do I trade on?",
    cat: "General",
    a: "You trade in the built-in web terminal inside your dashboard — nothing to download, no third-party logins. Your account activates after payment confirmation and every trade syncs to your phase progress automatically.",
  },
  {
    q: "Can I hold trades overnight or over weekends?",
    cat: "General",
    a: "No — binary options positions settle in 30 seconds to 5 minutes, so there is no overnight or weekend exposure to manage. There are no session windows or cut-off times: trade any time from the web terminal.",
  },
];

function maskName(name?: string | null) {
  if (!name) return "Trader";
  const first = name.trim().split(/\s+/)[0] || "Trader";
  return `${first[0]}***${first.slice(-1)}`;
}

/** Seeded demo accounts (same list as instrumentation.ts + demo-seed.ts). */
const DEMO_EMAILS = new Set([
  "demo@apexfunds.com",
  "admin@apexfunds.com",
  "trader1@example.com",
  "trader2@example.com",
]);
function isDemoEmail(email?: string | null) {
  if (!email) return false;
  const e = email.toLowerCase();
  return DEMO_EMAILS.has(e) || e.startsWith("e2e_");
}

const WHY = [
  {
    n: "01",
    t: "Rules you can read in one screen",
    d: "Every limit — daily loss, drawdown, targets, minimum days — is published on the pricing card before you pay. No hidden clauses in a 40-page PDF.",
    chips: ["Fixed & published", "Enforced automatically"],
  },
  {
    n: "02",
    t: `Up to ${SITE.payoutSplitPct}% profit split, from day one`,
    d: `Your split is ${SITE.payoutSplitPct}/${100 - SITE.payoutSplitPct} in your favor on every funded account. No stepped scales, no “qualify first, then we talk” tiers.`,
    chips: [`Up to ${SITE.payoutSplitPct}% split`, `First payout in ${SITE.firstPayoutDays} days`],
  },
  {
    n: "03",
    t: "Every trade syncs automatically",
    d: "Place trades on the platform and watch progress update live in your dashboard — phase status, drawdown and targets, with zero manual uploads.",
    chips: ["Real-time sync", "Live phase tracking"],
  },
  {
    n: "04",
    t: "Support that answers",
    d: `Real humans on email and Telegram (${SITE.telegram}), around the clock for funded traders. Payout and account questions don't sit in a queue for days.`,
    chips: ["24/7 for funded", "Telegram & email"],
  },
];

export default async function HomePage() {
  const packages = await db.package.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });

  const packageDTOs: PackageDTO[] = packages.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    accountSize: p.accountSize,
    price: p.price,
    phases: JSON.parse(p.phasesJson) as PhaseRow[],
  }));

  const [recentPayouts, kycSetting] = await Promise.all([
    db.payout.findMany({
      where: { status: "PAID" },
      orderBy: { processedAt: "desc" },
      take: 8,
      select: {
        id: true,
        traderAmount: true,
        amount: true,
        network: true,
        processedAt: true,
        user: { select: { name: true, email: true } },
      },
    }),
    db.setting.findUnique({ where: { key: SITE.kycSettingKey } }),
  ]);

  const kycRequired = kycSetting
    ? kycSetting.value === "true"
    : SITE.kycRequiredBeforePayout;
  const faqs = buildFaqs(kycRequired);

  // Payout feed: real (non-seed) payouts are shown as live; demo-seeded ones
  // are labelled so they are never presented as real trader payouts.
  const payouts = recentPayouts.map((p) => ({
    ...p,
    demo: isDemoEmail(p.user?.email),
  }));
  const livePayouts = payouts.filter((p) => !p.demo);
  const feedDemoOnly = payouts.length > 0 && livePayouts.length === 0;
  const latestPaid = payouts[0] ?? null;

  // Certificate is built from the latest real PAID payout; seed/demo payouts
  // and the empty case are clearly labelled so nothing reads as a real award.
  const certName = latestPaid
    ? maskName(latestPaid.user?.name)
    : "Your name here";
  const certAmount = latestPaid
    ? money(latestPaid.traderAmount ?? latestPaid.amount)
    : "—";
  const certDate = latestPaid?.processedAt
    ? new Date(latestPaid.processedAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
  const certBadge = !latestPaid
    ? "Sample"
    : latestPaid.demo
      ? "Demo"
      : "Certified";
  const certCaption = !latestPaid
    ? "Sample certificate format — issued with every processed payout."
    : latestPaid.demo
      ? "Preview built from demo payout data — a certificate is issued with every processed payout."
      : "Issued automatically with every processed payout.";

  // Verified stats straight from config + active packages (no demo-derived
  // "funded traders"/"paid to traders" numbers on the landing page).
  const maxAccountSize = packages.reduce(
    (max, p) => Math.max(max, p.accountSize),
    0
  );

  // Model comparison: only sizes that exist for all three challenge types.
  const sizesOf = (prefix: string) =>
    new Set(
      packageDTOs
        .filter((p) => p.slug.startsWith(prefix))
        .map((p) => p.accountSize)
    );
  const twoSizes = sizesOf("TWO_STEP");
  const oneSizes = sizesOf("ONE_STEP");
  const inSizes = sizesOf("INSTANT");
  const commonSizes = Array.from(twoSizes)
    .filter((s) => oneSizes.has(s) && inSizes.has(s))
    .sort((a, b) => a - b);
  const sampleSize = commonSizes.includes(50000)
    ? 50000
    : (commonSizes[commonSizes.length - 1] ?? 0);
  const pick = (prefix: string) =>
    sampleSize > 0
      ? packageDTOs.find(
          (p) => p.slug.startsWith(prefix) && p.accountSize === sampleSize
        )
      : undefined;
  const twoStep = pick("TWO_STEP");
  const oneStep = pick("ONE_STEP");
  const instant = pick("INSTANT");
  const compareReady = !!twoStep && !!oneStep && !!instant;

  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        {/* ============ HERO — stacked statements, EZE style ============ */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 hairline-grid" aria-hidden />
          <div
            className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
            style={{
              background:
                "radial-gradient(circle, rgba(59,130,246,0.30), rgba(34,211,238,0.12) 45%, transparent 70%)",
            }}
            aria-hidden
          />
          <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-16 sm:px-6 lg:pb-20 lg:pt-24">
            <div className="max-w-4xl">
              <div className="animate-rise inline-flex items-center gap-2 rounded-full border border-blue-500/25 bg-blue-500/[0.08] px-4 py-1.5 text-xs font-semibold text-blue-300">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-pulse-dot rounded-full bg-blue-400" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" />
                </span>
                Binary Options Prop Firm
              </div>
              {/* Stacked punchy lines like EZE */}
              <h1 className="headline mt-7 text-4xl leading-[1.04] sm:text-6xl lg:text-7xl">
                Trade binary.
                <br />
                Get funded up to $100K.
                <br />
                <span className="gradient-text">
                  Keep {SITE.payoutSplitPct}% of profits.
                </span>
                <br />
                Get paid every {SITE.payoutDaysInterval} days.
              </h1>
              <p className="mt-7 max-w-xl text-lg leading-relaxed text-slate-400">
                Prove your skills on our evaluation, then trade our capital.
                Withdraw profits on schedule, keep {SITE.payoutSplitPct}%,
                and never risk more than the challenge fee.
              </p>
              <div className="mt-9 flex flex-wrap gap-4">
                <Link href="#challenges" className="btn-primary px-8 py-3.5 text-base">
                  Start Challenge
                </Link>
                {compareReady && (
                  <Link href="#compare" className="btn-secondary px-6 py-3 text-base">
                    Compare models
                  </Link>
                )}
              </div>
              {/* Trust chips */}
              <ul className="mt-10 flex flex-wrap items-center gap-2.5 text-sm font-medium">
                {[
                  `Payouts every ${SITE.payoutDaysInterval} days`,
                  "24/7 human support",
                  "Auto trade sync",
                  "No time limit on phases",
                ].map((c) => (
                  <li
                    key={c}
                    className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3.5 py-1.5 text-slate-200"
                  >
                    <CheckDot /> {c}
                  </li>
                ))}
              </ul>
            </div>

            {/* Stats strip — verified config/package facts only */}
            <div className="mt-16 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.07] sm:grid-cols-4">
              {[
                {
                  v:
                    (maxAccountSize / 1000) % 1 === 0
                      ? `$${maxAccountSize / 1000}K`
                      : `$${maxAccountSize.toLocaleString()}`,
                  l: "Max account size",
                },
                { v: `${SITE.payoutSplitPct}%`, l: "Profit split" },
                { v: `${SITE.firstPayoutDays} days`, l: "First payout" },
                { v: `$${SITE.minPayout}`, l: "Minimum payout" },
              ].map((s) => (
                <div key={s.l} className="bg-[#05070c] px-5 py-6 text-center">
                  <p className="tabular text-2xl font-extrabold text-white sm:text-3xl">
                    {s.v}
                  </p>
                  <p className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-500">
                    {s.l}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============ PAYOUT TICKER ============ */}
        <section
          id="payouts"
          className="border-y border-white/[0.06] bg-[#04060a] py-10"
        >
          <div className="mx-auto mb-6 max-w-7xl px-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2.5 text-lg font-bold text-white">
                {livePayouts.length > 0 && (
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-pulse-dot rounded-full bg-emerald-400" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                )}
                {livePayouts.length > 0 ? "Live payout feed" : "Payout feed"}
                {feedDemoOnly && (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                    Demo data
                  </span>
                )}
              </h2>
              <Link
                href="#challenges"
                className="text-sm font-semibold text-blue-400 hover:text-blue-300"
              >
                Start earning →
              </Link>
            </div>
            {feedDemoOnly && (
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                Seeded demo payouts shown as a preview — live trader payouts
                appear here as they are processed.
              </p>
            )}
          </div>
          {payouts.length > 0 ? (
            <div className="mask-fade-x relative overflow-hidden">
              <div className="animate-marquee flex w-max gap-4">
                {[...payouts, ...payouts].map((p, i) => (
                  <div
                    key={`${p.id}-${i}`}
                    className="flex w-64 shrink-0 items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-slate-900/60 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {maskName(p.user?.name)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {p.demo ? "demo payout" : p.network} ·{" "}
                        {p.processedAt
                          ? new Date(p.processedAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })
                          : "—"}
                      </p>
                    </div>
                    <span
                      className={`tabular shrink-0 text-sm font-bold ${
                        p.demo ? "text-amber-300" : "text-emerald-400"
                      }`}
                    >
                      +{money(p.traderAmount ?? p.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-7xl px-4 sm:px-6">
              <p className="rounded-xl border border-white/[0.06] bg-slate-900/40 px-5 py-4 text-sm text-slate-500">
                Payout feed goes live as soon as traders start getting paid —
                check back soon.
              </p>
            </div>
          )}
        </section>

        {/* ============ HOW IT WORKS ============ */}
        <section id="how" className="py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <p className="eyebrow">How it works</p>
              <h2 className="headline mt-3 text-3xl sm:text-4xl">
                Three steps to funded
              </h2>
            </div>
            <div className="mt-14 grid gap-6 md:grid-cols-3">
              {[
                {
                  n: "01",
                  t: "Pick a challenge",
                  d: "Choose account size ($5K–$100K) and challenge type that fits your style and budget.",
                },
                {
                  n: "02",
                  t: "Prove your skill",
                  d: "Hit the profit target while respecting daily loss and drawdown limits. Trades sync automatically.",
                },
                {
                  n: "03",
                  t: "Get funded & paid",
                  d: `Pass the phases and receive a funded account. Withdraw profits every ${SITE.payoutDaysInterval} days, keeping ${SITE.payoutSplitPct}%.`,
                },
              ].map((s) => (
                <div key={s.n} className="card card-spotlight">
                  <p className="tabular text-sm font-black text-blue-400">
                    {s.n}
                  </p>
                  <h3 className="mt-2 text-xl font-bold text-white">{s.t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">
                    {s.d}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============ WHY — numbered EZE-style blocks ============ */}
        <section className="border-y border-white/[0.06] bg-[#04060a] py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="eyebrow">Why {SITE.name}</p>
              <h2 className="headline mt-3 text-3xl sm:text-5xl">
                Why traders choose{" "}
                <span className="gradient-text">{SITE.name}</span>
              </h2>
            </div>
            <div className="mt-14 grid gap-5 lg:grid-cols-2">
              {WHY.map((w) => (
                <div key={w.n} className="card card-hover flex flex-col">
                  <div className="flex items-start gap-4">
                    <span className="tabular mt-1 text-sm font-black text-blue-400/80">
                      {w.n}
                    </span>
                    <div>
                      <h3 className="text-xl font-bold text-white">{w.t}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-slate-400">
                        {w.d}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {w.chips.map((c) => (
                          <span
                            key={c}
                            className="rounded-full border border-blue-500/25 bg-blue-500/[0.08] px-3 py-1 text-xs font-semibold text-blue-300"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============ CHALLENGE PICKER ============ */}
        <section id="challenges" className="py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <p className="eyebrow">Challenges</p>
              <h2 className="headline mt-3 text-3xl sm:text-4xl">
                Choose your challenge
              </h2>
              <p className="mt-4 text-slate-400">
                One-time fee. No subscriptions. No hidden costs. All prices in
                USD.
              </p>
            </div>
            <div className="mt-12">
              <ChallengePicker packages={packageDTOs} />
            </div>
          </div>
        </section>

        {/* ============ MODEL COMPARISON TABLE ============ */}
        {compareReady && twoStep && oneStep && instant && (
          <section
            id="compare"
            className="border-y border-white/[0.06] bg-[#04060a] py-20 sm:py-24"
          >
            <div className="mx-auto max-w-7xl px-4 sm:px-6">
              <div className="mx-auto max-w-2xl text-center">
                <p className="eyebrow">Comparison</p>
                <h2 className="headline mt-3 text-3xl sm:text-5xl">
                  One trader.
                  <br />
                  Three routes to funded.
                </h2>
                <p className="mt-4 text-slate-400">
                  The same ${sampleSize.toLocaleString()} account, bought three
                  ways. Here is how each model treats you.
                </p>
              </div>

              <div className="card mt-12 overflow-x-auto p-0">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500" />
                      <th className="px-5 py-4">
                        <p className="text-base font-bold text-white">2-Step</p>
                        <p className="text-xs font-normal text-slate-500">
                          Best value
                        </p>
                      </th>
                      <th className="px-5 py-4">
                        <p className="text-base font-bold text-white">1-Step</p>
                        <p className="text-xs font-normal text-slate-500">
                          Faster path
                        </p>
                      </th>
                      <th className="px-5 py-4">
                        <p className="text-base font-bold text-blue-400">
                          Instant
                        </p>
                        <p className="text-xs font-normal text-slate-500">
                          Funded day one
                        </p>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {[
                      {
                        label: "What you pay",
                        vals: [twoStep, oneStep, instant].map(
                          (p) => `${money(p.price)} one-time`
                        ),
                      },
                      {
                        label: "Phases to funded",
                        vals: [
                          "2 phases",
                          "1 phase",
                          "None — straight to funded",
                        ],
                      },
                      {
                        label: "Profit target",
                        vals: [
                          `${twoStep.phases[0]?.targetPct}% → ${twoStep.phases[1]?.targetPct}%`,
                          `${oneStep.phases[0]?.targetPct}%`,
                          "— (funded rules apply)",
                        ],
                      },
                      {
                        label: "Daily loss limit",
                        vals: [twoStep, oneStep, instant].map(
                          (p) => `${p.phases[0]?.maxDailyLossPct}%`
                        ),
                      },
                      {
                        label: "Max drawdown (trailing)",
                        vals: [twoStep, oneStep, instant].map(
                          (p) => `${p.phases[0]?.maxTotalDrawdownPct}%`
                        ),
                      },
                      {
                        label: `Profit split`,
                        vals: [
                          `${SITE.payoutSplitPct}%`,
                          `${SITE.payoutSplitPct}%`,
                          `${SITE.payoutSplitPct}%`,
                        ],
                      },
                      {
                        label: "Best for",
                        vals: [
                          "Most traders — cheapest way in",
                          "Confident traders who want one test",
                          "Pros who skip evaluations",
                        ],
                      },
                    ].map((row) => (
                      <tr key={row.label}>
                        <td className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
                          {row.label}
                        </td>
                        {row.vals.map((v, i) => (
                          <td
                            key={i}
                            className={`tabular px-5 py-4 font-medium ${
                              i === 2 ? "text-blue-300" : "text-slate-200"
                            }`}
                          >
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mx-auto mt-5 max-w-3xl text-center text-xs leading-relaxed text-slate-500">
                Figures shown for the ${sampleSize.toLocaleString()} account of
                each model, taken from the live packages on this page. Exact
                rules for every size are on the pricing cards above.
              </p>
            </div>
          </section>
        )}

        {/* ============ REWARD CERTIFICATE (EZE REWARD style) ============ */}
        <section className="py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div>
                <p className="eyebrow">Profit rewards</p>
                <h2 className="headline mt-3 text-3xl sm:text-5xl">
                  Paid on schedule.
                  <br />
                  <span className="gradient-text">Proof every time.</span>
                </h2>
                <p className="mt-5 max-w-lg text-lg leading-relaxed text-slate-400">
                  No payout day roulette. Your first reward lands{" "}
                  {SITE.firstPayoutDays} days after funding, then every{" "}
                  {SITE.payoutDaysInterval} days — split{" "}
                  {SITE.payoutSplitPct}/{100 - SITE.payoutSplitPct} in your
                  favor.
                </p>
                <ul className="mt-8 space-y-4">
                  {[
                    {
                      n: "1",
                      t: "No hidden payout calendar games",
                      d: `Fixed ${SITE.payoutDaysInterval}-day cycles after your first payout.`,
                    },
                    {
                      n: "2",
                      t: `Minimum just $${SITE.minPayout}`,
                      d: "Request from your dashboard whenever a cycle opens.",
                    },
                    {
                      n: "3",
                      t: "Paid to your crypto wallet",
                      d: "USDT via TRC-20 or ERC-20 — set it once in settings.",
                    },
                  ].map((r) => (
                    <li key={r.n} className="flex gap-4">
                      <span
                        className="tabular flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-black text-blue-400"
                        style={{ background: "rgba(59,130,246,0.12)" }}
                      >
                        {r.n}
                      </span>
                      <div>
                        <p className="font-semibold text-white">{r.t}</p>
                        <p className="text-sm text-slate-400">{r.d}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                <Link
                  href="#challenges"
                  className="btn-primary mt-9 px-7 py-3 text-base"
                >
                  Start Challenge
                </Link>
              </div>

              {/* Certificate mockup */}
              <div className="animate-float mx-auto w-full max-w-md">
                <div
                  className="rounded-3xl border border-blue-500/20 p-8"
                  style={{
                    background:
                      "linear-gradient(160deg, #0d1520 0%, #070b12 60%, #0a1626 100%)",
                    boxShadow:
                      "0 40px 80px -30px rgba(59,130,246,0.35), inset 0 1px 0 rgba(255,255,255,0.05)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-black tracking-wide text-white">
                      <span
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-black text-white"
                        style={{ background: "linear-gradient(135deg,#60a5fa,#3b82f6)" }}
                        aria-hidden
                      >
                        A
                      </span>
                      APEXREWARD
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        certBadge === "Certified"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          : certBadge === "Demo"
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                            : "border-white/15 bg-white/[0.06] text-slate-300"
                      }`}
                    >
                      {certBadge}
                    </span>
                  </div>
                  <p className="mt-8 text-xs uppercase tracking-[0.2em] text-slate-500">
                    Proudly presented to
                  </p>
                  <p className="mt-2 text-2xl font-bold text-white">{certName}</p>
                  <p className="mt-8 text-xs uppercase tracking-[0.2em] text-slate-500">
                    Reward of
                  </p>
                  <p className="tabular mt-1 text-4xl font-black text-emerald-400">
                    {certAmount}
                  </p>
                  <div className="mt-10 flex items-end justify-between border-t border-white/[0.08] pt-5">
                    <div>
                      <p className="text-xs text-slate-500">Date</p>
                      <p className="text-sm font-semibold text-slate-300">
                        {certDate}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">Signed</p>
                      <p className="text-sm font-semibold text-slate-300">
                        {SITE.name} Payouts
                      </p>
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-600">
                  {certCaption}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ============ RULES ============ */}
        <section
          id="rules"
          className="border-y border-white/[0.06] bg-[#04060a] py-20 sm:py-24"
        >
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <p className="eyebrow">Trading rules</p>
              <h2 className="headline mt-3 text-3xl sm:text-4xl">
                Simple, transparent rules
              </h2>
              <p className="mt-4 text-slate-400">
                Everything is enforced automatically — you always know exactly
                where you stand.
              </p>
            </div>
            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {[
                {
                  t: "Risk limits",
                  items: [
                    "Daily loss limit: 3–5% depending on challenge",
                    "Maximum drawdown: 6–10%, trailing from your peak balance",
                    "Limits checked in real time on closed trades",
                    "One breach = account closed, no exceptions",
                  ],
                },
                {
                  t: "Consistency",
                  items: [
                    "No single day may represent more than 40% of total profit when hitting target",
                    "Minimum trading days must be met per phase",
                    "Trades settle automatically at expiry (30s–5min)",
                  ],
                },
                {
                  t: "Payouts",
                  items: [
                    `First payout ${SITE.firstPayoutDays} days after funding`,
                    `Then every ${SITE.payoutDaysInterval} days`,
                    `Minimum $${SITE.minPayout}`,
                    kycRequired
                      ? "KYC required before first withdrawal"
                      : "KYC not required to withdraw — verify anytime in settings",
                  ],
                },
              ].map((col) => (
                <div key={col.t} className="card">
                  <h3 className="text-lg font-bold text-white">{col.t}</h3>
                  <ul className="mt-4 space-y-3 text-sm text-slate-400">
                    {col.items.map((item) => (
                      <li key={item} className="flex gap-2.5">
                        <CheckDot className="mt-0.5" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============ FAQ with tabs ============ */}
        <section id="faq" className="py-20 sm:py-24">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <div className="text-center">
              <p className="eyebrow">FAQ</p>
              <h2 className="headline mt-3 text-3xl sm:text-4xl">
                Frequently asked questions
              </h2>
            </div>
            <div className="mt-10">
              <FaqTabs items={faqs} />
            </div>
            <p className="mt-10 text-center text-sm text-slate-400">
              Still have questions?{" "}
              <a
                href={`mailto:${SITE.supportEmail}`}
                className="font-semibold text-blue-400 hover:text-blue-300"
              >
                {SITE.supportEmail}
              </a>{" "}
              or Telegram {SITE.telegram} — we reply 24/7.
            </p>
          </div>
        </section>

        {/* ============ SUPPORT ============ */}
        <section className="border-t border-white/[0.06] bg-[#04060a] py-16">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <p className="eyebrow">Customer support</p>
              <h2 className="headline mt-3 text-2xl sm:text-3xl">
                Real humans. Around the clock.
              </h2>
              <p className="mt-4 max-w-xl text-slate-400">
                Dedicated in-house support for funded traders — email or
                Telegram, 24/7. Payout, KYC and account questions answered by
                people who know the platform.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a href={`mailto:${SITE.supportEmail}`} className="btn-primary">
                  Email support
                </a>
                <a
                  href={`https://t.me/${SITE.telegram.replace("@", "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary"
                >
                  Telegram: {SITE.telegram}
                </a>
              </div>
            </div>
            <div className="card flex flex-col justify-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Availability
              </p>
              <p className="mt-3 text-4xl font-extrabold text-white">24/7</p>
              <p className="mt-1 text-sm text-slate-400">
                Live coverage for funded traders, every day of the week.
              </p>
            </div>
          </div>
        </section>

        {/* ============ CTA ============ */}
        <section className="relative overflow-hidden border-t border-white/[0.06]">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 60% 80% at 50% 100%, rgba(59,130,246,0.18), transparent 70%)",
            }}
            aria-hidden
          />
          <div className="relative mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
            <h2 className="headline text-3xl sm:text-5xl">
              Ready to trade with{" "}
              <span className="gradient-text">our money?</span>
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-slate-400">
              Join traders who proved their edge and got funded. Your capital is
              only the challenge fee — your skill does the rest.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link href="/register" className="btn-primary px-8 py-3.5 text-base">
                Create Free Account
              </Link>
              <Link href="#challenges" className="btn-secondary px-8 py-3.5 text-base">
                View Challenges
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function CheckDot({ className }: { className?: string }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-blue-400 ${className ?? ""}`}
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
