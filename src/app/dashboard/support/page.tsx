import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { statusBadge, EmptyState } from "@/components/ui";
import { dateTime } from "@/lib/utils";
import { TicketForm } from "@/components/ticket-form";
import { SITE } from "@/lib/config";

export default async function SupportPage() {
  const user = await requireUser();
  const tickets = await db.supportTicket.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Support</h1>
        <p className="mt-1 text-sm text-slate-400">
          {SITE.supportEmail} • Telegram {SITE.telegram} • or create a ticket
          below.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="text-lg font-semibold text-white">New ticket</h2>
          <div className="mt-4">
            <TicketForm />
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-white">Your tickets</h2>
          {tickets.length === 0 ? (
            <EmptyState title="No tickets" body="Create a ticket if you need help." />
          ) : (
            tickets.map((t) => (
              <Link
                key={t.id}
                href={`/dashboard/support/${t.id}`}
                className="card flex items-center justify-between hover:border-blue-500/40"
              >
                <div>
                  <p className="font-medium text-white">{t.subject}</p>
                  <p className="text-xs text-slate-500">
                    {dateTime(t.updatedAt)}
                  </p>
                </div>
                {statusBadge(t.status)}
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
