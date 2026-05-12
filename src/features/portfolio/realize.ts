// Chronological replay of buy/sell/dividend events per (isin, support) line.
//
// Dividends and buy cash-flows are kept on each line as "active flows" until
// a sell consumes a prorata share of them — proportional to qty sold over qty
// held just before the sale. This is the CUMP fongible attribution: the
// remaining lot keeps the unsold prorata of past dividends and buy flows, so
// two successive sells never reuse the same flow.

import type { OrderRow, TradableOrder } from "./aggregate";
import type { Support } from "./types";
import { xirr, type Flow } from "./xirr";

export type ActivePosition = {
  key: string;
  isin: string;
  support: Support;
  instrumentName: string;
  assetClass: string;
  currency: string;
  qty: number;
  pru: number;
  invested: number;
  currentPrice: number;
  valuation: number;
  totalCost: number;
  dividendsAttributed: number;
  totalFees: number;
  pnlCapital: number;
  pnlTotal: number;
  pnlPctCapital: number;
  pnlPctTotal: number;
  xirrCapital: number;
  xirrTotal: number;
  cashFlowsCapital: Flow[];
  cashFlowsTotal: Flow[];
  firstBuyDate: Date;
  daysHeld: number;
  yearsHeld: number;
  ordersCount: number;
  buyCount: number;
  sellCount: number;
  orders: TradableOrder[];
};

export type PastRealization = {
  key: string;
  isin: string;
  support: Support;
  instrumentName: string;
  currency: string;
  saleDate: string;
  saleQty: number;
  saleNet: number;
  costBasis: number;
  pruAtSale: number;
  dividendsAttributed: number;
  pnlCapital: number;
  pnlTotal: number;
  xirrCapital: number;
  xirrTotal: number;
};

export type ReplayResult = {
  positions: ActivePosition[];
  realizations: PastRealization[];
};

const KIND_ORDER: Record<OrderRow["kind"], number> = {
  buy: 0,
  dividend: 1,
  sell: 2,
  fee: 3,
};

