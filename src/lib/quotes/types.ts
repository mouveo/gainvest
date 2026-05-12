export type Listing = {
  mic: string;
  currency: string;
  exchangeName: string;
  providerSymbol: string;
  country: string;
  previousClose: number | null;
};

export type Quote = {
  close: number;
  fetchedAt: string;
};

export interface QuoteProvider {
  readonly name: string;
  searchListings(isin: string): Promise<Listing[]>;
  fetchQuote(providerSymbol: string): Promise<Quote | null>;
  fetchFxToEur(currency: string): Promise<number | null>;
}
