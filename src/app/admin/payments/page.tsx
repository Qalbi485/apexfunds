import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { statusBadge, EmptyState, TableWrap, Th, Td, Badge } from "@/components/ui";
import { money, dateTime } from "@/lib/utils";
import { confirmPaymentAction } from "@/lib/actions/admin";
import { ActionButton } from "@/components/action-button";

export default async function AdminPaymentsPage() {
  await requireAdmin();
  const payments = await db.payment.findMany({
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
        <h1 className="text-2xl font-bold text-white">Payments</h1>
        <p className="mt-1 text-sm text-slate-400">
          Confirm transactions after verifying on-chain. Confirmation
          activates the challenge.
        </p>
      </div>

      {payments.length === 0 ? (
        <EmptyState title="No payments yet" body="Payments appear here when traders buy challenges." />
      ) : (
        <TableWrap>
          <thead>
            <tr className="border-b border-slate-800">
              <Th>Date</Th>
              <Th>Trader</Th>
              <Th>Package</Th>
              <Th>Amount</Th>
              <Th>Network</Th>
              <Th>TXID</Th>
              <Th>Status</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-b border-slate-800/60">
                <Td className="whitespace-nowrap text-xs text-slate-400">
                  {dateTime(p.createdAt)}
                </Td>
                <Td>
                  <p className="text-sm">{p.user.name}</p>
                  <p className="text-xs text-slate-500">{p.user.email}</p>
                </Td>
                <Td>
                  {p.challenge?.package.name || "—"}
                  {p.challenge?.status === "PENDING_PAYMENT" && (
                    <Badge color="amber">awaiting</Badge>
                  )}
                </Td>
                <Td className="font-mono font-semibold">{money(p.amount)}</Td>
                <Td className="text-xs">{p.method}</Td>
                <Td className="max-w-[180px] truncate font-mono text-xs text-slate-400">
                  {p.txHash || "—"}
                </Td>
                <Td>{statusBadge(p.status)}</Td>
                <Td>
                  {p.status === "PENDING" && p.txHash && (
                    <ActionButton
                      action={confirmPaymentAction.bind(null, p.id)}
                      label="Confirm"
                      pendingLabel="Confirming..."
                      confirm={`Confirm payment of $${p.amount} for ${p.user.email}?`}
                    />
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}
