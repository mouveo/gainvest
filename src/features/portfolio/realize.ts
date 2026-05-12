// Chronological replay of buy/sell/dividend events per (isin, support) line.
//
// Dividends and buy cash-flows are kept on each line as "active flows" until
// a sell consumes a prorata share of them — proportional to qty sold over qty
// held just before the sale. This is the CUMP fongible attribution: the
// remaining lot keeps the unsold prorata of past dividends and buy flows, so
// two successive sells never reuse the same flow.

import type { OrderRow, TradableOrder } from "./aggregate";
import { feesEur, grossAmountEur } from "./aggregate";
import { isForeignIsin, isHoldingFee } from "./holding-fees";
import type { Support } from "./types";
import { xirr, type Flow } from "./xirr";

export type ActivePosition = {
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
  invested: number;
  // Pédagogique : PRU "brut" (hors frais capitalisés). Comparer au cours
  // sans biais lié aux frais.
  pruGross: number;
  investedGross: number;
  pnlCapitalGross: number;
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
  holdingFeesAttributed: number;
  cashFlowsCapitalNetFees: Flow[];
  cashFlowsTotalNetFees: Flow[];
  xirrCapitalNetFees: number;
  xirrTotalNetFees: number;
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
  broker: string | null;
  instrumentName: string;
  assetClass: string;
  currency: string;
  saleDate: string;
  saleQty: number;
  saleNet: number;
  costBasis: number;
  pruAtSale: number;
  dividendsAttributed: number;
  holdingFeesAttributed: number;
  pnlCapital: number;
  pnlTotal: number;
  xirrCapital: number;
  xirrTotal: number;
  xirrCapitalNetFees: number;
  xirrTotalNetFees: number;
};

export type ReplayResult = {
  positions: ActivePosition[];
  realizations: PastRealization[];
};

const KIND_ORDER: Record<OrderRow["kind"], number> = {
  deposit: 0,
  buy: 1,
  dividend: 2,
  interest: 3,
  sell: 4,
  withdrawal: 5,
  fee: 6,
  tax: 7,
};

function brokerSlug(broker: string | null): string {
  if (!broker) return "noBroker";
  return broker.replace(/\s+/g, "").replace(/[^a-zA-Z0-9-]/g, "").toUpperCase();
}

function cashIsin(currency: string, broker: string | null): string {
  return `CASH-${currency.toUpperCase()}-${brokerSlug(broker)}`;
}

function cashKey(support: Support, broker: string | null, currency: string): string {
  return `cash\x01${support}\x01${broker ?? ""}\x01${currency.toUpperCase()}`;
}

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
  instrumentId: string | null;
  preferredMic: string | null;
  preferredCurrency: string | null;
  support: Support;
  broker: string | null;
  instrumentName: string;
  assetClass: string;
  currency: string;
  qty: number;
  totalCost: number;
  // Gross cost = Σ qty × price (excludes fees). Trimmed proportionally on
  // sells, just like totalCost. Surfaces a "PRU brut" view.
  totalCostGross: number;
  divPerShareCumul: number;
  divPerShareEntryAvg: number;
  activeBuyFlows: Flow[];
  activeDividendFlows: Flow[];
  activeHoldingFeeFlows: Flow[];
  holdingFeesActive: number;
  totalFees: number;
  buyCount: number;
  sellCount: number;
  ordersTouched: TradableOrder[];
  firstBuyDate: string | null;
  realizations: PastRealization[];
};

function lineKey(isin: string, support: Support, broker: string | null): string {
  return `${isin}\x01${support}\x01${broker ?? ""}`;
}

type CashState = {
  key: string;
  support: Support;
  broker: string | null;
  currency: string;
  balance: number; // native currency
  // Net flows kept in EUR (historical via per-row fxRate). Used to surface
  // pnlTotal on the cash position (interest received minus fees & taxes).
  interestReceivedEur: number;
  feesPaidEur: number;
  taxPaidEur: number;
  flowsCount: number;
  firstFlowDate: string | null;
  // Emit a cash position only once the user has explicitly recorded a cash
  // transfer (deposit/withdrawal). Buy/sell/dividend/fee on their own keep
  // running through the balance accumulator but don't surface a position —
  // this matches the V0 product expectation that cash tracking starts when
  // the user provides an initial balance.
  hasExplicitTransfer: boolean;
};

