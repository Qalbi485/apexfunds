import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { SITE } from "@/lib/config";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl flex-1 px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-bold text-white">Terms of Service</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: {new Date().toLocaleDateString()}</p>
        <div className="prose prose-invert mt-8 space-y-6 text-sm leading-relaxed text-slate-300">
          <section>
            <h2 className="text-lg font-semibold text-white">1. Agreement</h2>
            <p>
              By creating an account or purchasing a challenge from {SITE.name}{" "}
              (&quot;Company&quot;, &quot;we&quot;), you agree to these Terms of
              Service and the Trader Agreement. If you do not agree, do not use
              the service.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">2. The service</h2>
            <p>
              {SITE.name} provides simulated binary options trading challenges
              and evaluation programs. Challenges are educational evaluations
              of trading skill conducted on demo/simulated accounts funded by
              the Company. The Company does not provide investment advice,
              brokerage, or asset management services.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">3. Accounts</h2>
            <p>
              You must be at least 18 years old and a resident of a
              jurisdiction where our services are lawful. One person may not
              operate multiple accounts. You are responsible for keeping your
              credentials secure. Trading on funded accounts must be performed
              only by the account holder.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">4. Fees</h2>
            <p>
              Challenge fees are one-time payments for participation in an
              evaluation. Fees are non-refundable except as stated in the
              Refund Policy. Passing a challenge does not guarantee funding or
              profits.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">5. Prohibited conduct</h2>
            <p>
              Copy trading, latency arbitrage, exploiting platform errors,
              hedging across accounts, use of automated bots without
              permission, and collusion with other traders are prohibited and
              may result in account termination without payout.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">6. Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, the Company&apos;s total
              liability shall not exceed the fees you paid for the relevant
              challenge. Trading involves substantial risk of loss. The
              Company is not liable for indirect or consequential damages.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">7. Termination</h2>
            <p>
              We may suspend or terminate accounts that violate these Terms,
              the Trader Agreement, or applicable law. Balances on breached or
              terminated funded accounts are forfeited per the Trader
              Agreement.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">8. Changes</h2>
            <p>
              We may update these Terms. Continued use after changes
              constitutes acceptance. Material changes will be announced via
              email or dashboard notification.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">9. Contact</h2>
            <p>
              Questions: {SITE.supportEmail} • Telegram: {SITE.telegram}
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
