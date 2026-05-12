import type { BrokerProfile } from "../types";

import { parseIbkrFlexXml } from "./parser";

export const interactiveBrokersProfile: BrokerProfile = {
  id: "interactive-brokers",
  name: "Interactive Brokers",
  fileParser: parseIbkrFlexXml,
  // No feeCalculator: commissions arrive directly from IBKR (ibCommission).
  // No inferMarket: IBKR provides listingExchange in the XML.
};
