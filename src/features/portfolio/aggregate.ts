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

export type OrderRow = {
  id: string;
  isin: string;
  instrumentId: string | null;
  preferredMic: string | null;
  preferredCurrency: string | null;
  // For dividend/fee rows without an instrument, this can carry the description
  // ("Droits de garde 2022 T3" etc.) — see queries.ts.
  instrumentName: string;
  // "cash" is used as a fallback for fee rows without an instrument.
  assetClass: string;
  currency: string;
  kind: "buy" | "sell" | "dividend" | "fee";
  tradeDate: string;
  tradeTime: string | null;
  quantity: number | null;
  price: number | null;
  grossAmount: number;
  fees: number;
  // Free-text description preserved from the broker row. Used to detect
  // holding-fee subtypes ("Droits de garde", "Frais de conservation").
  notes: string | null;
  executionVenue: string | null;
  broker: string | null;
  support: Support;
};

export type TradableOrder = OrderRow & { quantity: number; price: number };

export type Position = {
  key: string;
  isin: string;
  instrumentId: string | null;
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
};

function activeToPosition(p: ActivePosition): Position {
  return {
    key: p.key,
    isin: p.isin,
    instrumentId: p.instrumentId,
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
    xirrCapital: p.xirrCapital,
    xirrTotal: p.xirrTotal,
    cashFlowsCapital: p.cashFlowsCapital,
    cashFlowsTotal: p.cashFlowsTotal,
    holdingFees: p.holdingFeesAttributed,
    cashFlowsCapitalNetFees: p.cashFlowsCapitalNetFees,
    cashFlowsTotalNetFees: p.cashFlowsTotalNetFees,
    xirrCapitalNetFees: p.xirrCapitalNetFees,
    xirrTotalNetFees: p.xirrTotalNetFees,
  };
}

function byValuationDesc(a: Position, b: Position): number {
  return b.valuation - a.valuation;
}

export function aggregate(
  orders: OrderRow[],
  priceByIsin: Record<string, number>,
  today: Date = new Date(),
): Position[] {
  const { positions } = replayTransactions(orders, priceByIsin, today);
  return positions.map(activeToPosition).sort(byValuationDesc);
}

export function aggregateWithRealizations(
  orders: OrderRow[],
  priceByIsin: Record<string, number>,
  today: Date = new Date(),
): { positions: Position[]; realizations: PastRealization[] } {
  const { positions, realizations } = replayTransactions(orders, priceByIsin, today);
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
};

export function computeMovementTotals(orders: OrderRow[]): MovementTotals {
  let totalBuys = 0;
  let totalSells = 0;
  let dividendsReceived = 0;
  let feesPaid = 0;
  for (const o of orders) {
    if (o.kind === "buy") {
      totalBuys += o.grossAmount;
      feesPaid += o.fees;
    } else if (o.kind === "sell") {
      totalSells += o.grossAmount;
      feesPaid += o.fees;
    } else if (o.kind === "dividend") {
      dividendsReceived += o.grossAmount;
    } else if (o.kind === "fee") {
      feesPaid += o.grossAmount;
    }
  }
  return {
    count: orders.length,
    totalBuys,
    totalSells,
    dividendsReceived,
    feesPaid,
  };
}

export function computeTotals(positions: Position[], today: Date = new Date()): PortfolioTotals {
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
    invested += p.invested;
    valuation += p.valuation;
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

  const pnl = valuation - invested;
  const pnlTotal = valuation + dividendsTotal - invested;
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
  };
}
