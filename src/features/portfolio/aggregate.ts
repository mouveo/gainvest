// Aggregate raw orders into positions by replaying transactions chronologically
// on a per (isin, support) line. CUMP fongible: a partial sell consumes a
// prorata share of past buy/dividend flows; the remaining lot keeps the rest.
//
// Inputs are *already filtered* to the current user via RLS.

import { daysBetween } from "./format";
import {
  replayTransactions,
  type ActivePosition,
  type PastRealization,
} from "./realize";
import type { Support } from "./types";
import { xirr, type Flow } from "./xirr";

// Cash kinds + buy/sell/dividend/fee. `interest` and `tax` arrive with IBKR;
// `deposit` / `withdrawal` are user-facing cash transfers that close the loop
// on the cash replay.
export type OrderKind =
  | "buy"
  | "sell"
  | "dividend"
  | "interest"
  | "fee"
  | "tax"
  | "deposit"
  | "withdrawal";

export type OrderRow = {
  id: string;
  isin: string;
  instrumentId: string | null;
  // instruments.symbol — required for ISIN-less assets (crypto) to keep the
  // line identity stable across renames. Null on cash rows / pre-LOT4 data.
  instrumentSymbol: string | null;
  preferredMic: string | null;
  preferredCurrency: string | null;
  // For dividend/fee rows without an instrument, this can carry the description
  // ("Droits de garde 2022 T3" etc.) — see queries.ts.
  instrumentName: string;
  // "cash" is used as a fallback for cash flows without an instrument.
  assetClass: string;
  // Coinbase Convert legs share the same id. Null for every other row.
  convertPairId: string | null;
  // Native currency of grossAmount/fees/price. Use fxRate to project to EUR.
  currency: string;
  kind: OrderKind;
  tradeDate: string;
  tradeTime: string | null;
  quantity: number | null;
  price: number | null;
  // grossAmount and fees are in `currency`. Multiply by fxRate to get EUR.
  grossAmount: number;
  fees: number;
  // currency -> EUR rate snapshot at trade time. Defaults to 1 for EUR rows.
  fxRate: number;
  // Free-text description preserved from the broker row. Used to detect
  // holding-fee subtypes ("Droits de garde", "Frais de conservation").
  notes: string | null;
  executionVenue: string | null;
  broker: string | null;
  support: Support;
  // Bond-only metadata propagated from the instrument row. Null on non-bond
  // or when the bond hasn't been backfilled yet.
  bondCouponRate: number | null;
  bondMaturityDate: string | null;
  bondCouponFrequency: 1 | 2 | 4 | null;
};

export type TradableOrder = OrderRow & { quantity: number; price: number };

/**
 * Current market price for an instrument, broken into its raw components so
 * each consumer can pick the right view without re-deriving FX.
 *
 * - `native`   : price in the instrument's native currency. For asset_class
 *                `bond`, this is a **percentage of par** (e.g. 97.38 means
 *                97.38% of nominal), per IBKR / EODHD convention. For every
 *                other asset class it's the unit price.
 * - `eur`      : EUR price per **unit of position quantity** (i.e. the value
 *                that, multiplied by `qty`, gives the EUR valuation). For
 *                non-bonds that's `native * fxToEur`; for bonds it's
 *                `native / 100 * fxToEur` since `qty` is nominal.
 * - `currency` : ISO code of `native`.
 * - `fxToEur`  : currency-to-EUR rate snapshot used to derive `eur`.
 */
export type CurrentPrice = {
  native: number;
  eur: number;
  currency: string;
  fxToEur: number;
};

export function grossAmountEur(o: Pick<OrderRow, "grossAmount" | "fxRate">): number {
  return o.grossAmount * (o.fxRate ?? 1);
}

export function feesEur(o: Pick<OrderRow, "fees" | "fxRate">): number {
  return (o.fees ?? 0) * (o.fxRate ?? 1);
}

