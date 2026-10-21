"use client";

import { useState, useTransition } from "react";

export function ActionButton({
  action,
  label,
  pendingLabel,
  confirm,
  variant = "primary",
}: {
  action: () => Promise<{ error?: string; success?: string } | null>;
  label: string;
  pendingLabel?: string;
  confirm?: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );

  const cls =
    variant === "danger"
      ? "btn-danger"
      : variant === "secondary"
        ? "btn-secondary"
        : "btn-primary";

  function run() {
    if (confirm && !window.confirm(confirm)) return;
    startTransition(async () => {
      setMsg(null);
      const res = await action();
      if (res?.error) setMsg({ type: "err", text: res.error });
      else if (res?.success) setMsg({ type: "ok", text: res.success });
    });
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button onClick={run} disabled={pending} className={cls}>
        {pending ? pendingLabel || "Working..." : label}
      </button>
      {msg && (
        <span
          className={`text-xs ${msg.type === "err" ? "text-rose-400" : "text-emerald-400"}`}
        >
          {msg.text}
        </span>
      )}
    </span>
  );
}
