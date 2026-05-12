import { eodhdProvider } from "./providers/eodhd";
import type { QuoteProvider } from "./types";

export const quoteProvider: QuoteProvider = eodhdProvider;
export type { Listing, Quote, QuoteProvider } from "./types";
export { pickPreferredListing } from "./ranking";
