import "server-only";

// Stooq quote provider — public CSV endpoint, no auth.
// Yahoo Finance's v7/v8 endpoints returned 401 Unauthorized as of 2026-05-12,
// so we use Stooq as the daily quote source. Stooq does not support batched
// symbols in a single request (comma-separated lists return N/D), so we
// fan out N concurrent requests.

export type Quote = {
  symbol: string;       // Stooq symbol, e.g. "aapl.us"
  price: number;        // close price in the symbol's native currency
  fetchedAt: string;    // ISO timestamp of the fetch
};

// OpenFIGI exchCode -> Stooq suffix.
// Tickers on Stooq use a short country-style suffix, e.g. AAPL.US, LLOY.UK.
// Mapping is conservative: only codes we've validated against the Stooq
// catalogue. Anything missing returns null -> the caller skips the instrument.
const EXCH_TO_STOOQ_SUFFIX: Record<string, string> = {
  US: "us",
  UN: "us", // NYSE Composite
  UA: "us", // Nasdaq Global Select
  UQ: "us", // Nasdaq Global Market
  UR: "us", // NYSE American
  LN: "uk",
  GR: "de", // Xetra
  GY: "de", // Deutsche Börse
  FP: "fr", // Euronext Paris
  NA: "nl", // Euronext Amsterdam
  IM: "it", // Borsa Italiana
  SM: "es", // Madrid
  SW: "ch", // SIX Swiss
  SE: "ch",
};

export function exchCodeToStooqSuffix(exchCode: string | null | undefined): string | null {
  if (!exchCode) return null;
  return EXCH_TO_STOOQ_SUFFIX[exchCode.toUpperCase()] ?? null;
}

export function buildStooqSymbol(ticker: string, exchCode: string | null | undefined): string | null {
  const suffix = exchCodeToStooqSuffix(exchCode);
  if (!suffix) return null;
  return `${ticker.toLowerCase()}.${suffix}`;
}

async function fetchOneStooqQuote(symbol: string): Promise<Quote | null> {
  // f=sd2t2c -> Symbol, Date, Time, Close (compact CSV)
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2c&h&e=csv`;
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  // Expected: header + 1 data row.
  if (lines.length < 2) return null;
  const cols = lines[1]!.split(",");
  // [Symbol, Date, Time, Close]
  if (cols.length < 4) return null;
  const close = parseFloat(cols[3]!);
  if (!Number.isFinite(close) || close <= 0) return null;
  return {
    symbol,
    price: close,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchStooqQuotes(symbols: string[]): Promise<Quote[]> {
  if (symbols.length === 0) return [];
  const results = await Promise.all(symbols.map(fetchOneStooqQuote));
  return results.filter((q): q is Quote => q != null);
}
