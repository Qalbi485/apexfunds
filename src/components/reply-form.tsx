"use client";

import { useActionState } from "react";
import { replyTicketAction, type ActionResult } from "@/lib/actions/trader";

export function ReplyForm({ ticketId }: { ticketId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    async (_prev, formData) => replyTicketAction(ticketId, formData),
    null
  );

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <textarea
        name="body"
        required
        rows={3}
        className="input"
        placeholder="Type your reply..."
      />
      {state?.error && (
        <p className="text-sm text-rose-400">{state.error}</p>
      )}
      {state?.success && (
        <p className="text-sm text-emerald-400">{state.success}</p>
      )}
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Sending..." : "Reply"}
      </button>
    </form>
  );
}
