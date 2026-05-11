import "server-only";

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

export type IsinLookup = {
  isin: string;
  name: string;
  assetClass: "etf" | "equity" | "fund" | "bond" | "crypto";
  currency: string;
  country: string | null;
  ticker: string | null;
  source: "openfigi" | "cache";
};

export function isValidIsin(isin: string): boolean {
  return ISIN_RE.test(isin);
}

const FIGI_TO_CLASS: Record<string, IsinLookup["assetClass"]> = {
  "Common Stock": "equity",
  "Preferred Stock": "equity",
  ADR: "equity",
  ETP: "etf",
  ETF: "etf",
  "Mutual Fund": "fund",
  "Open-End Fund": "fund",
  "Closed-End Fund": "fund",
  Fund: "fund",
  Bond: "bond",
  Note: "bond",
  Bill: "bond",
};

const EXCH_TO_CURRENCY: Record<string, string> = {
  US: "USD",
  UN: "USD",
  UQ: "USD",
  UA: "USD",
  LN: "GBP",
  GR: "EUR",
  GY: "EUR",
  FP: "EUR",
  NA: "EUR",
  IM: "EUR",
  ID: "EUR",
  SW: "CHF",
  SE: "CHF",
};

function currencyFromIsinPrefix(isin: string): string {
  const prefix = isin.slice(0, 2);
  if (prefix === "US" || prefix === "CA") return "USD";
  if (prefix === "GB") return "GBP";
  if (prefix === "CH") return "CHF";
  return "EUR";
}

type OpenFigiRecord = {
  name?: string;
  securityDescription?: string;
  ticker?: string;
  securityType?: string;
  securityType2?: string;
  exchCode?: string;
};

type OpenFigiResponseItem =
  | { data: OpenFigiRecord[] }
  | { warning: string }
  | { error: string };

export async function lookupIsin(isin: string): Promise<IsinLookup | null> {
  if (!isValidIsin(isin)) return null;

  let response: Response;
  try {
    response = await fetch("https://api.openfigi.com/v3/mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ idType: "ID_ISIN", idValue: isin }]),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  let payload: OpenFigiResponseItem[];
  try {
    payload = (await response.json()) as OpenFigiResponseItem[];
  } catch {
    return null;
  }

  const first = payload?.[0];
  if (!first || !("data" in first) || !Array.isArray(first.data)) return null;

  const record = first.data[0];
  if (!record) return null;

  const name = record.name ?? record.securityDescription;
  if (!name) return null;

  const figiType = record.securityType2 ?? record.securityType ?? "";
  const assetClass = FIGI_TO_CLASS[figiType] ?? "equity";

  const currency =
    (record.exchCode ? EXCH_TO_CURRENCY[record.exchCode] : undefined) ??
    currencyFromIsinPrefix(isin);

  const country = isin.slice(0, 2);
  const ticker = record.ticker ?? null;

  return {
    isin,
    name,
    assetClass,
    currency,
    country,
    ticker,
    source: "openfigi",
  };
}
