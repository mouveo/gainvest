import type { BrokerProfile } from "../types";

import { computeBourseDirectFees } from "./fees";
import { inferBourseDirectMarket, parseBourseDirectCsv } from "./parser";

export const bourseDirectProfile: BrokerProfile = {
  id: "bourse-direct",
  name: "Bourse Direct",
  csvParser: parseBourseDirectCsv,
  feeCalculator: computeBourseDirectFees,
  inferMarket: inferBourseDirectMarket,
};
