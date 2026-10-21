import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";

export const metadata: Metadata = { title: "Refund Policy" };

export default function RefundPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl flex-1 px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-bold text-white">Refund Policy</h1>
        <p className="mt-2 text-sm text-slate-500">
          Last updated: {new Date().toLocaleDateString()}
        </p>
        <div className="mt-8 space-y-6 text-sm leading-relaxed text-slate-300">
          <section>
            <h2 className="text-lg font-semibold text-white">General rule</h2>
            <p>
              Challenge fees are for participation in an evaluation service
              and are <strong className="text-white">non-refundable</strong>{" "}
              once the challenge has been activated (i.e., once payment is
              confirmed and credentials are issued).
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white">
              When refunds are available
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                Duplicate payment for the same challenge (verified on-chain
                double-spend of an identical order).
              </li>
              <li>
                Payment confirmed but challenge never activated due to a
                technical fault on our side, and support could not resolve it
                within 72 hours.
              </li>
              <li>
                Where required by applicable consumer law (nothing in this
                policy limits mandatory statutory rights).
            </li>
            </ul>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
