import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { statusBadge } from "@/components/ui";
import { dateTime } from "@/lib/utils";
import { AdminReplyForm } from "@/components/admin-reply-form";

export default async function AdminTicketDetail({
  params,
}: PageProps<"/admin/tickets/[id]">) {
  await requireAdmin();
  const { id } = await params;

  const ticket = await db.supportTicket.findUnique({
    where: { id },
    include: {
      user: { select: { email: true, name: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!ticket) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/tickets"
          className="text-sm text-slate-400 hover:text-white"
        >
          ← Tickets
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-bold text-white">{ticket.subject}</h1>
          {statusBadge(ticket.status)}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {ticket.user.name} ({ticket.user.email})
        </p>
      </div>

      <div className="space-y-3">
        {ticket.messages.map((m) => (
          <div
            key={m.id}
            className={`card ${
              m.authorRole === "ADMIN" ? "border-cyan-500/30 bg-cyan-500/5" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <p
                className={`text-sm font-semibold ${
                  m.authorRole === "ADMIN" ? "text-cyan-400" : "text-slate-200"
                }`}
              >
                {m.authorRole === "ADMIN" ? "Support" : "Trader"}
              </p>
              <p className="text-xs text-slate-500">{dateTime(m.createdAt)}</p>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">
              {m.body}
            </p>
          </div>
        ))}
      </div>

      {ticket.status !== "CLOSED" && <AdminReplyForm ticketId={ticket.id} />}
    </div>
  );
}