export function replayTransactions(
  orders: OrderRow[],
  priceByIsin: Record<string, number>,
  today: Date = new Date(),
  fxByCurrency: Record<string, number> = {},
): ReplayResult {
  const sorted = orders.slice().sort(compareOrders);
  const lines = new Map<string, LineState>();
  const cash = new Map<string, CashState>();

  function ensureCash(o: OrderRow): CashState {
    const ccy = (o.currency ?? "EUR").toUpperCase();
    const broker = o.broker ?? null;
    const key = cashKey(o.support, broker, ccy);
    let state = cash.get(key);
    if (!state) {
      state = {
        key,
        support: o.support,
        broker,
        currency: ccy,
        balance: 0,
        interestReceivedEur: 0,
        feesPaidEur: 0,
        taxPaidEur: 0,
        flowsCount: 0,
        firstFlowDate: null,
        hasExplicitTransfer: false,
      };
      cash.set(key, state);
    }
    return state;
  }

  function applyCash(o: OrderRow, deltaNative: number): void {
    const state = ensureCash(o);
    state.balance += deltaNative;
    state.flowsCount += 1;
    if (state.firstFlowDate === null || o.tradeDate < state.firstFlowDate) {
      state.firstFlowDate = o.tradeDate;
    }
  }

  function ensureLine(o: OrderRow): LineState {
    const broker = o.broker ?? null;
    const key = lineKey(o.isin, o.support, broker);
    let line = lines.get(key);
    if (!line) {
      line = {
        key,
        isin: o.isin,
        instrumentId: o.instrumentId,
        preferredMic: o.preferredMic,
        preferredCurrency: o.preferredCurrency,
        support: o.support,
        broker,
        instrumentName: o.instrumentName,
        assetClass: o.assetClass,
        currency: o.currency,
        qty: 0,
        totalCost: 0,
        totalCostGross: 0,
        divPerShareCumul: 0,
        divPerShareEntryAvg: 0,
        activeBuyFlows: [],
        activeDividendFlows: [],
        activeHoldingFeeFlows: [],
        holdingFeesActive: 0,
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
      const grossEurVal = grossAmountEur(o);
      const feesEurVal = feesEur(o);
      const cost = grossEurVal + feesEurVal;
      // Gross leg without fees, expressed in EUR.
      const grossLeg = grossEurVal;
      const newQty = qtyBefore + qtyAdded;
      line.divPerShareEntryAvg =
        newQty > 0
          ? (line.divPerShareEntryAvg * qtyBefore + line.divPerShareCumul * qtyAdded) / newQty
          : line.divPerShareEntryAvg;
      line.totalCost += cost;
      line.totalCostGross += grossLeg;
      line.qty = newQty;
      line.activeBuyFlows.push({ date: o.tradeDate, amount: -cost });
      line.totalFees += feesEurVal;
      line.buyCount += 1;
      line.ordersTouched.push(o as TradableOrder);
      if (line.firstBuyDate === null || o.tradeDate < line.firstBuyDate) {
        line.firstBuyDate = o.tradeDate;
      }
      // Cash impact: native currency, fees included.
      applyCash(o, -(o.grossAmount + (o.fees ?? 0)));
      continue;
    }

    if (o.kind === "dividend" || o.kind === "interest") {
      if (o.grossAmount <= 0) continue;
      const grossEurVal = grossAmountEur(o);
      const orderBroker = o.broker ?? null;
      // Cash impact first — happens regardless of ISIN attribution.
      applyCash(o, o.grossAmount);
      const cashState = ensureCash(o);

      // Interest WITHOUT ISIN: pure cash event, accumulate the cash KPI and
      // do NOT attribute to any instrument.
      if (o.kind === "interest" && !o.isin) {
        cashState.interestReceivedEur += grossEurVal;
        continue;
      }
      // Dividend or interest WITH ISIN: attribute to the matching instrument
      // line(s). For interest with ISIN we explicitly do NOT increment the
      // cash KPI to avoid double-counting (cash received once, instrument
      // income once — same flow).
      if (orderBroker !== null) {
        const line = lines.get(lineKey(o.isin, o.support, orderBroker));
        if (!line || line.qty <= 0) continue;
        line.divPerShareCumul += grossEurVal / line.qty;
        line.activeDividendFlows.push({ date: o.tradeDate, amount: grossEurVal });
        continue;
      }
      // Legacy dividend/interest with no broker: split across existing lines
      // with the same (isin, support) and qty > 0, prorata of qty. Never
      // create a new line for an orphan flow.
      const candidates: LineState[] = [];
      let totalQty = 0;
      for (const candidate of lines.values()) {
        if (candidate.isin !== o.isin) continue;
        if (candidate.support !== o.support) continue;
        if (candidate.qty <= 0) continue;
        candidates.push(candidate);
        totalQty += candidate.qty;
      }
      if (candidates.length === 0 || totalQty <= 0) continue;
      for (const candidate of candidates) {
        const share = (candidate.qty / totalQty) * grossEurVal;
        candidate.divPerShareCumul += share / candidate.qty;
        candidate.activeDividendFlows.push({ date: o.tradeDate, amount: share });
      }
      continue;
    }

    if (o.kind === "deposit") {
      applyCash(o, o.grossAmount);
      ensureCash(o).hasExplicitTransfer = true;
      continue;
    }
    if (o.kind === "withdrawal") {
      applyCash(o, -o.grossAmount);
      ensureCash(o).hasExplicitTransfer = true;
      continue;
    }
    if (o.kind === "tax") {
      applyCash(o, -o.grossAmount);
      ensureCash(o).taxPaidEur += grossAmountEur(o);
      continue;
    }

    if (o.kind === "sell") {
      if (o.quantity == null || o.quantity <= 0 || o.price == null) continue;
      // Cash impact, regardless of whether the instrument line was found.
      applyCash(o, o.grossAmount - (o.fees ?? 0));

      const line = lines.get(lineKey(o.isin, o.support, o.broker ?? null));
      if (!line || line.qty <= 0) continue;

      const qtyBefore = line.qty;
      const cappedQty = Math.min(o.quantity, qtyBefore);
      const ratio = cappedQty / qtyBefore;
      const pruAtSale = line.totalCost / qtyBefore;
      const costBasis = cappedQty * pruAtSale;
      const grossEurVal = grossAmountEur(o);
      const feesEurVal = feesEur(o);
      const saleNet = grossEurVal - feesEurVal;

      const buySplit = splitFlows(line.activeBuyFlows, ratio);
      const divSplit = splitFlows(line.activeDividendFlows, ratio);
      const feeSplit = splitFlows(line.activeHoldingFeeFlows, ratio);
      const dividendsAttributed = sumFlows(divSplit.consumed);
      // Holding-fee flows are stored as negative amounts, so the attributed
      // (positive) amount is the negation of their sum.
      const holdingFeesAttributed = -sumFlows(feeSplit.consumed);

      const cashFlowsCapital: Flow[] = [
        ...buySplit.consumed,
        { date: o.tradeDate, amount: saleNet },
      ];
      const cashFlowsTotal: Flow[] = [
        ...buySplit.consumed,
        ...divSplit.consumed,
        { date: o.tradeDate, amount: saleNet },
      ];
      const cashFlowsCapitalNetFees: Flow[] = [
        ...buySplit.consumed,
        ...feeSplit.consumed,
        { date: o.tradeDate, amount: saleNet },
      ];
      const cashFlowsTotalNetFees: Flow[] = [
        ...buySplit.consumed,
        ...divSplit.consumed,
        ...feeSplit.consumed,
        { date: o.tradeDate, amount: saleNet },
      ];

      // pnlCapital / pnlTotal remain the gross (fiscal) view — holding fees
      // never alter PRU, totalCost, or the realized capital P&L. They are
      // only surfaced through the *NetFees XIRR variants.
      const pnlCapital = saleNet - costBasis;
      const pnlTotal = saleNet + dividendsAttributed - costBasis;

      const realization: PastRealization = {
        key: line.key,
        isin: line.isin,
        support: line.support,
        broker: line.broker,
        instrumentName: line.instrumentName,
        assetClass: line.assetClass,
        currency: line.currency,
        saleDate: o.tradeDate,
        saleQty: cappedQty,
        saleNet,
        costBasis,
        pruAtSale,
        dividendsAttributed,
        holdingFeesAttributed,
        pnlCapital,
        pnlTotal,
        xirrCapital: xirr(cashFlowsCapital),
        xirrTotal: xirr(cashFlowsTotal),
        xirrCapitalNetFees: xirr(cashFlowsCapitalNetFees),
        xirrTotalNetFees: xirr(cashFlowsTotalNetFees),
      };
      realizations.push(realization);
      line.realizations.push(realization);

      // CUMP: trim cost and qty by the prorata; PRU on the remaining lot is unchanged.
      const costBasisGross = qtyBefore > 0 ? (line.totalCostGross / qtyBefore) * cappedQty : 0;
      line.totalCost -= costBasis;
      line.totalCostGross -= costBasisGross;
      line.qty -= cappedQty;
      line.activeBuyFlows = buySplit.remaining;
      line.activeDividendFlows = divSplit.remaining;
      line.activeHoldingFeeFlows = feeSplit.remaining;
      line.holdingFeesActive -= holdingFeesAttributed;
      line.totalFees += feesEurVal;
      line.sellCount += 1;
      line.ordersTouched.push(o as TradableOrder);
      continue;
    }

    if (o.kind === "fee") {
      // Cash impact for every fee row (custody fees AND broker/transaction
      // fees that don't match the "Droits de garde" pattern).
      applyCash(o, -o.grossAmount);

      // Custody-fee row ("droits de garde") is split across active foreign
      // positions in proportion to their totalCost. KIND_ORDER places fees
      // AFTER buys/dividends/sells of the same day, so the snapshot of
      // eligible lines reflects every same-day buy and the remaining qty
      // after every same-day sell. Fees that don't match the holding-fee
      // pattern stay as a cash KPI only (no instrument attribution).
      if (!isHoldingFee(o.notes)) {
        if (!o.isin) ensureCash(o).feesPaidEur += grossAmountEur(o);
        continue;
      }
      const totalFee = grossAmountEur(o);
      if (totalFee <= 0) continue;

      const feeBroker = o.broker ?? null;
      const eligible: LineState[] = [];
      let totalInvested = 0;
      for (const candidate of lines.values()) {
        if (candidate.qty <= 0) continue;
        if (!isForeignIsin(candidate.isin)) continue;
        if (candidate.totalCost <= 0) continue;
        if (feeBroker !== null && candidate.broker !== feeBroker) continue;
        eligible.push(candidate);
        totalInvested += candidate.totalCost;
      }
      if (eligible.length === 0 || totalInvested <= 0) continue;

      for (const candidate of eligible) {
        const share = (candidate.totalCost / totalInvested) * totalFee;
        candidate.holdingFeesActive += share;
        candidate.activeHoldingFeeFlows.push({
          date: o.tradeDate,
          amount: -share,
        });
      }
      continue;
    }
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
    const pruGross = line.totalCostGross / line.qty;
    const investedGross = line.qty * pruGross;
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
    const cashFlowsCapitalNetFees: Flow[] = [
      ...line.activeBuyFlows,
      ...line.activeHoldingFeeFlows,
      { date: todayStr, amount: valuation },
    ];
    const cashFlowsTotalNetFees: Flow[] = [
      ...line.activeBuyFlows,
      ...line.activeDividendFlows,
      ...line.activeHoldingFeeFlows,
      { date: todayStr, amount: valuation },
    ];

    const pnlCapital = valuation - invested;
    const pnlCapitalGross = valuation - investedGross;
    const pnlTotal = valuation + dividendsAttributed - invested;
    const pnlPctCapital = invested > 0 ? pnlCapital / invested : 0;
    const pnlPctTotal = invested > 0 ? pnlTotal / invested : 0;

    const firstBuyDate = new Date(`${line.firstBuyDate}T00:00:00`);
    const days = Math.max(1, (today.getTime() - firstBuyDate.getTime()) / 86_400_000);
    const yearsHeld = days / 365.25;

    positions.push({
      key: line.key,
      isin: line.isin,
      instrumentId: line.instrumentId,
      preferredMic: line.preferredMic,
      preferredCurrency: line.preferredCurrency,
      support: line.support,
      broker: line.broker,
      instrumentName: line.instrumentName,
      assetClass: line.assetClass,
      currency: line.currency,
      qty: line.qty,
      pru,
      invested,
      pruGross,
      investedGross,
      pnlCapitalGross,
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
      holdingFeesAttributed: line.holdingFeesActive,
      cashFlowsCapitalNetFees,
      cashFlowsTotalNetFees,
      xirrCapitalNetFees: xirr(cashFlowsCapitalNetFees),
      xirrTotalNetFees: xirr(cashFlowsTotalNetFees),
      firstBuyDate,
      daysHeld: Math.round(days),
      yearsHeld,
      ordersCount: line.ordersTouched.length,
      buyCount: line.buyCount,
      sellCount: line.sellCount,
      orders: line.ordersTouched.slice().sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)),
    });
  }

  // Cash positions — one per (support, broker, currency) where the user has
  // explicitly recorded a transfer. Native balance × current FX = EUR
  // valuation; pnlTotal surfaces the cash-only net flows (interest minus fees
  // & taxes that did not land on an instrument).
  for (const state of cash.values()) {
    if (!state.hasExplicitTransfer) continue;
    const fxToEur = fxByCurrency[state.currency] ?? (state.currency === "EUR" ? 1 : 1);
    const valuationEur = state.balance * fxToEur;
    const pnlTotalCash =
      state.interestReceivedEur - state.feesPaidEur - state.taxPaidEur;
    const firstDateStr = state.firstFlowDate ?? todayStr;
    const firstDate = new Date(`${firstDateStr}T00:00:00`);
    const days = Math.max(1, (today.getTime() - firstDate.getTime()) / 86_400_000);

    positions.push({
      key: state.key,
      isin: cashIsin(state.currency, state.broker),
      instrumentId: null,
      preferredMic: null,
      preferredCurrency: state.currency,
      support: state.support,
      broker: state.broker,
      instrumentName: `Cash ${state.currency}${state.broker ? ` (${state.broker})` : ""}`,
      assetClass: "cash",
      currency: state.currency,
      qty: state.balance,
      pru: 1,
      invested: valuationEur,
      pruGross: 1,
      investedGross: valuationEur,
      pnlCapitalGross: 0,
      currentPrice: fxToEur,
      valuation: valuationEur,
      totalCost: valuationEur,
      // For cash lines we surface the interest received in the "Dividendes"
      // column — the two are conceptually the same passive income.
      dividendsAttributed: state.interestReceivedEur,
      totalFees: state.feesPaidEur,
      pnlCapital: 0,
      pnlTotal: pnlTotalCash,
      pnlPctCapital: 0,
      pnlPctTotal: 0,
      xirrCapital: Number.NaN,
      xirrTotal: Number.NaN,
      cashFlowsCapital: [],
      cashFlowsTotal: [],
      holdingFeesAttributed: 0,
      cashFlowsCapitalNetFees: [],
      cashFlowsTotalNetFees: [],
      xirrCapitalNetFees: Number.NaN,
      xirrTotalNetFees: Number.NaN,
      firstBuyDate: firstDate,
      daysHeld: Math.round(days),
      yearsHeld: days / 365.25,
      ordersCount: state.flowsCount,
      buyCount: 0,
      sellCount: 0,
      orders: [],
    });
  }

  return { positions, realizations };
}
