import type { BrokerAdapter } from "./types";
import type { TradeInput } from "../rules";

type ApiTrade = {
  id: string;
  symbol: string;
  direction: string;
  stake: number;
  payout?: number | null;
  profit: number;
  opened_at: string;
  closed_at: string;
};

export function createCustomBroker(apiUrl: string, apiKey?: string): BrokerAdapter {
  return {
    name: "custom",
    async fetchClosedTrades(accountId, since): Promise<TradeInput[]> {
      const url = new URL(apiUrl);
      url.searchParams.set("accountId", accountId);
      url.searchParams.set("since", since.toISOString());

      const res = await fetch(url.toString(), {
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`Broker API error: ${res.status}`);
      }
      const data = (await res.json()) as { trades: ApiTrade[] };
      if (!Array.isArray(data.trades)) return [];
      return data.trades.map((t) => ({
        brokerTradeId: t.id,
        symbol: t.symbol,
        direction: t.direction,
        stake: t.stake,
        payout: t.payout ?? null,
        profit: t.profit,
        openedAt: new Date(t.opened_at),
        closedAt: new Date(t.closed_at),
      }));
    },
  };
}
