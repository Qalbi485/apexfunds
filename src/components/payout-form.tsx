"use client";

import { useActionState } from "react";
import {
  requestPayoutAction,
  type ActionResult,
} from "@/lib/actions/trader";

export function PayoutForm({
  challengeId,
  available,
}: {
  challengeId: string;
  available: number;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    requestPayoutAction,
    null
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="challengeId" value={challengeId} />
      <div>
        <label className="label" htmlFor="amount">
          Amount (available: ${available.toFixed(2)})
        </label>
        <input
          id="amount"
          name="amount"
          type="number"
          min={1}
          step="0.01"
          required
          className="input"
          placeholder="100.00"
        />
      </div>
      <div>
        <label className="label" htmlFor="network">
          Network
        </label>
        <select id="network" name="network" className="input">
          <option value="TRC20">USDT — TRC20 (Tron)</option>
          <option value="ERC20">USDT — ERC20 (Ethereum)</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="walletAddress">
          Your USDT wallet address
        </label>
        <input
          id="walletAddress"
          name="walletAddress"
          type="text"
          required
          minLength={10}
          className="input font-mono text-xs"
          placeholder="T..."
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
      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "Submitting..." : "Request Payout"}
      </button>
    </form>
  );
}
