"use client";

import { useActionState } from "react";
import { changePasswordAction, type AuthFormState } from "@/lib/actions/auth";

export function PasswordForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    changePasswordAction,
    null
  );

  return (
    <form action={formAction} className="mt-4 max-w-md space-y-4">
      <div>
        <label className="label" htmlFor="current">
          Current password
        </label>
        <input
          id="current"
          name="current"
          type="password"
          required
          className="input"
        />
      </div>
      <div>
        <label className="label" htmlFor="next">
          New password
        </label>
        <input
          id="next"
          name="next"
          type="password"
          required
          minLength={8}
          className="input"
          placeholder="Min 8 characters"
        />
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
        {pending ? "Updating..." : "Update Password"}
      </button>
    </form>
  );
}