export type Position = {
  key: string;
  isin: string;
  instrumentId: string | null;
  instrumentSymbol: string | null;
  preferredMic: string | null;
  preferredCurrency: string | null;
  support: Support;
  broker: string | null;
  instrumentName: string;
  assetClass: string;
  currency: string;
  qty: number;
  pru: number;
  // Brut hors frais (vue pédagogique). Conversion 1:1 depuis ActivePosition.
  pruGross: number;
  investedGross: number;
  pnlCapitalGross: number;
  currentPrice: number;
  valuation: number;
  invested: number;
  // For bonds, `currentPrice` is the native quote in % of par and `currentPctPar`
  // mirrors it explicitly; `pruPctPar` is the weighted-average buy price also in
  // % of par. Both are `null` for non-bond positions (cash, equity, etf, ...).
  pruPctPar: number | null;
  currentPctPar: number | null;
  // Capital P&L (price-only). Kept under the legacy field names for compat.
  pnl: number;
  pnlPct: number;
  // pnlAnnualized used to be a (1+pnlPct)^(1/yearsHeld) compounding; it is now
  // the capital XIRR derived from real-dated cash flows. Same field name for
  // call-site compatibility.
  pnlAnnualized: number;
  meanDate: Date;
  daysHeld: number;
  yearsHeld: number;
  ordersCount: number;
  buyCount: number;
  sellCount: number;
  totalFees: number;
  orders: TradableOrder[];
  // New fields surfaced by the replay engine.
  dividendsAttributed: number;
  pnlCapital: number;
  pnlTotal: number;
  pnlPctCapital: number;
  pnlPctTotal: number;
  // Rendement annualisé issu des seuls dividendes/coupons reçus (= "yield on
  // cost"). Null quand divs nuls ou fenêtre < 18 jours. Voir realize.ts.
  divYieldAnnualized: number | null;
  xirrCapital: number;
  xirrTotal: number;
  cashFlowsCapital: Flow[];
  cashFlowsTotal: Flow[];
  // Custody fees ("droits de garde") allocated to this position so far. Does
  // NOT alter totalCost / averagePrice / PRU; only feeds the *net of fees*
  // P&L and XIRR derivatives below.
  holdingFees: number;
  cashFlowsCapitalNetFees: Flow[];
  cashFlowsTotalNetFees: Flow[];
  xirrCapitalNetFees: number;
  xirrTotalNetFees: number;
  // Bond-specific metadata + FX snapshot needed to render the bond detail
  // modal (YTM, future coupons in EUR). `bondCouponFrequency` follows the
  // DB CHECK constraint `IN (1, 2, 4)`. Null for non-bond/cash positions.
  bondCouponRate: number | null;
  bondMaturityDate: string | null;
  bondCouponFrequency: 1 | 2 | 4 | null;
  fxToEur: number;
};

function activeToPosition(p: ActivePosition): Position {
  return {
    key: p.key,
    isin: p.isin,
    instrumentId: p.instrumentId,
    instrumentSymbol: p.instrumentSymbol,
    preferredMic: p.preferredMic,
    preferredCurrency: p.preferredCurrency,
    support: p.support,
    broker: p.broker,
    instrumentName: p.instrumentName,
    assetClass: p.assetClass,
    currency: p.currency,
    qty: p.qty,
    pru: p.pru,
    pruGross: p.pruGross,
    investedGross: p.investedGross,
    pnlCapitalGross: p.pnlCapitalGross,
    currentPrice: p.currentPrice,
    pruPctPar: p.pruPctPar,
    currentPctPar: p.currentPctPar,
    valuation: p.valuation,
    invested: p.invested,
    pnl: p.pnlCapital,
    pnlPct: p.pnlPctCapital,
    pnlAnnualized: Number.isFinite(p.xirrCapital) ? p.xirrCapital : 0,
    meanDate: p.firstBuyDate,
    daysHeld: p.daysHeld,
    yearsHeld: p.yearsHeld,
    ordersCount: p.ordersCount,
    buyCount: p.buyCount,
    sellCount: p.sellCount,
    totalFees: p.totalFees,
    orders: p.orders,
    dividendsAttributed: p.dividendsAttributed,
    pnlCapital: p.pnlCapital,
    pnlTotal: p.pnlTotal,
    pnlPctCapital: p.pnlPctCapital,
    pnlPctTotal: p.pnlPctTotal,
    divYieldAnnualized: p.divYieldAnnualized,
    xirrCapital: p.xirrCapital,
    xirrTotal: p.xirrTotal,
    cashFlowsCapital: p.cashFlowsCapital,
    cashFlowsTotal: p.cashFlowsTotal,
    holdingFees: p.holdingFeesAttributed,
    cashFlowsCapitalNetFees: p.cashFlowsCapitalNetFees,
    cashFlowsTotalNetFees: p.cashFlowsTotalNetFees,
    xirrCapitalNetFees: p.xirrCapitalNetFees,
    xirrTotalNetFees: p.xirrTotalNetFees,
    bondCouponRate: p.bondCouponRate,
    bondMaturityDate: p.bondMaturityDate,
    bondCouponFrequency: p.bondCouponFrequency,
    fxToEur: p.fxToEur,
  };
}

function byValuationDesc(a: Position, b: Position): number {
  return b.valuation - a.valuation;
}

export function aggregate(
  orders: OrderRow[],
  priceByIsin: Record<string, CurrentPrice>,
  today: Date = new Date(),
  fxByCurrency: Record<string, number> = {},
): Position[] {
  const { positions } = replayTransactions(orders, priceByIsin, today, fxByCurrency);
  return positions.map(activeToPosition).sort(byValuationDesc);
}

