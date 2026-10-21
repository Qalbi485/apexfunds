import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { SITE } from "@/lib/config";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl flex-1 px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-bold text-white">Privacy Policy</h1>
        <p className="mt-2 text-sm text-slate-500">
          Last updated: {new Date().toLocaleDateString()}
        </p>
        <div className="mt-8 space-y-6 text-sm leading-relaxed text-slate-300">
          <section>
            <h2 className="text-lg font-semibold text-white">1. Data we collect</h2>
            <p>
              We collect: account data (name, email, password hash), KYC data
              (full name, country, document type and number), payment data
              (transaction hashes, wallet addresses), and trading activity on
              our evaluation accounts.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">2. How we use data</h2>
            <p>
              To operate challenges, verify identity, process payouts, prevent
              fraud, comply with anti-money-laundering obligations, and
              provide support. We do not sell your personal data.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">3. Sharing</h2>
            <p>
              We share data only with service providers necessary to run the
              service (hosting, payment networks) and with authorities when
              legally required.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">4. Retention</h2>
            <p>
              We retain account and transaction records for as long as needed
              for legal and accounting purposes, typically up to 5 years after
              account closure.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">5. Security</h2>
            <p>
              Passwords are hashed. Sessions are signed tokens. Access to
              administrative systems is restricted. No system is 100% secure;
              report vulnerabilities to {SITE.supportEmail}.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">6. Your rights</h2>
            <p>
              You may request access, correction, or deletion of your personal
              data by contacting {SITE.supportEmail}, subject to legal
              retention requirements.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">7. Cookies</h2>
            <p>
              We use strictly necessary cookies for authentication sessions.
              We do not use third-party advertising cookies.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
