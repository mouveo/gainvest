import "server-only";

import type { Listing, Quote, QuoteProvider } from "../types";

// CoinGecko provider — covers crypto spot quotes in EUR. Demo key is optional
// (passed via x-cg-demo-api-key); without it we use the public endpoint, which
// is rate-limited to ~10-30 calls/min.
//
// Reference: https://docs.coingecko.com/reference

const BASE = "https://api.coingecko.com/api/v3";
const TIMEOUT_MS = 7000;
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

// CoinGecko returns multiple `id`s for popular tickers (e.g. BTC matches
// `bitcoin` and ~5 wrapped variants). Pin the canonical mapping so we don't
// silently track Wrapped BTC when the user typed BTC.
const PRIMARY_BY_SYMBOL: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  USDT: "tether",
  USDC: "usd-coin",
  BNB: "binancecoin",
};

function headers(): HeadersInit {
  const key = process.env["COINGECKO_API_KEY"];
  return key ? { "x-cg-demo-api-key": key } : {};
}

type CoinListEntry = {
  id?: string;
  symbol?: string;
  name?: string;
};

async function searchListings(query: string): Promise<Listing[]> {
  const cleaned = query.trim();
  if (!cleaned) return [];
  if (ISIN_RE.test(cleaned.toUpperCase())) return [];

  const url = `${BASE}/coins/list?include_platform=false`;
  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      headers: headers(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const coins = (await res.json()) as CoinListEntry[];
  if (!Array.isArray(coins)) return [];

  const upper = cleaned.toUpperCase();
  const lower = cleaned.toLowerCase();

  const matches: Listing[] = [];
  for (const c of coins) {
    if (!c.id || !c.symbol) continue;
    const symU = c.symbol.toUpperCase();
    const nameL = (c.name ?? "").toLowerCase();
    if (symU !== upper && c.id !== lower && nameL !== lower) continue;
    matches.push({
      mic: "CRYPTO",
      currency: "EUR",
      exchangeName: "COINGECKO",
      providerSymbol: c.id,
      country: "",
      previousClose: null,
    });
  }

  const primary = PRIMARY_BY_SYMBOL[upper];
  if (primary) {
    matches.sort((a, b) => {
      if (a.providerSymbol === primary) return -1;
      if (b.providerSymbol === primary) return 1;
      return 0;
    });
  }
  return matches;
}

async function fetchQuote(providerSymbol: string): Promise<Quote | null> {
  const id = providerSymbol.trim();
  if (!id) return null;
  const url = `${BASE}/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=eur`;
  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      headers: headers(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, { eur?: number | string }>;
  const entry = data?.[id];
  if (!entry) return null;
  const raw = entry.eur;
  const close = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
  if (!Number.isFinite(close) || close <= 0) return null;
  return { close, fetchedAt: new Date().toISOString() };
}

async function fetchFxToEur(currency: string): Promise<number | null> {
  // Crypto instruments are quoted directly in EUR by `fetchQuote`, so the
  // provider only has a meaningful answer for EUR itself.
  return currency.toUpperCase() === "EUR" ? 1 : null;
}

export const coingeckoProvider: QuoteProvider = {
  name: "coingecko",
  searchListings,
  fetchQuote,
  fetchFxToEur,
};
