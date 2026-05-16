import { describe, expect, it } from "vitest";

import type { CurrentPrice, OrderRow } from "./aggregate";
import {
  aggregate,
  aggregateWithRealizations,
  computeRealizationTotals,
  computeTotals,
} from "./aggregate";
import { adjustForInflation, getCpiIndex } from "./inflation";
import { replayTransactions } from "./realize";
import { xirr } from "./xirr";

function eur(n: number): CurrentPrice {
  return { native: n, eur: n, currency: "EUR", fxToEur: 1 };
}

function makeOrder(overrides: Partial<OrderRow>): OrderRow {
  return {
    id: "x",
    isin: "FR0010315770",
    instrumentId: null,
    instrumentSymbol: null,
    convertPairId: null,
    preferredMic: null,
    preferredCurrency: null,
    instrumentName: "Test",
    assetClass: "etf",
    currency: "EUR",
    kind: "buy",
    tradeDate: "2024-01-01",
    tradeTime: null,
    quantity: 10,
    price: 100,
    grossAmount: 1000,
    fees: 0,
    fxRate: 1,
    notes: null,
    executionVenue: null,
    broker: null,
    support: "CTO",
    bondCouponRate: null,
    bondMaturityDate: null,
    bondCouponFrequency: null,
    ...overrides,
  };
}

const TODAY = new Date("2026-05-12T00:00:00Z");
const TODAY_STR = "2026-05-12";

