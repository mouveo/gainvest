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
  executionVenue: string | null;
  broker: string | null;
  support: Support;
};

export type TradableOrder = OrderRow & { quantity: number; price: number };

export type Position = {
  key: string;
  isin: string;
  support: Support;
  instrumentName: string;
  assetClass: string;
  currency: string;
  qty: number;
  pru: number;
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
};

function activeToPosition(p: ActivePosition): Position {
  return {
    key: p.key,
    isin: p.isin,
    support: p.support,
    instrumentName: p.instrumentName,
    assetClass: p.assetClass,
    currency: p.currency,
    qty: p.qty,
    pru: p.pru,
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
  dividendsTotal: number;
  yearsHeld: number;
  totalFees: number;
  lines: number;
};

export function computeTotals(positions: Position[], today: Date = new Date()): PortfolioTotals {
  let invested = 0;
  let valuation = 0;
  let totalFees = 0;
  let dividendsTotal = 0;
  let weightedDateMs = 0;
  const cfCapital: Flow[] = [];
  const cfTotal: Flow[] = [];

  for (const p of positions) {
    invested += p.invested;
    valuation += p.valuation;
    totalFees += p.totalFees;
    dividendsTotal += p.dividendsAttributed;
    weightedDateMs += p.meanDate.getTime() * p.invested;
    if (p.cashFlowsCapital) for (const f of p.cashFlowsCapital) cfCapital.push(f);
    if (p.cashFlowsTotal) for (const f of p.cashFlowsTotal) cfTotal.push(f);
  }

  const pnl = valuation - invested;
  const pnlTotal = valuation + dividendsTotal - invested;
  const pnlPct = invested > 0 ? pnl / invested : 0;
  const pnlPctTotal = invested > 0 ? pnlTotal / invested : 0;
  const meanDateMs = invested > 0 ? weightedDateMs / invested : today.getTime();
  const yearsHeld = Math.max(0.01, daysBetween(new Date(meanDateMs), today) / 365.25);
  const xirrCapital = xirr(cfCapital);
  const xirrTotal = xirr(cfTotal);

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
    dividendsTotal,
    yearsHeld,
    totalFees,
    lines: positions.length,
  };
}
