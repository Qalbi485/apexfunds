"use client";

import { useState, useTransition } from "react";
import { syncChallengeAction } from "@/lib/actions/trader";

export function SyncButton({ challengeId }: { challengeId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await syncChallengeAction(challengeId);
      if (res?.error) setError(res.error);
      else setMessage(res?.success || "Synced.");
    });
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={pending}
        className="btn-primary"
      >
        {pending ? "Syncing..." : "Sync trades"}
      </button>
      {message && (
        <p className="mt-2 text-xs text-emerald-400">{message}</p>
      )}
      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </div>
  );
}