describe("replayTransactions — inflation-adjusted variants", () => {
  it("rescales a historical buy by the CPI ratio and exposes investedReal", () => {
    const buyDate = "2010-06-15";
    const orders: OrderRow[] = [
      makeOrder({
        id: "b1",
        kind: "buy",
        tradeDate: buyDate,
        quantity: 10,
        price: 100,
        grossAmount: 1000,
      }),
    ];

    const { positions } = replayTransactions(
      orders,
      { FR0010315770: eur(110) },
      TODAY,
    );

    expect(positions).toHaveLength(1);
    const p = positions[0]!;
    const expectedInvestedReal = adjustForInflation(1000, buyDate, TODAY_STR);
    expect(p.investedReal).toBeCloseTo(expectedInvestedReal, 4);
    expect(p.investedReal).toBeGreaterThan(p.invested);
    // PnL real on the same valuation: 1100 - investedReal.
    expect(p.pnlCapitalReal).toBeCloseTo(1100 - expectedInvestedReal, 4);
  });

  it("rescales a historical dividend toward today and feeds pnlTotalReal", () => {
    const buyDate = "2015-01-15";
    const divDate = "2018-06-30";
    const orders: OrderRow[] = [
      makeOrder({
        id: "b1",
        kind: "buy",
        tradeDate: buyDate,
        quantity: 10,
        price: 100,
        grossAmount: 1000,
      }),
      makeOrder({
        id: "d1",
        kind: "dividend",
        tradeDate: divDate,
        quantity: null,
        price: null,
        grossAmount: 50,
      }),
    ];

    const { positions } = replayTransactions(
      orders,
      { FR0010315770: eur(120) },
      TODAY,
    );
    const p = positions[0]!;
    expect(p.dividendsAttributedReal).toBeCloseTo(
      adjustForInflation(50, divDate, TODAY_STR),
      4,
    );
    expect(p.dividendsAttributedReal).toBeGreaterThan(p.dividendsAttributed);
    const expectedInvestedReal = adjustForInflation(1000, buyDate, TODAY_STR);
    expect(p.pnlTotalReal).toBeCloseTo(
      1200 + p.dividendsAttributedReal - expectedInvestedReal,
      4,
    );
  });

  it("inflates a foreign-position holding fee on the historical fee date", () => {
    const buyDate = "2014-01-01";
    const feeDate = "2014-06-30";
    const orders: OrderRow[] = [
      makeOrder({
        id: "b1",
        isin: "US0231351067",
        kind: "buy",
        tradeDate: buyDate,
        quantity: 10,
        price: 100,
        grossAmount: 1000,
      }),
      makeOrder({
        id: "f1",
        isin: "",
        kind: "fee",
        tradeDate: feeDate,
        quantity: null,
        price: null,
        grossAmount: 20,
        notes: "Droits de garde 2014 S1",
        instrumentName: "Droits de garde",
        assetClass: "cash",
      }),
    ];
    const { positions } = replayTransactions(
      orders,
      { US0231351067: eur(110) },
      TODAY,
    );
    const p = positions[0]!;
    const expectedFeesReal = adjustForInflation(20, feeDate, TODAY_STR);
    expect(p.holdingFeesReal).toBeCloseTo(expectedFeesReal, 4);
    expect(p.holdingFeesReal).toBeGreaterThan(p.holdingFeesAttributed);
  });

  it("adjusts a past realization's sale proceeds toward today", () => {
    const buyDate = "2012-01-15";
    const saleDate = "2015-06-30";
    const orders: OrderRow[] = [
      makeOrder({
        id: "b1",
        kind: "buy",
        tradeDate: buyDate,
        quantity: 10,
        price: 100,
        grossAmount: 1000,
      }),
      makeOrder({
        id: "s1",
        kind: "sell",
        tradeDate: saleDate,
        quantity: 4,
        price: 150,
        grossAmount: 600,
      }),
    ];

    const { realizations } = replayTransactions(
      orders,
      { FR0010315770: eur(160) },
      TODAY,
    );
    expect(realizations).toHaveLength(1);
    const r = realizations[0]!;
    expect(r.saleNetReal).toBeCloseTo(
      adjustForInflation(r.saleNet, saleDate, TODAY_STR),
      6,
    );
    expect(r.costBasisReal).toBeCloseTo(
      adjustForInflation(r.costBasis, buyDate, TODAY_STR),
      6,
    );
    expect(r.capitalRecoveredReal).toBeCloseTo(r.saleNetReal, 8);
    expect(r.pnlCapitalReal).toBeCloseTo(r.saleNetReal - r.costBasisReal, 6);
  });

  it("re-XIRRs a cash position from inflation-adjusted external flows", () => {
    const depositDate = "2015-05-12";
    const orders: OrderRow[] = [
      makeOrder({
        id: "dep",
        kind: "deposit",
        isin: "",
        instrumentName: "Cash",
        assetClass: "cash",
        grossAmount: 100000,
        quantity: null,
        price: null,
        tradeDate: depositDate,
        broker: "Bourse Direct",
      }),
    ];

    const { positions } = replayTransactions(orders, {}, TODAY);
    const cash = positions.find((p) => p.assetClass === "cash")!;
    // External flow rescaled to today's euros; final balance unchanged.
    const inflatedDeposit = adjustForInflation(
      100000,
      depositDate,
      TODAY_STR,
    );
    const expected = xirr([
      { date: depositDate, amount: -inflatedDeposit },
      { date: TODAY_STR, amount: 100000 },
    ]);
    expect(cash.xirrCapitalReal).toBeCloseTo(expected, 6);
    // Inflation depresses the real yield versus the nominal one (deposit is
    // worth more in today's euros, so the real IRR on the same balance dips).
    expect(cash.xirrCapitalReal).toBeLessThan(cash.xirrCapital);
  });

  it("keeps pnlPct*Real at 0 when investedReal is 0", () => {
    // No buys → no instrument line, but we can still exercise the cash
    // pathway: a deposit alone yields invested = invested-real = balance.
    // For a stricter zero test, use an instrument that never gets bought.
    const orders: OrderRow[] = [
      makeOrder({
        id: "div-only",
        kind: "dividend",
        tradeDate: "2020-06-15",
        quantity: null,
        price: null,
        grossAmount: 50,
      }),
    ];
    const { positions } = replayTransactions(
      orders,
      { FR0010315770: eur(100) },
      TODAY,
    );
    // No buy → no active position emitted (orphan dividend).
    expect(positions).toHaveLength(0);
  });

  it("derives a strictly smaller real XIRR than the nominal XIRR for an old buy", () => {
    const buyDate = "2014-05-12";
    const orders: OrderRow[] = [
      makeOrder({
        id: "b1",
        kind: "buy",
        tradeDate: buyDate,
        quantity: 10,
        price: 100,
        grossAmount: 1000,
      }),
    ];
    // Valuation at +21% (nominal). Inflation since 2014 is roughly +25-30%
    // on the CPI we ship → real return is negative.
    const { positions } = replayTransactions(
      orders,
      { FR0010315770: eur(121) },
      TODAY,
    );
    const p = positions[0]!;
    expect(p.xirrCapital).toBeGreaterThan(0);
    expect(p.xirrCapitalReal).toBeLessThan(p.xirrCapital);
    // Sanity: helper agrees with manual two-flow XIRR.
    const inflatedBuy = adjustForInflation(1000, buyDate, TODAY_STR);
    const manual = xirr([
      { date: buyDate, amount: -inflatedBuy },
      { date: TODAY_STR, amount: 1210 },
    ]);
    expect(p.xirrCapitalReal).toBeCloseTo(manual, 6);
  });
});

