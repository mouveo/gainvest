import { bourseDirectProfile } from "./bourse-direct";
import { interactiveBrokersProfile } from "./interactive-brokers";
import type { BrokerProfile } from "./types";

export const BROKERS: Record<string, BrokerProfile> = {
  [bourseDirectProfile.id]: bourseDirectProfile,
  [interactiveBrokersProfile.id]: interactiveBrokersProfile,
};

export function getBroker(id: string): BrokerProfile | undefined {
  return BROKERS[id];
}

export function listBrokers(): BrokerProfile[] {
  return Object.values(BROKERS);
}
