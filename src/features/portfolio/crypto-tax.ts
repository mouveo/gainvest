// French art. 150 VH bis crypto tax calculator.
//
// Computes the "plus-value brute" of each fiat cession over a given calendar
// year, using the regulator's "global portfolio PMP" method:
//
//   plusValueBrute = proceeds − (totalAcquiredCostRemaining × proceeds
//                                  / portfolioValueAtCessionDate)
//
// Conversions crypto-to-crypto (Coinbase Convert legs, flagged by
// `convertPairId !== null`) are explicitly excluded from the fiscal scope —
// only fiat-realising sells count. Staking / interest / rewards are likewise
// excluded from the acquisition price for V1: they create taxable income
// of a different nature (BNC / revenus mobiliers depending on context) and
// folding them in here would silently dilute the PMP — better to leave them
// out and surface a separate income view later.
//
// The "incomplete" flag is the safety valve: any missing historical price
// (a coin still held at cession date but with no EUR quote in
// crypto_prices_daily and no CoinGecko fallback) propagates up to both the
// cession and the yearly summary, so the UI never presents a partial result
// as déclaratif.

import type { OrderRow } from "./aggregate";

export type CryptoCession = {
  date: string;
  symbol: string;
  proceedsEur: number;
  costShareEur: number;
  plusValueBrute: number;
  portfolioValueAtDate: number;
  totalAcquiredAtDate: number;
  incomplete: boolean;
  missingPrices: string[];
};

export type CryptoTaxYearSummary = {
  year: number;
  totalCessions: number;
  totalCostShare: number;
  totalPlusValueBrute: number;
  belowThreshold: boolean;
  incomplete: boolean;
  cessions: CryptoCession[];
};

// 305 € — art. 150 VH bis annual cession threshold. Below it the global
// gain is exempt; we surface a flag rather than zero-out the values so the
// user still sees the underlying figures.
export const CRYPTO_TAX_THRESHOLD_EUR = 305;

// A symbol coupled with the provider id we need to ask the historical price
// helper. The caller is responsible for resolving (symbol, instrumentId) →
// providerSymbol (CoinGecko id) before passing it down, since `crypto-tax.ts`
// stays pure and DB-free.
export type CryptoIdent = {
  symbol: string;
  providerSymbol: string | null;
};

// Map keyed on the cession date (YYYY-MM-DD) of historical prices in EUR per
// providerSymbol. The caller resolves these via `getCryptoPriceEur`.
export type HistoricalPriceMap = Map<string, Map<string, number>>;

function eurOf(o: OrderRow): number {
  const fx = o.fxRate ?? 1;
  return Number(o.grossAmount) * fx;
}
function feesEur(o: OrderRow): number {
  return Number(o.fees ?? 0) * (o.fxRate ?? 1);
}

function identKey(o: OrderRow): string {
  // We need a stable per-coin key to track quantities. instrumentId is the
  // strongest signal; symbol is the fallback when an instrument couldn't be
  // resolved at parse time (e.g. unknown crypto). Cession lines without a
  // symbol fall back to instrumentName so we can still display something.
  return o.instrumentId ?? o.instrumentSymbol ?? o.instrumentName ?? "_";
}

type CoinState = {
  symbol: string;
  providerSymbol: string | null;
  qty: number;
};

