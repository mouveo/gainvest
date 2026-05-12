import "server-only";

import { eodhdExchangeToMic } from "../mic";
import type { Listing, Quote, QuoteProvider } from "../types";

// EODHD provider — covers EU exchanges (Xetra, Euronext, LSE) and US, plus
// FX. Free tier ships 20 API requests / day, so callers must batch /
// short-circuit via cached price TTLs.
//
// Reference: https://eodhd.com/financial-apis

const BASE = "https://eodhd.com/api";
const TIMEOUT_MS = 7000;

function token(): string {
  const t = process.env["EODHD_API_KEY"];
  if (!t) throw new Error("EODHD_API_KEY missing in environment");
  return t;
}

type SearchHit = {
  Code?: string;
  Exchange?: string;
  Name?: string;
  Type?: string;
  Country?: string;
  Currency?: string;
  ISIN?: string;
  previousClose?: number | string;
  isPrimary?: boolean;
};

async function searchListings(isin: string): Promise<Listing[]> {
  const url = `${BASE}/search/${encodeURIComponent(isin)}?api_token=${token()}&fmt=json`;
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const hits = (await res.json()) as SearchHit[];
  if (!Array.isArray(hits)) return [];

  const listings: Listing[] = [];
  for (const h of hits) {
    if (!h.Code || !h.Exchange) continue;
    const exchange = h.Exchange.toUpperCase();
    const mic = eodhdExchangeToMic(exchange);
    if (!mic) continue;
    const pcRaw = h.previousClose;
    const pc =
      typeof pcRaw === "number" ? pcRaw : parseFloat(String(pcRaw ?? ""));
    listings.push({
      mic,
      currency: (h.Currency ?? "").toUpperCase(),
      exchangeName: exchange,
      providerSymbol: `${h.Code}.${exchange}`,
      country: h.Country ?? "",
      previousClose: Number.isFinite(pc) && pc > 0 ? pc : null,
    });
  }
  return listings;
}

async function fetchQuote(providerSymbol: string): Promise<Quote | null> {
  const url = `${BASE}/real-time/${encodeURIComponent(providerSymbol)}?api_token=${token()}&fmt=json`;
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json()) as { close?: number | string };
  const close =
    typeof data.close === "number" ? data.close : parseFloat(String(data.close ?? ""));
  if (!Number.isFinite(close) || close <= 0) return null;
  return { close, fetchedAt: new Date().toISOString() };
}

async function fetchFxToEur(currency: string): Promise<number | null> {
  const ccy = currency.toUpperCase();
  if (ccy === "EUR") return 1;
  // GBX (London pence) — 1 GBP = 100 GBX, so 1 GBX in EUR = (GBP→EUR) / 100.
  if (ccy === "GBX") {
    const gbp = await fetchFxToEur("GBP");
    return gbp == null ? null : gbp / 100;
  }
  const url = `${BASE}/real-time/${ccy}EUR.FOREX?api_token=${token()}&fmt=json`;
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json()) as { close?: number | string };
  const rate =
    typeof data.close === "number" ? data.close : parseFloat(String(data.close ?? ""));
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return rate;
}

export const eodhdProvider: QuoteProvider = {
  name: "eodhd",
  searchListings,
  fetchQuote,
  fetchFxToEur,
};
