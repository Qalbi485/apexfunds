"use client";

import { useActionState } from "react";
import { submitKycAction, type ActionResult } from "@/lib/actions/trader";

export function KycForm() {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    submitKycAction,
    null
  );

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="fullName">
            Full legal name
          </label>
          <input id="fullName" name="fullName" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="country">
            Country
          </label>
          <input id="country" name="country" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="documentType">
            Document type
          </label>
          <select id="documentType" name="documentType" className="input">
            <option value="ID_CARD">CNIC (National ID)</option>
            <option value="PASSPORT">Passport</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="documentNumber">
            Document number
          </label>
          <input
            id="documentNumber"
            name="documentNumber"
            required
            className="input font-mono"
            placeholder="42101-1234567-1"
          />
          <p className="mt-1 text-xs text-slate-500">
            CNIC format: 12345-1234567-1 (13 digits, dashes included)
          </p>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Details are verified manually within 24 hours. No photo upload needed.
      </p>

      {state?.error && (
        <p className="text-sm text-rose-400" role="alert">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p className="text-sm text-emerald-400">{state.success}</p>
      )}

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Submitting…" : "Submit KYC"}
      </button>
    </form>
  );
}
