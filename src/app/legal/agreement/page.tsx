import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { SITE } from "@/lib/config";

export const metadata: Metadata = { title: "Trader Agreement" };

function R({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-slate-300">{children}</p>;
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-8 text-lg font-semibold text-white">{children}</h2>;
}

export default function AgreementPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl flex-1 px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-bold text-white">Trader Agreement</h1>
        <p className="mt-2 text-sm text-slate-500">
          Last updated: {new Date().toLocaleDateString()} — this document
          governs all evaluation and funded accounts.
        </p>

        <H>1. Nature of the program</H>
        <R>
          {SITE.name} evaluation accounts are simulated trading environments.
          Passing an evaluation may result in a &quot;funded&quot; simulated
          account on which the trader may earn a profit split. This is not
          employment, partnership, or discretionary asset management.
        </R>

        <H>2. Account rules</H>
        <R>
          Each package defines its own profit target, minimum trading days,
          daily loss limit, and maximum drawdown. Limits are calculated on
          closed-trade balance and enforced automatically. Hitting a loss
          limit closes the account.
        </R>

        <H>3. Profit split and payouts</H>
        <R>
          Funded accounts receive a {SITE.payoutSplitPct}% profit split.
          First payout is available {SITE.firstPayoutDays} days after the
          account is funded; subsequent payouts every{" "}
          {SITE.payoutDaysInterval} days; minimum ${SITE.minPayout}.
          Consistency rules apply to profit distribution. Payouts are paid in
          USDT to a wallet specified by the trader, after KYC verification.
        </R>

        <H>4. Prohibited strategies</H>
        <R>
          Latency/quote-delay arbitrage, exploiting platform or pricing
          errors, coordinated copy trading between funded accounts, account
          sharing or credential transfer to third parties, and automated
          trading without written permission are violations. Violation
          voids the account and forfeits unpaid profits.
        </R>

        <H>5. Risk disclosure</H>
        <R>
          Binary options and leveraged trading carry a high risk of loss.
          Past performance does not guarantee future results. You may lose
          the challenge fee. On funded accounts your maximum loss is limited
          to the account drawdown rules, but profit is never guaranteed.
        </R>

        <H>6. No advice</H>
        <R>
          We do not provide signals, recommendations, or investment advice.
          All trading decisions are yours alone.
        </R>

        <H>7. Termination</H>
        <R>
          We may terminate accounts for rule violations, fraud, or legal
          necessity. Upon termination, unpaid profits on breached accounts
          are forfeited. Valid profits on accounts closed in good standing
          remain payable per this agreement.
        </R>

        <H>8. Governing terms</H>
        <R>
          This agreement works together with our Terms of Service and Privacy
          Policy. Contact: {SITE.supportEmail} • Telegram {SITE.telegram}.
        </R>
      </main>
      <SiteFooter />
    </>
  );
}
