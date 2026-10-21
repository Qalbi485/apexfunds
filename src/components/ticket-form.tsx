"use client";

import { useActionState } from "react";
import { createTicketAction, type ActionResult } from "@/lib/actions/trader";

export function TicketForm() {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    createTicketAction,
    null
  );

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="label" htmlFor="subject">
          Subject
        </label>
        <input id="subject" name="subject" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="body">
          Message
        </label>
        <textarea id="body" name="body" required rows={4} className="input" />
      </div>
      {state?.error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
          {state.success}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Sending..." : "Create Ticket"}
      </button>
    </form>
  );
}
