import type { TradeInput } from "../rules";

export interface BrokerAdapter {
  name: string;
  fetchClosedTrades(
    accountId: string,
    since: Date
  ): Promise<TradeInput[]>;
}
