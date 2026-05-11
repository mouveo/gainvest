import { bourseDirectProfile } from "./bourse-direct";
import type { BrokerProfile } from "./types";

export const BROKERS: Record<string, BrokerProfile> = {
  [bourseDirectProfile.id]: bourseDirectProfile,
};

export function getBroker(id: string): BrokerProfile | undefined {
  return BROKERS[id];
}

export function listBrokers(): BrokerProfile[] {
  return Object.values(BROKERS);
}
