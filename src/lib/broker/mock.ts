import type { BrokerAdapter } from "./types";
import type { TradeInput } from "../rules";

const SYMBOLS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "AUDUSD",
  "USDCAD",
  "USDCHF",
  "NZDUSD",
  "EURJPY",
  "GBPJPY",
  "AUDJPY",
  "XAUUSD",
  "BTCUSD",
];

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export const mockBroker: BrokerAdapter = {
  name: "mock",
  async fetchClosedTrades(accountId, since): Promise<TradeInput[]> {
    void accountId;
    const count = Math.floor(rand(0, 3.99));
    const trades: TradeInput[] = [];
    const now = Date.now();
    const sinceMs = since.getTime();

    for (let i = 0; i < count; i++) {
      const closedAt = new Date(sinceMs + rand(60_000, Math.max(120_000, now - sinceMs)));
      if (closedAt.getTime() > now) closedAt.setTime(now - rand(0, 3_600_000));
      const stake = Math.round(rand(10, 120) * 100) / 100;
      const won = Math.random() < 0.56;
      const profit = won
        ? Math.round(stake * rand(0.7, 0.95) * 100) / 100
        : -stake;
      const payout = won ? Math.round((stake + profit) * 100) / 100 : 0;
      trades.push({
        brokerTradeId: `mock_${accountId}_${closedAt.getTime()}_${i}_${Math.random().toString(36).slice(2, 8)}`,
        symbol: SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        direction: Math.random() < 0.5 ? "UP" : "DOWN",
        stake,
        payout,
        profit,
        openedAt: new Date(closedAt.getTime() - rand(60_000, 3_600_000)),
        closedAt,
      });
    }

    trades.sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());
    return trades;
  },
};