function compareOrders(a: OrderRow, b: OrderRow): number {
  if (a.tradeDate !== b.tradeDate) return a.tradeDate < b.tradeDate ? -1 : 1;
  const at = a.tradeTime ?? "00:00:00";
  const bt = b.tradeTime ?? "00:00:00";
  if (at !== bt) return at < bt ? -1 : 1;
  const ak = KIND_ORDER[a.kind];
  const bk = KIND_ORDER[b.kind];
  if (ak !== bk) return ak - bk;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function splitFlows(flows: Flow[], ratio: number): { consumed: Flow[]; remaining: Flow[] } {
  const consumed: Flow[] = new Array(flows.length);
  const remaining: Flow[] = new Array(flows.length);
  const inv = 1 - ratio;
  for (let i = 0; i < flows.length; i++) {
    const f = flows[i]!;
    consumed[i] = { date: f.date, amount: f.amount * ratio };
    remaining[i] = { date: f.date, amount: f.amount * inv };
  }
  return { consumed, remaining };
}

function sumFlows(flows: Flow[]): number {
  let s = 0;
  for (const f of flows) s += f.amount;
  return s;
}

function toISODate(d: Date): string {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

type LineState = {
  key: string;
  isin: string;
  support: Support;
  instrumentName: string;
  assetClass: string;
  currency: string;
  qty: number;
  totalCost: number;
  divPerShareCumul: number;
  divPerShareEntryAvg: number;
  activeBuyFlows: Flow[];
  activeDividendFlows: Flow[];
  totalFees: number;
  buyCount: number;
  sellCount: number;
  ordersTouched: TradableOrder[];
  firstBuyDate: string | null;
  realizations: PastRealization[];
};

function lineKey(isin: string, support: Support): string {
  return `${isin}\x01${support}`;
}

export function replayTransactions(
  orders: OrderRow[],
  priceByIsin: Record<string, number>,
  today: Date = new Date(),
): ReplayResult {
  const sorted = orders.slice().sort(compareOrders);
  const lines = new Map<string, LineState>();

  function ensureLine(o: OrderRow): LineState {
    const key = lineKey(o.isin, o.support);
    let line = lines.get(key);
    if (!line) {
      line = {
        key,
        isin: o.isin,
        support: o.support,
        instrumentName: o.instrumentName,
        assetClass: o.assetClass,
        currency: o.currency,
        qty: 0,
        totalCost: 0,
        divPerShareCumul: 0,
        divPerShareEntryAvg: 0,
        activeBuyFlows: [],
        activeDividendFlows: [],
        totalFees: 0,
        buyCount: 0,
        sellCount: 0,
        ordersTouched: [],
        firstBuyDate: null,
        realizations: [],
      };
      lines.set(key, line);
    }
    return line;
  }

  const realizations: PastRealization[] = [];

  for (const o of sorted) {
    if (o.kind === "buy") {
      if (o.quantity == null || o.quantity <= 0 || o.price == null) continue;
      const line = ensureLine(o);
      const qtyBefore = line.qty;
      const qtyAdded = o.quantity;
      const cost = o.grossAmount + (o.fees ?? 0);
      const newQty = qtyBefore + qtyAdded;
      line.divPerShareEntryAvg =
        newQty > 0
          ? (line.divPerShareEntryAvg * qtyBefore + line.divPerShareCumul * qtyAdded) / newQty
          : line.divPerShareEntryAvg;
      line.totalCost += cost;
      line.qty = newQty;
      line.activeBuyFlows.push({ date: o.tradeDate, amount: -cost });
      line.totalFees += o.fees ?? 0;
      line.buyCount += 1;
      line.ordersTouched.push(o as TradableOrder);
      if (line.firstBuyDate === null || o.tradeDate < line.firstBuyDate) {
        line.firstBuyDate = o.tradeDate;
      }
      continue;
    }

    if (o.kind === "dividend") {
      if (o.grossAmount <= 0) continue;
      const line = ensureLine(o);
      if (line.qty > 0) line.divPerShareCumul += o.grossAmount / line.qty;
      line.activeDividendFlows.push({ date: o.tradeDate, amount: o.grossAmount });
      continue;
    }

    if (o.kind === "sell") {
      if (o.quantity == null || o.quantity <= 0 || o.price == null) continue;
      const line = lines.get(lineKey(o.isin, o.support));
      if (!line || line.qty <= 0) continue;

      const qtyBefore = line.qty;
      const cappedQty = Math.min(o.quantity, qtyBefore);
      const ratio = cappedQty / qtyBefore;
      const pruAtSale = line.totalCost / qtyBefore;
      const costBasis = cappedQty * pruAtSale;
      const saleNet = o.grossAmount - (o.fees ?? 0);

      const buySplit = splitFlows(line.activeBuyFlows, ratio);
      const divSplit = splitFlows(line.activeDividendFlows, ratio);
      const dividendsAttributed = sumFlows(divSplit.consumed);

      const cashFlowsCapital: Flow[] = [
        ...buySplit.consumed,
        { date: o.tradeDate, amount: saleNet },
      ];
      const cashFlowsTotal: Flow[] = [
        ...buySplit.consumed,
        ...divSplit.consumed,
        { date: o.tradeDate, amount: saleNet },
      ];

      const pnlCapital = saleNet - costBasis;
      const pnlTotal = saleNet + dividendsAttributed - costBasis;

      const realization: PastRealization = {
        key: line.key,
        isin: line.isin,
        support: line.support,
        instrumentName: line.instrumentName,
        currency: line.currency,
        saleDate: o.tradeDate,
        saleQty: cappedQty,
        saleNet,
        costBasis,
        pruAtSale,
        dividendsAttributed,
        pnlCapital,
        pnlTotal,
        xirrCapital: xirr(cashFlowsCapital),
        xirrTotal: xirr(cashFlowsTotal),
      };
      realizations.push(realization);
      line.realizations.push(realization);

      // CUMP: trim cost and qty by the prorata; PRU on the remaining lot is unchanged.
      line.totalCost -= costBasis;
      line.qty -= cappedQty;
      line.activeBuyFlows = buySplit.remaining;
      line.activeDividendFlows = divSplit.remaining;
      line.totalFees += o.fees ?? 0;
      line.sellCount += 1;
      line.ordersTouched.push(o as TradableOrder);
      continue;
    }

    // kind === "fee": standalone fee rows are not attributed to a position.
  }

  const todayStr = toISODate(today);
  const positions: ActivePosition[] = [];

  for (const line of lines.values()) {
    // Orphan dividends (no buy ever happened) do not create a position.
    if (line.firstBuyDate === null) continue;
    if (line.qty <= 0) continue;

    const currentPrice = priceByIsin[line.isin] ?? 0;
    const pru = line.totalCost / line.qty;
    const invested = line.qty * pru;
    const valuation = line.qty * currentPrice;
    const dividendsAttributed = sumFlows(line.activeDividendFlows);

    const cashFlowsCapital: Flow[] = [
      ...line.activeBuyFlows,
      { date: todayStr, amount: valuation },
    ];
    const cashFlowsTotal: Flow[] = [
      ...line.activeBuyFlows,
      ...line.activeDividendFlows,
      { date: todayStr, amount: valuation },
    ];

    const pnlCapital = valuation - invested;
    const pnlTotal = valuation + dividendsAttributed - invested;
    const pnlPctCapital = invested > 0 ? pnlCapital / invested : 0;
    const pnlPctTotal = invested > 0 ? pnlTotal / invested : 0;

    const firstBuyDate = new Date(`${line.firstBuyDate}T00:00:00`);
    const days = Math.max(1, (today.getTime() - firstBuyDate.getTime()) / 86_400_000);
    const yearsHeld = days / 365.25;

    positions.push({
      key: line.key,
      isin: line.isin,
      support: line.support,
      instrumentName: line.instrumentName,
      assetClass: line.assetClass,
      currency: line.currency,
      qty: line.qty,
      pru,
      invested,
      currentPrice,
      valuation,
      totalCost: line.totalCost,
      dividendsAttributed,
      totalFees: line.totalFees,
      pnlCapital,
      pnlTotal,
      pnlPctCapital,
      pnlPctTotal,
      xirrCapital: xirr(cashFlowsCapital),
      xirrTotal: xirr(cashFlowsTotal),
      cashFlowsCapital,
      cashFlowsTotal,
      firstBuyDate,
      daysHeld: Math.round(days),
      yearsHeld,
      ordersCount: line.ordersTouched.length,
      buyCount: line.buyCount,
      sellCount: line.sellCount,
      orders: line.ordersTouched.slice().sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)),
    });
  }

  return { positions, realizations };
}
