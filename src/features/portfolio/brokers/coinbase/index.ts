import type { BrokerProfile } from "../types";

import { parseCoinbaseCsv } from "./parser";

export const coinbaseProfile: BrokerProfile = {
  id: "coinbase",
  name: "Coinbase",
  fileParser: parseCoinbaseCsv,
};