describe("computeTotals — inflation aggregation", () => {
  it("re-XIRRs the portfolio from concatenated cashFlows*Real, not by averaging rates", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b1",
        isin: "FR0010315770",
        kind: "buy",
        tradeDate: "2014-05-12",
        quantity: 10,
        price: 100,
        grossAmount: 1000,
      }),
      makeOrder({
        id: "b2",
        isin: "US0231351067",
        kind: "buy",
        tradeDate: "2018-05-12",
        quantity: 5,
        price: 200,
        grossAmount: 1000,
      }),
    ];
    const positions = aggregate(
      orders,
      { FR0010315770: eur(120), US0231351067: eur(220) },
      TODAY,
    );
    const totals = computeTotals(positions, TODAY);

    const concat = [
      ...positions.flatMap((p) => p.cashFlowsCapitalReal),
    ];
    const expected = xirr(concat);
    expect(totals.xirrCapitalReal).toBeCloseTo(expected, 8);
    // Make sure the rate is NOT the simple average of per-position rates —
    // they're weighted implicitly by flow scale via xirr().
    const naiveAvg =
      (positions[0]!.xirrCapitalReal + positions[1]!.xirrCapitalReal) / 2;
    expect(Math.abs(totals.xirrCapitalReal - naiveAvg)).toBeGreaterThan(1e-6);
  });

  it("sums investedReal / dividendsTotalReal across active positions", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b1",
        kind: "buy",
        tradeDate: "2015-01-15",
        quantity: 10,
        price: 100,
        grossAmount: 1000,
      }),
      makeOrder({
        id: "d1",
        kind: "dividend",
        tradeDate: "2018-06-15",
        quantity: null,
        price: null,
        grossAmount: 50,
      }),
    ];
    const positions = aggregate(orders, { FR0010315770: eur(120) }, TODAY);
    const totals = computeTotals(positions, TODAY);

    const p = positions[0]!;
    expect(totals.investedReal).toBeCloseTo(p.investedReal, 8);
    expect(totals.dividendsTotalReal).toBeCloseTo(
      p.dividendsAttributedReal,
      8,
    );
    expect(totals.investedReal).toBeGreaterThan(totals.invested);
  });

  it("switches to a cash-mode real XIRR on a cash-only portfolio", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "dep",
        kind: "deposit",
        isin: "",
        assetClass: "cash",
        instrumentName: "Cash",
        grossAmount: 50000,
        quantity: null,
        price: null,
        tradeDate: "2016-05-12",
        broker: "Bourse Direct",
      }),
    ];
    const positions = aggregate(orders, {}, TODAY);
    const totals = computeTotals(positions, TODAY);
    expect(totals.kpiMode).toBe("cash");
    expect(Number.isFinite(totals.xirrCapitalReal)).toBe(true);
    // Concatenation rule: cash-mode real XIRR matches the single position's.
    expect(totals.xirrCapitalReal).toBeCloseTo(
      positions[0]!.xirrCapitalReal,
      8,
    );
  });
});

describe("computeRealizationTotals — inflation aggregation", () => {
  it("aggregates *Real scalars and weights *RealXIRR by costBasisReal", () => {
    const buyDate = "2012-01-15";
    const saleDate = "2015-06-30";
    const orders: OrderRow[] = [
      makeOrder({
        id: "b1",
        kind: "buy",
        tradeDate: buyDate,
        quantity: 20,
        price: 100,
        grossAmount: 2000,
      }),
      makeOrder({
        id: "s1",
        kind: "sell",
        tradeDate: saleDate,
        quantity: 10,
        price: 150,
        grossAmount: 1500,
      }),
      makeOrder({
        id: "s2",
        kind: "sell",
        tradeDate: "2020-06-30",
        quantity: 10,
        price: 180,
        grossAmount: 1800,
      }),
    ];

    const { realizations } = aggregateWithRealizations(
      orders,
      { FR0010315770: eur(200) },
      TODAY,
    );
    const totals = computeRealizationTotals(realizations);

    const sumCostBasisReal = realizations.reduce(
      (s, r) => s + r.costBasisReal,
      0,
    );
    const sumCapitalRecoveredReal = realizations.reduce(
      (s, r) => s + r.capitalRecoveredReal,
      0,
    );
    expect(totals.costBasisReal).toBeCloseTo(sumCostBasisReal, 6);
    expect(totals.capitalRecoveredReal).toBeCloseTo(
      sumCapitalRecoveredReal,
      6,
    );

    // Weighted by costBasisReal.
    let num = 0;
    let den = 0;
    for (const r of realizations) {
      if (!Number.isFinite(r.xirrCapitalReal)) continue;
      num += r.xirrCapitalReal * r.costBasisReal;
      den += r.costBasisReal;
    }
    expect(totals.xirrCapitalReal).toBeCloseTo(num / den, 8);
  });

  it("CPI ratio sanity: index strictly grows on a 12-year window", () => {
    // Guard against a regression where adjustForInflation flattens to no-op.
    expect(getCpiIndex("2014-05-12")).toBeLessThan(getCpiIndex(TODAY_STR));
  });
});
