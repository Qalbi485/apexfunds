"use client";

import { useActionState } from "react";
import { setUserRoleAction, type ActionResult } from "@/lib/actions/admin";

export function RoleForm({
  userId,
  currentRole,
}: {
  userId: string;
  currentRole: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    setUserRoleAction,
    null
  );
  const next = currentRole === "ADMIN" ? "TRADER" : "ADMIN";
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="role" value={next} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-amber-400 hover:underline"
      >
        {pending ? "..." : `→ ${next}`}
      </button>
      {state && "error" in state && state.error && (
        <span className="text-xs text-rose-400">{state.error}</span>
      )}
    </form>
  );
}