export function aggregateWithRealizations(
  orders: OrderRow[],
  priceByIsin: Record<string, CurrentPrice>,
  today: Date = new Date(),
  fxByCurrency: Record<string, number> = {},
): { positions: Position[]; realizations: PastRealization[] } {
  const { positions, realizations } = replayTransactions(
    orders,
    priceByIsin,
    today,
    fxByCurrency,
  );
  return {
    positions: positions.map(activeToPosition).sort(byValuationDesc),
    realizations,
  };
}

export type PortfolioTotals = {
  invested: number;
  valuation: number;
  pnl: number; // capital P&L (legacy)
  pnlTotal: number;
  pnlPct: number;
  pnlPctTotal: number;
  // pnlAnnualized = xirrCapital, kept for call-site compatibility.
  pnlAnnualized: number;
  xirrCapital: number;
  xirrTotal: number;
  xirrCapitalNetFees: number;
  xirrTotalNetFees: number;
  dividendsTotal: number;
  holdingFeesTotal: number;
  yearsHeld: number;
  totalFees: number;
  lines: number;
  // Signals which aggregation rule produced these totals. `"instruments"` is
  // the default (and the mixed case): cash is excluded from invested/P&L/XIRR.
  // `"cash"` is set when the user filters down to cash-only — KPIs then come
  // from the cash flows themselves (deposits, withdrawals, buys, sells,
  // dividends/interest routed to instruments).
  kpiMode: "instruments" | "cash";
};

export type RealizationTotals = {
  count: number;
  capitalRecovered: number;
  costBasis: number;
  pnlCapital: number;
  pnlTotal: number;
  xirrCapital: number;
  xirrTotal: number;
  xirrCapitalNetFees: number;
  xirrTotalNetFees: number;
};

type XirrKey =
  | "xirrCapital"
  | "xirrTotal"
  | "xirrCapitalNetFees"
  | "xirrTotalNetFees";

function weightedXirr(reals: PastRealization[], key: XirrKey): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const r of reals) {
    const rate = r[key];
    if (!Number.isFinite(rate)) continue;
    if (r.costBasis <= 0) continue;
    weighted += rate * r.costBasis;
    totalWeight += r.costBasis;
  }
  return totalWeight > 0 ? weighted / totalWeight : Number.NaN;
}

export function computeRealizationTotals(reals: PastRealization[]): RealizationTotals {
  let capitalRecovered = 0;
  let costBasis = 0;
  let pnlCapital = 0;
  let pnlTotal = 0;
  for (const r of reals) {
    capitalRecovered += r.saleNet;
    costBasis += r.costBasis;
    pnlCapital += r.pnlCapital;
    pnlTotal += r.pnlTotal;
  }
  return {
    count: reals.length,
    capitalRecovered,
    costBasis,
    pnlCapital,
    pnlTotal,
    xirrCapital: weightedXirr(reals, "xirrCapital"),
    xirrTotal: weightedXirr(reals, "xirrTotal"),
    xirrCapitalNetFees: weightedXirr(reals, "xirrCapitalNetFees"),
    xirrTotalNetFees: weightedXirr(reals, "xirrTotalNetFees"),
  };
}

export type MovementTotals = {
  count: number;
  totalBuys: number;
  totalSells: number;
  dividendsReceived: number;
  feesPaid: number;
  // Cash KPIs (in EUR via fxRate).
  depositsTotal: number;
  withdrawalsTotal: number;
  interestReceived: number;
  taxesPaid: number;
};

export function computeMovementTotals(orders: OrderRow[]): MovementTotals {
  let totalBuys = 0;
  let totalSells = 0;
  let dividendsReceived = 0;
  let feesPaid = 0;
  let depositsTotal = 0;
  let withdrawalsTotal = 0;
  let interestReceived = 0;
  let taxesPaid = 0;
  for (const o of orders) {
    const grossEur = grossAmountEur(o);
    const fEur = feesEur(o);
    if (o.kind === "buy") {
      totalBuys += grossEur;
      feesPaid += fEur;
    } else if (o.kind === "sell") {
      totalSells += grossEur;
      feesPaid += fEur;
    } else if (o.kind === "dividend") {
      dividendsReceived += grossEur;
    } else if (o.kind === "fee") {
      feesPaid += grossEur;
    } else if (o.kind === "deposit") {
      depositsTotal += grossEur;
    } else if (o.kind === "withdrawal") {
      withdrawalsTotal += grossEur;
    } else if (o.kind === "interest") {
      interestReceived += grossEur;
    } else if (o.kind === "tax") {
      taxesPaid += grossEur;
    }
  }
  return {
    count: orders.length,
    totalBuys,
    totalSells,
    dividendsReceived,
    feesPaid,
    depositsTotal,
    withdrawalsTotal,
    interestReceived,
    taxesPaid,
  };
}

