import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { statusBadge, EmptyState, TableWrap, Th, Td } from "@/components/ui";
import { money, dateTime } from "@/lib/utils";
import { SITE } from "@/lib/config";

export default async function PayoutsPage() {
  const user = await requireUser();
  const payouts = await db.payout.findMany({
    where: { userId: user.id },
    include: { challenge: { include: { package: true } } },
    orderBy: { createdAt: "desc" },
  });

  const paid = payouts
    .filter((p) => p.status === "PAID")
    .reduce((a, p) => a + p.amount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Payouts</h1>
        <p className="mt-1 text-sm text-slate-400">
          Lifetime paid: <span className="font-semibold text-emerald-400">{money(paid)}</span>{" "}
          • Rules: first payout {SITE.firstPayoutDays} days after funding, then
          every {SITE.payoutDaysInterval} days, minimum ${SITE.minPayout}.
        </p>
      </div>

      {payouts.length === 0 ? (
        <EmptyState
          title="No payout requests"
          body="Request payouts from funded accounts on the challenge detail page."
          action={
            <Link href="/dashboard" className="btn-secondary">
              Go to Dashboard
            </Link>
          }
        />
      ) : (
        <TableWrap>
          <thead>
            <tr className="border-b border-slate-800">
              <Th>Date</Th>
              <Th>Account</Th>
              <Th>Amount</Th>
              <Th>Network</Th>
              <Th>Wallet</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={p.id} className="border-b border-slate-800/60">
                <Td className="whitespace-nowrap text-xs text-slate-400">
                  {dateTime(p.createdAt)}
                </Td>
                <Td>{p.challenge.package.name}</Td>
                <Td className="font-mono font-semibold">{money(p.amount)}</Td>
                <Td>{p.network}</Td>
                <Td className="max-w-[160px] truncate font-mono text-xs text-slate-400">
                  {p.walletAddress}
                </Td>
                <Td>{statusBadge(p.status)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}
