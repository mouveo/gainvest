import { coingeckoProvider } from "./providers/coingecko";
import { eodhdProvider } from "./providers/eodhd";
import type { QuoteProvider } from "./types";

export const quoteProvider: QuoteProvider = eodhdProvider;

export function pickProviderFor(assetClass: string | null | undefined): QuoteProvider {
  if (assetClass === "crypto") return coingeckoProvider;
  return eodhdProvider;
}

export type { Listing, Quote, QuoteProvider } from "./types";
export { pickPreferredListing } from "./ranking";
export { coingeckoProvider, eodhdProvider };
