import { requireAdmin } from "@/lib/auth";
import { SITE } from "@/lib/config";
import { db } from "@/lib/db";
import { statusBadge, EmptyState, TableWrap, Th, Td } from "@/components/ui";
import { money, dateTime } from "@/lib/utils";
import { processPayoutAction } from "@/lib/actions/admin";
import { ActionButton } from "@/components/action-button";

export default async function AdminPayoutsPage() {
  await requireAdmin();
  const payouts = await db.payout.findMany({
    include: {
      user: { select: { email: true, name: true } },
      challenge: { include: { package: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Payouts</h1>
        <p className="mt-1 text-sm text-slate-400">
          Approve → send USDT → mark paid (deducts from account balance). SLA:{" "}
          {SITE.payoutProcessingHours} hours from approval.
        </p>
      </div>

      {payouts.length === 0 ? (
        <EmptyState title="No payout requests" body="Trader payout requests appear here." />
      ) : (
        <TableWrap>
          <thead>
            <tr className="border-b border-slate-800">
              <Th>Date</Th>
              <Th>Trader</Th>
              <Th>Account</Th>
              <Th>Amount</Th>
              <Th>Wallet</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={p.id} className="border-b border-slate-800/60">
                <Td className="whitespace-nowrap text-xs text-slate-400">
                  {dateTime(p.createdAt)}
                </Td>
                <Td>
                  <p className="text-sm">{p.user.name}</p>
                  <p className="text-xs text-slate-500">{p.user.email}</p>
                </Td>
                <Td className="text-xs">{p.challenge.package.name}</Td>
                <Td className="font-mono font-semibold">{money(p.amount)}</Td>
                <Td className="max-w-[160px] truncate font-mono text-xs text-slate-400">
                  {p.walletAddress}
                  <p className="text-slate-600">{p.network}</p>
                </Td>
                <Td>{statusBadge(p.status)}</Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    {p.status === "REQUESTED" && (
                      <ActionButton
                        action={processPayoutAction.bind(null, p.id, "APPROVED")}
                        label="Approve"
                        variant="secondary"
                        pendingLabel="..."
                      />
                    )}
                    {p.status === "APPROVED" && (
                      <ActionButton
                        action={processPayoutAction.bind(null, p.id, "PAID")}
                        label="Mark paid"
                        confirm={`Mark $${p.amount} as PAID? Balance will be deducted.`}
                        pendingLabel="..."
                      />
                    )}
                    {["REQUESTED", "APPROVED"].includes(p.status) && (
                      <ActionButton
                        action={processPayoutAction.bind(null, p.id, "REJECTED")}
                        label="Reject"
                        variant="danger"
                        confirm="Reject this payout?"
                        pendingLabel="..."
                      />
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}
