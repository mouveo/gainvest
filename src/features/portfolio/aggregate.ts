// Aggregate raw orders (buy/sell transactions) into positions, with PRU,
// valuation, P&L and annualized return. Port of the standalone design's
// aggregate() function — same formula, same shape.
//
// Inputs are *already filtered* to the current user via RLS.

import { daysBetween, parseDate } from "./format";
import type { Support } from "./types";

export type OrderRow = {
  id: string;
  isin: string;
  instrumentName: string;
  assetClass: string;
  currency: string;
  kind: "buy" | "sell";
  tradeDate: string;
  tradeTime: string | null;
  quantity: number;
  price: number;
  grossAmount: number;
  fees: number;
  executionVenue: string | null;
  broker: string | null;
  support: Support;
};

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
  pnl: number;
  pnlPct: number;
  pnlAnnualized: number;
  meanDate: Date;
  daysHeld: number;
  yearsHeld: number;
  ordersCount: number;
  buyCount: number;
  sellCount: number;
  totalFees: number;
  orders: OrderRow[];
};

export function aggregate(
  orders: OrderRow[],
  priceByIsin: Record<string, number>,
  today: Date = new Date(),
): Position[] {
  const byKey = new Map<string, OrderRow[]>();
  for (const o of orders) {
    const key = `${o.isin}\x01${o.support}`;
    const arr = byKey.get(key);
    if (arr) arr.push(o);
    else byKey.set(key, [o]);
  }

  const positions: Position[] = [];

  for (const [key, ords] of byKey) {
    let qty = 0;
    let costBase = 0;
    let proceedsFromSell = 0;
    let weightedDateMs = 0;
    let weightSum = 0;
    let buyCount = 0;
    let sellCount = 0;
    let totalFees = 0;
    const first = ords[0]!;

    for (const o of ords) {
      const gross = o.quantity * o.price;
      if (o.kind === "buy") {
        qty += o.quantity;
        costBase += gross + (o.fees ?? 0);
        const ms = parseDate(o.tradeDate).getTime();
        weightedDateMs += ms * gross;
        weightSum += gross;
        buyCount += 1;
      } else {
        qty -= o.quantity;
        proceedsFromSell += gross - (o.fees ?? 0);
        sellCount += 1;
      }
      totalFees += o.fees ?? 0;
    }

    const pru = qty > 0 ? (costBase - proceedsFromSell) / qty : 0;
    const currentPrice = priceByIsin[first.isin] ?? 0;
    const valuation = qty * currentPrice;
    const invested = costBase - proceedsFromSell;
    const pnl = valuation - invested;
    const pnlPct = invested > 0 ? pnl / invested : 0;

    const meanDateMs = weightSum > 0 ? weightedDateMs / weightSum : today.getTime();
    const meanDate = new Date(meanDateMs);
    const days = Math.max(1, daysBetween(meanDate, today));
    const yearsHeld = days / 365.25;

    const pnlAnnualized = invested > 0 && pnlPct > -1 ? Math.pow(1 + pnlPct, 1 / yearsHeld) - 1 : 0;

    positions.push({
      key,
      isin: first.isin,
      support: first.support,
      instrumentName: first.instrumentName,
      assetClass: first.assetClass,
      currency: first.currency,
      qty,
      pru,
      currentPrice,
      valuation,
      invested,
      pnl,
      pnlPct,
      pnlAnnualized,
      meanDate,
      daysHeld: Math.round(days),
      yearsHeld,
      ordersCount: ords.length,
      buyCount,
      sellCount,
      totalFees,
      orders: ords.slice().sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)),
    });
  }

  return positions.sort((a, b) => b.valuation - a.valuation);
}

export type PortfolioTotals = {
  invested: number;
  valuation: number;
  pnl: number;
  pnlPct: number;
  pnlAnnualized: number;
  yearsHeld: number;
  totalFees: number;
  lines: number;
};

export function computeTotals(positions: Position[], today: Date = new Date()): PortfolioTotals {
  let invested = 0;
  let valuation = 0;
  let weightedDateMs = 0;
  let totalFees = 0;

  for (const p of positions) {
    invested += p.invested;
    valuation += p.valuation;
    weightedDateMs += p.meanDate.getTime() * p.invested;
    totalFees += p.totalFees;
  }

  const pnl = valuation - invested;
  const pnlPct = invested > 0 ? pnl / invested : 0;
  const meanDateMs = invested > 0 ? weightedDateMs / invested : today.getTime();
  const yearsHeld = Math.max(0.01, daysBetween(new Date(meanDateMs), today) / 365.25);
  const pnlAnnualized = pnlPct > -1 ? Math.pow(1 + pnlPct, 1 / yearsHeld) - 1 : 0;

  return {
    invested,
    valuation,
    pnl,
    pnlPct,
    pnlAnnualized,
    yearsHeld,
    totalFees,
    lines: positions.length,
  };
}
