"use client";

import { useActionState, useState, useTransition } from "react";
import {
  enableTotpStartAction,
  enableTotpConfirmAction,
  disableTotpAction,
  revokeOwnSessionAction,
  revokeOtherSessionsAction,
} from "@/lib/actions/security";
import { reverifyAction, type AuthFormState } from "@/lib/actions/auth";
import type { ActionResult } from "@/lib/actions/trader";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

export function ReverifyForm({ twoFactorEnabled }: { twoFactorEnabled: boolean }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    reverifyAction,
    null
  );
  return (
    <form action={formAction} className="mt-4 max-w-md space-y-4">
      <p className="text-xs text-slate-500">
        Sensitive admin actions (payments, payouts, roles, settings) require a
        fresh login or this re-verification (valid 5 minutes).
      </p>
      <Field label="Your password">
        <input name="password" type="password" required className="input" />
      </Field>
      {twoFactorEnabled && (
        <Field label="Authenticator code">
          <input name="totp" inputMode="numeric" maxLength={6} className="input" placeholder="6-digit code" />
        </Field>
      )}
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
        {pending ? "Verifying..." : "Verify identity"}
      </button>
    </form>
  );
}

export function TotpSetup({
  enabled,
  pendingSetup,
}: {
  enabled: boolean;
  pendingSetup: { secret: string; uri: string } | null;
}) {
  const [secret, setSecret] = useState<{ secret: string; uri: string } | null>(
    pendingSetup
  );
  const [busy, startTransition] = useTransition();
  const [err, setErr] = useState("");
  const [confirmState, confirmFormAction, confirmPending] =
    useActionState<ActionResult, FormData>(enableTotpConfirmAction, null);
  const [disableState, disableFormAction, disablePending] =
    useActionState<ActionResult, FormData>(disableTotpAction, null);

  return (
    <div className="mt-4 space-y-4">
      {enabled ? (
        <>
          <p className="text-sm text-emerald-400">
            Two-factor authentication is enabled for your admin account.
          </p>
          <form action={disableFormAction} className="max-w-md space-y-3">
            <Field label="Password to disable 2FA">
              <input name="password" type="password" required className="input" />
            </Field>
            <Field label="Current authenticator code">
              <input name="code" inputMode="numeric" maxLength={6} required className="input" />
            </Field>
            {disableState && "error" in disableState && disableState.error && (
              <p className="text-sm text-rose-400">{disableState.error}</p>
            )}
            {disableState && "success" in disableState && disableState.success && (
              <p className="text-sm text-emerald-400">{disableState.success}</p>
            )}
            <button type="submit" disabled={disablePending} className="btn-danger">
              Disable 2FA
            </button>
          </form>
        </>
      ) : secret ? (
        <>
          <p className="text-sm text-slate-300">
            Add this secret to your authenticator app (Google Authenticator,
            Authy, 1Password…), then confirm with a code.
          </p>
          <p className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm break-all text-emerald-300">
            {secret.secret}
          </p>
          <p className="text-xs text-slate-500 break-all">{secret.uri}</p>
          <form action={confirmFormAction} className="max-w-md space-y-3">
            <Field label="Confirm code">
              <input
                name="code"
                inputMode="numeric"
                maxLength={6}
                required
                className="input"
                placeholder="6-digit code"
              />
            </Field>
            {confirmState && "error" in confirmState && confirmState.error && (
              <p className="text-sm text-rose-400">{confirmState.error}</p>
            )}
            {confirmState && "success" in confirmState && confirmState.success && (
              <p className="text-sm text-emerald-400">{confirmState.success}</p>
            )}
            <button type="submit" disabled={confirmPending} className="btn-primary">
              {confirmPending ? "Confirming..." : "Enable 2FA"}
            </button>
          </form>
        </>
      ) : (
        <div>
          {err && <p className="mb-2 text-sm text-rose-400">{err}</p>}
          <button
            onClick={() =>
              startTransition(async () => {
                setErr("");
                const res = await enableTotpStartAction();
                if (res && "error" in res && res.error) setErr(res.error);
                else if (res && "data" in res && res.data) setSecret(res.data);
              })
            }
            disabled={busy}
            className="btn-primary"
          >
            {busy ? "Generating..." : "Enable two-factor authentication"}
          </button>
        </div>
      )}
    </div>
  );
}

export function SessionRow({
  jti,
  isCurrent,
  createdAt,
  expiresAt,
  userAgent,
}: {
  jti: string;
  isCurrent: boolean;
  createdAt: string;
  expiresAt: string;
  userAgent: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    revokeOwnSessionAction,
    null
  );
  return (
    <tr className="border-b border-slate-800/60">
      <td className="px-3 py-2 text-xs text-slate-400">{new Date(createdAt).toLocaleString()}</td>
      <td className="px-3 py-2 text-xs text-slate-500">{userAgent || "—"}</td>
      <td className="px-3 py-2 text-xs text-slate-500">{new Date(expiresAt).toLocaleString()}</td>
      <td className="px-3 py-2">
        {isCurrent ? (
          <span className="text-xs text-emerald-400">current</span>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="jti" value={jti} />
            <button type="submit" disabled={pending} className="text-xs text-rose-400 hover:underline">
              {pending ? "Revoking..." : "Revoke"}
            </button>
            {state && "error" in state && state.error && (
              <span className="ml-2 text-xs text-rose-400">{state.error}</span>
            )}
          </form>
        )}
      </td>
    </tr>
  );
}

export function RevokeOthersButton() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <span>
      <button
        onClick={() =>
          startTransition(async () => {
            const res = await revokeOtherSessionsAction();
            setMsg(
              res && "success" in res && res.success
                ? res.success
                : res && "error" in res && res.error
                  ? res.error
                  : ""
            );
          })
        }
        disabled={pending}
        className="btn-secondary"
      >
        {pending ? "Signing out..." : "Sign out all other sessions"}
      </button>
      {msg && <span className="ml-2 text-xs text-slate-400">{msg}</span>}
    </span>
  );
}