export function computeFrenchCryptoTax(
  orders: OrderRow[],
  options: {
    year: number;
    // Resolves the EUR price of a coin at a given date. Returns null when no
    // price is available — the caller (page.tsx) is the only place that
    // hits the DB / CoinGecko, so this function stays pure.
    priceAt: (providerSymbol: string, date: string) => number | null;
    // Maps an order's logical identity to a CoinGecko id when needed. The
    // page resolves this from `instruments.provider_symbol` so we keep the
    // crypto-tax module free of DB knowledge.
    providerSymbolFor: (order: OrderRow) => string | null;
  },
): CryptoTaxYearSummary {
  // Step 1 — keep only crypto rows that affect the global PMP.
  const cryptoOrders = orders
    .filter((o) => o.assetClass === "crypto")
    .sort((a, b) => {
      if (a.tradeDate !== b.tradeDate) return a.tradeDate < b.tradeDate ? -1 : 1;
      const ka = a.tradeTime ?? "00:00:00";
      const kb = b.tradeTime ?? "00:00:00";
      if (ka !== kb) return ka < kb ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  // Step 2 — replay chronologically. The PMP method tracks ONE global pool
  // of "total acquired cost remaining" + per-coin quantities. We never split
  // the cost across coins until a cession crystallises a share.
  const coins = new Map<string, CoinState>();
  let totalAcquiredCost = 0;
  const cessions: CryptoCession[] = [];

  for (const o of cryptoOrders) {
    const key = identKey(o);

    // Crypto-to-crypto convert legs are NOT taxable events under art. 150 VH
    // bis (the rule treats the whole portfolio as one fungible block; only a
    // fiat off-ramp triggers tax). We still update qty/cost so the running
    // PMP stays in sync with what the user actually holds.
    const isConvertLeg = o.convertPairId !== null;

    if (o.kind === "buy") {
      const qty = Number(o.quantity ?? 0);
      if (qty <= 0) continue;
      const cost = eurOf(o) + feesEur(o);
      const coin = coins.get(key) ?? {
        symbol: o.instrumentSymbol ?? o.instrumentName,
        providerSymbol: options.providerSymbolFor(o),
        qty: 0,
      };
      coin.qty += qty;
      // Refresh provider_symbol if it became known on a later buy.
      if (!coin.providerSymbol) {
        coin.providerSymbol = options.providerSymbolFor(o);
      }
      coins.set(key, coin);
      // Convert legs contribute to qty but NOT to the global PMP cost basis:
      // the matching sell leg already accounted for the crypto being spent,
      // and the corresponding crypto-to-crypto rule keeps the cost frozen.
      if (!isConvertLeg) totalAcquiredCost += cost;
      continue;
    }

    if (o.kind === "sell") {
      const qty = Number(o.quantity ?? 0);
      if (qty <= 0) continue;
      const coin = coins.get(key);
      if (!coin) continue;
      // Crypto-to-crypto convert leg: decrement qty, don't trigger cession.
      if (isConvertLeg) {
        coin.qty = Math.max(0, coin.qty - qty);
        continue;
      }
      // Fiat cession — apply the PMP rule.
      const proceeds = Math.max(0, eurOf(o) - feesEur(o));

      // Value the entire portfolio at the cession date.
      const missingPrices: string[] = [];
      let portfolioValueAtDate = 0;
      const cessionCoinPrice =
        coin.providerSymbol != null
          ? options.priceAt(coin.providerSymbol, o.tradeDate)
          : null;
      for (const c of coins.values()) {
        if (c.qty <= 0) continue;
        // The sold coin's "remaining" qty after this cession is what counts
        // toward the still-held portfolio value at this date — but for the
        // formula's denominator the standard practice is to value the holding
        // BEFORE the cession (i.e. including the qty about to be sold), since
        // proceeds and value-at-date are evaluated as one event.
        const price =
          c.providerSymbol != null
            ? options.priceAt(c.providerSymbol, o.tradeDate)
            : null;
        if (price == null) {
          missingPrices.push(c.symbol);
          continue;
        }
        portfolioValueAtDate += c.qty * price;
      }

      // If the sold coin's own price was missing, the cession is incomplete
      // regardless of whether the other holdings could be priced.
      const incomplete =
        missingPrices.length > 0 || (cessionCoinPrice == null && coin.qty > 0);

      // costShare proportional to proceeds / portfolio value. If portfolio
      // value is zero (or unknown) we can't compute a share — surface zero
      // cost and the incomplete flag.
      const costShare =
        portfolioValueAtDate > 0
          ? totalAcquiredCost * (proceeds / portfolioValueAtDate)
          : 0;
      const plusValueBrute = proceeds - costShare;

      cessions.push({
        date: o.tradeDate,
        symbol: coin.symbol,
        proceedsEur: proceeds,
        costShareEur: costShare,
        plusValueBrute,
        portfolioValueAtDate,
        totalAcquiredAtDate: totalAcquiredCost,
        incomplete,
        missingPrices,
      });

      // Update state: drop the consumed cost share + qty.
      totalAcquiredCost = Math.max(0, totalAcquiredCost - costShare);
      coin.qty = Math.max(0, coin.qty - qty);
      continue;
    }

    // Staking / interest / fee / dividend / deposit / withdrawal: ignored
    // for the PMP computation (see header comment for why).
  }

  // Step 3 — keep only cessions of the requested year and aggregate.
  const yearStr = String(options.year);
  const yearCessions = cessions.filter((c) => c.date.startsWith(yearStr));
  const totalCessions = yearCessions.reduce((s, c) => s + c.proceedsEur, 0);
  const totalCostShare = yearCessions.reduce((s, c) => s + c.costShareEur, 0);
  const totalPlusValueBrute = yearCessions.reduce(
    (s, c) => s + c.plusValueBrute,
    0,
  );
  const incomplete = yearCessions.some((c) => c.incomplete);
  const belowThreshold = totalCessions < CRYPTO_TAX_THRESHOLD_EUR;

  return {
    year: options.year,
    totalCessions,
    totalCostShare,
    totalPlusValueBrute,
    belowThreshold,
    incomplete,
    cessions: yearCessions,
  };
}
