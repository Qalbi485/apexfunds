import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { statusBadge } from "@/components/ui";
import { dateTime } from "@/lib/utils";
import { ReplyForm } from "@/components/reply-form";

export default async function TicketPage({
  params,
}: PageProps<"/dashboard/support/[id]">) {
  const { id } = await params;
  const user = await requireUser();

  const ticket = await db.supportTicket.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!ticket || ticket.userId !== user.id) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/support"
          className="text-sm text-slate-400 hover:text-white"
        >
          ← Support
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-bold text-white">{ticket.subject}</h1>
          {statusBadge(ticket.status)}
        </div>
      </div>

      <div className="space-y-3">
        {ticket.messages.map((m) => (
          <div
            key={m.id}
            className={`card ${
              m.authorRole === "ADMIN"
                ? "border-cyan-500/30 bg-cyan-500/5"
                : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <p
                className={`text-sm font-semibold ${
                  m.authorRole === "ADMIN" ? "text-cyan-400" : "text-slate-200"
                }`}
              >
                {m.authorRole === "ADMIN" ? "Support" : "You"}
              </p>
              <p className="text-xs text-slate-500">{dateTime(m.createdAt)}</p>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">
              {m.body}
            </p>
          </div>
        ))}
      </div>

      {ticket.status !== "CLOSED" && <ReplyForm ticketId={ticket.id} />}
    </div>
  );
}
