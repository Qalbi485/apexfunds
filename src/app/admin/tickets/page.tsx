import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { statusBadge, EmptyState, TableWrap, Th, Td } from "@/components/ui";
import { dateTime } from "@/lib/utils";

export default async function AdminTicketsPage() {
  await requireAdmin();
  const tickets = await db.supportTicket.findMany({
    include: {
      user: { select: { email: true, name: true } },
      _count: { select: { messages: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Support tickets</h1>
        <p className="mt-1 text-sm text-slate-400">
          {tickets.length} ticket(s).
        </p>
      </div>

      {tickets.length === 0 ? (
        <EmptyState title="No tickets" body="Trader tickets appear here." />
      ) : (
        <TableWrap>
          <thead>
            <tr className="border-b border-slate-800">
              <Th>Updated</Th>
              <Th>Subject</Th>
              <Th>Trader</Th>
              <Th>Messages</Th>
              <Th>Status</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id} className="border-b border-slate-800/60">
                <Td className="whitespace-nowrap text-xs text-slate-400">
                  {dateTime(t.updatedAt)}
                </Td>
                <Td className="font-medium">{t.subject}</Td>
                <Td>
                  <p className="text-sm">{t.user.name}</p>
                  <p className="text-xs text-slate-500">{t.user.email}</p>
                </Td>
                <Td>{t._count.messages}</Td>
                <Td>{statusBadge(t.status)}</Td>
                <Td>
                  <Link
                    href={`/admin/tickets/${t.id}`}
                    className="text-sm text-blue-400 hover:underline"
                  >
                    Open →
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}
