"use client";

import { useActionState } from "react";
import { submitTxAction, type ActionResult } from "@/lib/actions/trader";

export function TxForm({ paymentId }: { paymentId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    submitTxAction,
    null
  );

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <input type="hidden" name="paymentId" value={paymentId} />
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
        <label className="label" htmlFor="txHash">
          Transaction hash (TXID)
        </label>
        <input
          id="txHash"
          name="txHash"
          type="text"
          required
          minLength={10}
          className="input font-mono text-xs"
          placeholder="Paste the TXID from your wallet after sending"
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
        {pending ? "Submitting..." : "I have sent the payment"}
      </button>
    </form>
  );
}
