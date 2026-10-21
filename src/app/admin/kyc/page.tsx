import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { EmptyState, TableWrap, Th, Td, Badge } from "@/components/ui";
import { dateTime } from "@/lib/utils";
import { reviewKycAction } from "@/lib/actions/admin";
import { ActionButton } from "@/components/action-button";

export default async function AdminKycPage() {
  await requireAdmin();
  const kycs = await db.kyc.findMany({
    include: { user: { select: { email: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">KYC review</h1>
        <p className="mt-1 text-sm text-slate-400">
          Approve identity before first payout.
        </p>
      </div>

      {kycs.length === 0 ? (
        <EmptyState title="No KYC submissions" body="Submissions appear here." />
      ) : (
        <TableWrap>
          <thead>
            <tr className="border-b border-slate-800">
              <Th>Submitted</Th>
              <Th>User</Th>
              <Th>Details</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {kycs.map((k) => (
              <tr key={k.id} className="border-b border-slate-800/60">
                <Td className="whitespace-nowrap text-xs text-slate-400">
                  {dateTime(k.createdAt)}
                </Td>
                <Td>
                  <p className="text-sm">{k.user.name}</p>
                  <p className="text-xs text-slate-500">{k.user.email}</p>
                </Td>
                <Td>
                  <p className="text-sm">{k.fullName}</p>
                  <p className="text-xs text-slate-500">
                    {k.country} • {k.documentType.replace("_", " ")} •{" "}
                    {k.documentNumber}
                  </p>
                </Td>
                <Td>
                  <Badge
                    color={
                      k.status === "APPROVED"
                        ? "emerald"
                        : k.status === "REJECTED"
                          ? "rose"
                          : "amber"
                    }
                  >
                    {k.status}
                  </Badge>
                </Td>
                <Td>
                  {k.status === "PENDING" && (
                    <div className="flex gap-2">
                      <ActionButton
                        action={reviewKycAction.bind(null, k.id, "APPROVED")}
                        label="Approve"
                        pendingLabel="..."
                      />
                      <ActionButton
                        action={reviewKycAction.bind(null, k.id, "REJECTED")}
                        label="Reject"
                        variant="danger"
                        pendingLabel="..."
                      />
                    </div>
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
