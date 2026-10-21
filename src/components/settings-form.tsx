"use client";

import { useActionState } from "react";
import { saveSettingsAction, type ActionResult } from "@/lib/actions/admin";

export function SettingsForm({
  settings,
}: {
  settings: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    saveSettingsAction,
    null
  );

  const fields: Array<{ key: string; label: string; placeholder?: string }> = [
    { key: "usdtTrc20", label: "USDT TRC20 receive address" },
    { key: "usdtErc20", label: "USDT ERC20 receive address" },
  ];

  return (
    <form action={formAction} className="mt-4 space-y-4">
      {fields.map((f) => (
        <div key={f.key}>
          <label className="label">{f.label}</label>
          <input
            name={`set_${f.key}`}
            defaultValue={settings[f.key] || ""}
            className="input font-mono text-xs"
            placeholder={f.placeholder}
          />
        </div>
      ))}
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
        {pending ? "Saving..." : "Save Settings"}
      </button>
    </form>
  );
}