export function computeTotals(positions: Position[], today: Date = new Date()): PortfolioTotals {
  // Cash-only view (e.g. user filters Type=Liquidités): the "instruments"
  // aggregation rule would zero out every KPI (invested = 0, no flows). Fall
  // back to a cash-flow-driven view so the row stays informative.
  const allCash =
    positions.length > 0 && positions.every((p) => p.assetClass === "cash");
  if (allCash) {
    let valuation = 0;
    let pnlSum = 0;
    let totalFees = 0;
    let holdingFeesTotal = 0;
    const flowsAll: Flow[] = [];
    for (const p of positions) {
      valuation += p.valuation;
      pnlSum += p.pnlTotal;
      totalFees += p.totalFees;
      holdingFeesTotal += p.holdingFees;
      if (p.cashFlowsCapital) for (const f of p.cashFlowsCapital) flowsAll.push(f);
    }
    const invested = valuation; // proxy of current balance — see note above
    const pnlPct = invested > 0 ? pnlSum / invested : 0;
    const xirrCash = xirr(flowsAll);
    return {
      invested,
      valuation,
      pnl: pnlSum,
      pnlTotal: pnlSum,
      pnlPct,
      pnlPctTotal: pnlPct,
      pnlAnnualized: Number.isFinite(xirrCash) ? xirrCash : 0,
      xirrCapital: xirrCash,
      xirrTotal: xirrCash,
      xirrCapitalNetFees: xirrCash,
      xirrTotalNetFees: xirrCash,
      dividendsTotal: 0,
      holdingFeesTotal,
      yearsHeld: 0,
      totalFees,
      lines: positions.length,
      kpiMode: "cash",
    };
  }

  // Cash positions count toward total valuation and the line count, but they
  // never feed performance KPIs — a deposit is not a P&L event, so it must
  // not dilute % returns, XIRR, or "invested capital".
  let invested = 0;
  let valuation = 0;
  let totalFees = 0;
  let dividendsTotal = 0;
  let holdingFeesTotal = 0;
  let weightedDateMs = 0;
  const cfCapital: Flow[] = [];
  const cfTotal: Flow[] = [];
  const cfCapitalNetFees: Flow[] = [];
  const cfTotalNetFees: Flow[] = [];

  for (const p of positions) {
    valuation += p.valuation;
    if (p.assetClass === "cash") continue;

    invested += p.invested;
    totalFees += p.totalFees;
    dividendsTotal += p.dividendsAttributed;
    holdingFeesTotal += p.holdingFees;
    weightedDateMs += p.meanDate.getTime() * p.invested;
    if (p.cashFlowsCapital) for (const f of p.cashFlowsCapital) cfCapital.push(f);
    if (p.cashFlowsTotal) for (const f of p.cashFlowsTotal) cfTotal.push(f);
    if (p.cashFlowsCapitalNetFees) {
      for (const f of p.cashFlowsCapitalNetFees) cfCapitalNetFees.push(f);
    }
    if (p.cashFlowsTotalNetFees) {
      for (const f of p.cashFlowsTotalNetFees) cfTotalNetFees.push(f);
    }
  }

  // P&L derived from instrument lines only (valuation here = sum of instrument
  // valuations, computed by subtracting cash valuation). Keeps % returns
  // anchored on invested capital, not on opening cash deposits.
  const cashValuation = positions
    .filter((p) => p.assetClass === "cash")
    .reduce((s, p) => s + p.valuation, 0);
  const instrumentValuation = valuation - cashValuation;

  const pnl = instrumentValuation - invested;
  const pnlTotal = instrumentValuation + dividendsTotal - invested;
  const pnlPct = invested > 0 ? pnl / invested : 0;
  const pnlPctTotal = invested > 0 ? pnlTotal / invested : 0;
  const meanDateMs = invested > 0 ? weightedDateMs / invested : today.getTime();
  const yearsHeld = Math.max(0.01, daysBetween(new Date(meanDateMs), today) / 365.25);
  const xirrCapital = xirr(cfCapital);
  const xirrTotal = xirr(cfTotal);
  const xirrCapitalNetFees = xirr(cfCapitalNetFees);
  const xirrTotalNetFees = xirr(cfTotalNetFees);

  return {
    invested,
    valuation,
    pnl,
    pnlTotal,
    pnlPct,
    pnlPctTotal,
    pnlAnnualized: Number.isFinite(xirrCapital) ? xirrCapital : 0,
    xirrCapital,
    xirrTotal,
    xirrCapitalNetFees,
    xirrTotalNetFees,
    dividendsTotal,
    holdingFeesTotal,
    yearsHeld,
    totalFees,
    lines: positions.length,
    kpiMode: "instruments",
  };
}
