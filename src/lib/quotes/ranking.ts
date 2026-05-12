import type { Listing } from "./types";

const CURRENCY_PRIORITY = ["EUR", "GBP", "USD", "GBX"];

const EU_MIC_PRIORITY = [
  "XETR",
  "XFRA",
  "XAMS",
  "XPAR",
  "XMIL",
  "XBRU",
  "XLIS",
  "XMAD",
  "XSWX",
  "XLON",
];

const US_MICS = new Set(["XNAS", "XNYS"]);

// EUR primary venues outside Frankfurt — XFRA/XETR are routinely used as
// remote listings for foreign instruments, so finding only them does not
// imply the security has an EU home.
const PRIMARY_EUR_MICS = new Set([
  "XPAR",
  "XAMS",
  "XMIL",
  "XBRU",
  "XLIS",
  "XMAD",
  "XSWX",
  "XLON",
]);

function score(value: string, table: readonly string[]): number {
  const idx = table.indexOf(value);
  return idx === -1 ? table.length + 10 : idx;
}

function isUsUniverse(listings: Listing[]): boolean {
  const hasUsListing = listings.some(
    (l) => US_MICS.has(l.mic) && l.country.toUpperCase() === "US",
  );
  if (!hasUsListing) return false;
  const hasPrimaryEur = listings.some(
    (l) => l.currency.toUpperCase() === "EUR" && PRIMARY_EUR_MICS.has(l.mic),
  );
  return !hasPrimaryEur;
}

export function pickPreferredListing(listings: Listing[]): Listing | null {
  if (listings.length === 0) return null;

  if (isUsUniverse(listings)) {
    const xnas = listings.find((l) => l.mic === "XNAS");
    if (xnas) return xnas;
    const xnys = listings.find((l) => l.mic === "XNYS");
    if (xnys) return xnys;
  }

  const ranked = [...listings].sort((a, b) => {
    const ccyA = score(a.currency.toUpperCase(), CURRENCY_PRIORITY);
    const ccyB = score(b.currency.toUpperCase(), CURRENCY_PRIORITY);
    if (ccyA !== ccyB) return ccyA - ccyB;
    return score(a.mic, EU_MIC_PRIORITY) - score(b.mic, EU_MIC_PRIORITY);
  });

  return ranked[0] ?? null;
}

export function findListingForPreference(
  listings: Listing[],
  mic: string | null | undefined,
  currency: string | null | undefined,
): Listing | null {
  if (!mic) return null;
  const wantedCcy = currency ? currency.toUpperCase() : null;
  const match = listings.find((l) => {
    if (l.mic !== mic) return false;
    if (!wantedCcy) return true;
    return l.currency.toUpperCase() === wantedCcy;
  });
  return match ?? null;
}

const DIVERGENCE_THRESHOLD = 0.5;

export function shouldRejectDivergentQuote(
  oldPrice: number | null | undefined,
  newPrice: number,
  force: boolean,
): boolean {
  if (force) return false;
  if (oldPrice == null) return false;
  if (!Number.isFinite(oldPrice) || oldPrice <= 0) return false;
  if (!Number.isFinite(newPrice) || newPrice <= 0) return false;
  return Math.abs(newPrice - oldPrice) / oldPrice > DIVERGENCE_THRESHOLD;
}
