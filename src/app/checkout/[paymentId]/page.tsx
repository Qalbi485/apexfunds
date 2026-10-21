import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { SiteHeader } from "@/components/site-chrome";
import { TxForm } from "@/components/tx-form";
import { money } from "@/lib/utils";
import { statusBadge } from "@/components/ui";

export default async function CheckoutPage({
  params,
}: PageProps<"/checkout/[paymentId]">) {
  const { paymentId } = await params;
  const user = await requireUser();

  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { challenge: { include: { package: true } } },
  });
  if (!payment || payment.userId !== user.id) notFound();

  const settings = await db.setting.findMany();
  const smap = Object.fromEntries(settings.map((s) => [s.key, s.value]));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl flex-1 px-4 py-12 sm:px-6">
        <Link
          href="/dashboard"
          className="text-sm text-slate-400 hover:text-white"
        >
          ← Back to dashboard
        </Link>

        <div className="mt-6 card">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">Checkout</h1>
              <p className="mt-1 text-sm text-slate-400">
                {payment.challenge?.package.name} —{" "}
                {payment.challenge?.accountSize
                  ? `$${payment.challenge.accountSize.toLocaleString()}`
                  : ""}
              </p>
            </div>
            {statusBadge(payment.status)}
          </div>

          <div className="mt-6 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center">
            <p className="text-sm text-slate-400">Amount due</p>
            <p className="mt-1 text-4xl font-bold text-emerald-400">
              {money(payment.amount)}
            </p>
            <p className="mt-1 text-xs text-slate-500">USD (USDT)</p>
          </div>

          {payment.status === "CONFIRMED" ? (
            <div className="mt-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
              Payment confirmed! Your challenge is active.{" "}
              <Link
                href={`/dashboard/challenges/${payment.challengeId}`}
                className="underline"
              >
                Open dashboard →
              </Link>
            </div>
          ) : payment.txHash ? (
            <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
              Transaction submitted. Waiting for confirmation — usually under
              10 minutes.
            </div>
          ) : (
            <>
              <div className="mt-8 space-y-4">
                <div>
                  <p className="text-sm font-semibold text-slate-200">
                    1. Send exactly {money(payment.amount)} in USDT to:
                  </p>
                  <div className="mt-2 space-y-2">
                    <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
                      <p className="text-xs text-slate-500">TRC20 (Tron)</p>
                      <p className="mt-1 break-all font-mono text-sm text-slate-200">
                        {smap.usdtTrc20 || "Address not configured"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
                      <p className="text-xs text-slate-500">ERC20 (Ethereum)</p>
                      <p className="mt-1 break-all font-mono text-sm text-slate-200">
                        {smap.usdtErc20 || "Address not configured"}
                      </p>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-200">
                    2. Paste your transaction hash below
                  </p>
                  <TxForm paymentId={payment.id} />
                </div>
              </div>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-slate-500">
          Payments are confirmed manually within a few hours. Need help?{" "}
          <Link href="/dashboard/support" className="text-blue-400">
            Contact support
          </Link>
        </p>
      </main>
    </>
  );
}
