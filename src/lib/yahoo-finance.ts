import "server-only";

export type Quote = {
  symbol: string;
  price: number;
  currency: string;
  exchangeName: string | null;
  fetchedAt: string;
};

type YahooQuoteRecord = {
  symbol?: unknown;
  regularMarketPrice?: unknown;
  currency?: unknown;
  fullExchangeName?: unknown;
  exchange?: unknown;
};

type YahooQuoteResponse = {
  quoteResponse?: {
    result?: unknown;
  };
};

const ENDPOINT = "https://query1.finance.yahoo.com/v7/finance/quote";
const BATCH_SIZE = 50;
const FETCH_TIMEOUT_MS = 7000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  if (!Array.isArray(symbols) || symbols.length === 0) return [];

  const unique = Array.from(
    new Set(
      symbols
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter((s) => s.length > 0),
    ),
  );
  if (unique.length === 0) return [];

  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    batches.push(unique.slice(i, i + BATCH_SIZE));
  }

  const quotes: Quote[] = [];
  for (const batch of batches) {
    const batchQuotes = await fetchBatch(batch);
    quotes.push(...batchQuotes);
  }
  return quotes;
}

async function fetchBatch(symbols: string[]): Promise<Quote[]> {
  const url = `${ENDPOINT}?symbols=${encodeURIComponent(symbols.join(","))}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return [];
  }

  if (!response.ok) return [];

  let payload: YahooQuoteResponse;
  try {
    payload = (await response.json()) as YahooQuoteResponse;
  } catch {
    return [];
  }

  const results = payload?.quoteResponse?.result;
  if (!Array.isArray(results)) return [];

  const fetchedAt = new Date().toISOString();
  const out: Quote[] = [];
  for (const raw of results) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as YahooQuoteRecord;

    const symbol = typeof rec.symbol === "string" ? rec.symbol : null;
    const price = typeof rec.regularMarketPrice === "number" ? rec.regularMarketPrice : null;
    if (!symbol || price === null || !Number.isFinite(price)) continue;

    const currency = typeof rec.currency === "string" && rec.currency.length > 0 ? rec.currency : "USD";
    const exchangeName =
      typeof rec.fullExchangeName === "string" && rec.fullExchangeName.length > 0
        ? rec.fullExchangeName
        : typeof rec.exchange === "string" && rec.exchange.length > 0
          ? rec.exchange
          : null;

    out.push({ symbol, price, currency, exchangeName, fetchedAt });
  }
  return out;
}
