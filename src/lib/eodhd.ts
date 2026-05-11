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

// Exchanges we prefer for non-US instruments, in priority order. Picks an EUR
// venue when one exists — EODHD often returns LSE first for European ETFs
// (priced in GBX, useless for an EUR-only dashboard).
const NON_US_EXCHANGE_PRIORITY = [
  "XETRA", // Deutsche Börse — typically the deepest book for UCITS ETFs
  "F",     // Frankfurt floor
  "AS",    // Euronext Amsterdam — primary for many iShares IE
  "PA",    // Euronext Paris
  "MI",    // Borsa Italiana
  "BR",    // Euronext Bruxelles
  "LS",    // Euronext Lisbon
  "MC",    // Madrid
  "SW",    // SIX Swiss
];

function rankHit(hit: { Exchange?: string; Currency?: string }, isUsIsin: boolean): number {
  const ex = (hit.Exchange ?? "").toUpperCase();
  const ccy = (hit.Currency ?? "").toUpperCase();
  if (isUsIsin) {
    // US ISIN: always prefer the US listing in USD; treat anything else as last
    return ex === "US" ? 0 : 100;
  }
  // Non-US: prefer EUR > GBP > USD > GBX, then by exchange priority
  const exRank = NON_US_EXCHANGE_PRIORITY.indexOf(ex);
  const exScore = exRank === -1 ? 50 : exRank;
  const ccyScore = ccy === "EUR" ? 0 : ccy === "GBP" ? 30 : ccy === "USD" ? 40 : ccy === "GBX" ? 60 : 70;
  return ccyScore + exScore;
}

/**
 * Resolve an ISIN to the EODHD listing best suited for an EUR-centric
 * portfolio. We rank candidates by currency first (EUR > GBP > USD > GBX) and
 * then by exchange depth (Xetra > Frankfurt > Amsterdam > Paris > ...).
 * EODHD's `isPrimary` flag is unreliable for European ETFs (frequently points
 * at LSE in GBX), so we ignore it in favour of the ranking.
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

  const isUsIsin = isin.startsWith("US");
  const best = hits
    .filter((h) => h.Code && h.Exchange)
    .sort((a, b) => rankHit(a, isUsIsin) - rankHit(b, isUsIsin))[0];
  if (!best || !best.Code || !best.Exchange) return null;

  return {
    code: best.Code,
    exchange: best.Exchange,
    name: best.Name ?? "",
    type: best.Type ?? "",
    country: best.Country ?? "",
    currency: best.Currency ?? "EUR",
    isin: best.ISIN ?? isin,
    isPrimary: best.isPrimary === true,
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
