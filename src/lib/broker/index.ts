import type { BrokerAdapter } from "./types";
import { mockBroker } from "./mock";
import { createCustomBroker } from "./custom";

let cached: BrokerAdapter | null = null;

export function getBroker(): BrokerAdapter {
  if (cached) return cached;
  const driver = process.env.BROKER_DRIVER || "mock";
  if (driver === "custom" && process.env.BROKER_API_URL) {
    cached = createCustomBroker(
      process.env.BROKER_API_URL,
      process.env.BROKER_API_KEY
    );
  } else {
    cached = mockBroker;
  }
  return cached;
}

export type { BrokerAdapter } from "./types";
