import "server-only";

// EODHD provider — covers EU exchanges (Xetra, Euronext, LSE) and US, plus
// FX. Free tier ships 20 API requests / day, so refreshPrices() relies on
// short-circuiting via instruments.current_price_updated_at TTL.
//
// Reference: https://eodhd.com/financial-apis

const BASE = "https://eodhd.com/api";

function token(): string {
  const t = process.env["EODHD_API_KEY"];
  if (!t) throw new Error("EODHD_API_KEY missing in environment");
  return t;
}

export type EodhdSearchHit = {
  code: string; // e.g. "AAPL"
  exchange: string; // e.g. "US", "XETRA", "LSE", "AS"
  name: string;
  type: string; // "Common Stock", "ETF", ...
  country: string;
  currency: string; // e.g. "USD", "EUR", "GBX"
  isin: string;
  isPrimary: boolean;
};

export type EodhdQuote = {
  symbol: string; // "AAPL.US" — the symbol that was queried
  close: number;
  fetchedAt: string; // ISO
};

/**
 * Resolve an ISIN to the primary EODHD listing. EODHD's free tier `search`
 * endpoint returns every venue that lists the security; we keep the row
 * marked `isPrimary: true` (or fall back to the first row if none).
 *
 * Counts as 1 API request.
 */
export async function searchByIsin(isin: string): Promise<EodhdSearchHit | null> {
  const url = `${BASE}/search/${encodeURIComponent(isin)}?api_token=${token()}&fmt=json`;
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(7000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const hits = (await res.json()) as Array<{
    Code?: string;
    Exchange?: string;
    Name?: string;
    Type?: string;
    Country?: string;
    Currency?: string;
    ISIN?: string;
    isPrimary?: boolean;
  }>;
  if (!Array.isArray(hits) || hits.length === 0) return null;
  const primary = hits.find((h) => h.isPrimary === true) ?? hits[0]!;
  if (!primary.Code || !primary.Exchange) return null;
  return {
    code: primary.Code,
    exchange: primary.Exchange,
    name: primary.Name ?? "",
    type: primary.Type ?? "",
    country: primary.Country ?? "",
    currency: primary.Currency ?? "EUR",
    isin: primary.ISIN ?? isin,
    isPrimary: primary.isPrimary === true,
  };
}

/**
 * Real-time quote for a symbol expressed as `<code>.<exchange>` (e.g.
 * "AAPL.US", "IS3N.XETRA"). On the free tier the data is delayed 15-20 min.
 * Counts as 1 API request.
 */
export async function fetchRealTimeQuote(symbol: string): Promise<EodhdQuote | null> {
  const url = `${BASE}/real-time/${encodeURIComponent(symbol)}?api_token=${token()}&fmt=json`;
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(7000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json()) as { close?: number | string };
  const close = typeof data.close === "number" ? data.close : parseFloat(String(data.close ?? ""));
  if (!Number.isFinite(close) || close <= 0) return null;
  return { symbol, close, fetchedAt: new Date().toISOString() };
}

/**
 * Spot rate "1 <currency> = N EUR". EODHD exposes the inverse pair
 * `<CCY>EUR.FOREX` directly (e.g. USDEUR -> 0.8483 = 1 USD in EUR).
 * Counts as 1 API request.
 */
export async function fetchFxToEur(currency: string): Promise<number | null> {
  const ccy = currency.toUpperCase();
  if (ccy === "EUR") return 1;
  // GBX (London pence) -> 1 GBP = 100 GBX, so 1 GBX in EUR = (GBP/EUR rate) / 100
  if (ccy === "GBX") {
    const gbp = await fetchFxToEur("GBP");
    return gbp == null ? null : gbp / 100;
  }
  const url = `${BASE}/real-time/${ccy}EUR.FOREX?api_token=${token()}&fmt=json`;
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(7000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json()) as { close?: number | string };
  const rate = typeof data.close === "number" ? data.close : parseFloat(String(data.close ?? ""));
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return rate;
}
