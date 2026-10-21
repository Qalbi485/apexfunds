import { db, TX_OPTS } from "./db";
import { getBroker } from "./broker";
import { applyClosedTradeToChallenge, flushAlerts } from "./trading";

export type SyncResult = {
  ok: boolean;
  error?: string;
  newTrades?: number;
  events?: string[];
  status?: string;
  phase?: string;
};

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === "P2002";
}

export async function syncChallenge(challengeId: string): Promise<SyncResult> {
  const challenge = await db.challenge.findUnique({
    where: { id: challengeId },
    include: { package: true },
  });
  if (!challenge) return { ok: false, error: "Challenge not found" };
  if (!["ACTIVE", "FUNDED"].includes(challenge.status)) {
    return { ok: false, error: "Challenge is not active" };
  }

  const broker = getBroker();
  const since = challenge.startedAt ?? challenge.createdAt;

  let incoming;
  try {
    incoming = await broker.fetchClosedTrades(
      challenge.brokerAccountId ?? challenge.id,
      since
    );
  } catch (e) {
    return { ok: false, error: `Broker error: ${(e as Error).message}` };
  }

  if (incoming.length === 0) {
    return { ok: true, newTrades: 0, events: [] };
  }

  const existing = await db.trade.findMany({
    where: {
      challengeId,
      brokerTradeId: { in: incoming.map((t) => t.brokerTradeId) },
    },
    select: { brokerTradeId: true },
  });
  const seen = new Set(existing.map((t) => t.brokerTradeId));
  const fresh = incoming
    .filter((t) => !seen.has(t.brokerTradeId))
    .sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());

  if (fresh.length === 0) {
    return { ok: true, newTrades: 0, events: [] };
  }

  const allEvents: string[] = [];
  let lastStatus = challenge.status;
  let lastPhase = challenge.phase;
  let appliedCount = 0;

  for (const t of fresh) {
    // Atomic per-trade: create + P&L application commit together or not at
    // all. The write-first ordering (trade insert takes the write lock before
    // the challenge state is read) serializes against concurrent
    // settlements/syncs, so balance updates can never be based on stale state.
    let outcome;
    try {
      outcome = await db.$transaction(async (tx) => {
        await tx.trade.create({
          data: {
            challengeId,
            brokerTradeId: t.brokerTradeId,
            symbol: t.symbol,
            direction: t.direction,
            stake: t.stake,
            payout: t.payout,
            profit: t.profit,
            status: "CLOSED",
            openedAt: t.openedAt,
            closedAt: t.closedAt,
          },
        });
        const o = await applyClosedTradeToChallenge(challengeId, t, tx);
        if ("error" in o) throw new Error(o.error);
        return o;
      }, TX_OPTS);
    } catch (e) {
      if (isUniqueViolation(e)) {
        // A concurrent sync already inserted and applied this exact trade —
        // skip it (idempotent under concurrent/duplicate broker payloads).
        continue;
      }
      return { ok: false, error: (e as Error).message };
    }

    appliedCount++;
    await flushAlerts(outcome.alerts);
    allEvents.push(...outcome.events);
    lastStatus = outcome.status;
    lastPhase = outcome.phase;

    if (outcome.ignored) {
      // Challenge became ineligible mid-sync (e.g. breached on an earlier
      // trade in this batch). Stop applying; keep already-applied trades.
      break;
    }

    if (outcome.breachReason) {
      break;
    }
  }

  return {
    ok: true,
    newTrades: appliedCount,
    events: allEvents,
    status: lastStatus,
    phase: lastPhase,
  };
}
