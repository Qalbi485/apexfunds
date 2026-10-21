"use client";

import { useActionState } from "react";
import { adminReplyTicketAction, type ActionResult } from "@/lib/actions/admin";

export function AdminReplyForm({ ticketId }: { ticketId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    async (_prev, formData) => adminReplyTicketAction(ticketId, formData),
    null
  );

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <textarea
        name="body"
        required
        rows={4}
        className="input"
        placeholder="Reply to trader..."
      />
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" name="close" className="rounded" />
        Close ticket after replying
      </label>
      {state?.error && <p className="text-sm text-rose-400">{state.error}</p>}
      {state?.success && (
        <p className="text-sm text-emerald-400">{state.success}</p>
      )}
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Sending..." : "Send Reply"}
      </button>
    </form>
  );
}
