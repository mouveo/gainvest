import { describe, expect, it } from "vitest";

import {
  aggregate,
  aggregateWithRealizations,
  computeMovementTotals,
  computeRealizationTotals,
  computeTotals,
  type CurrentPrice,
  type OrderRow,
} from "./aggregate";
import type { PastRealization } from "./realize";

function eur(n: number): CurrentPrice {
  return { native: n, eur: n, currency: "EUR", fxToEur: 1 };
}

function makeOrder(overrides: Partial<OrderRow>): OrderRow {
  return {
    id: "x",
    isin: "FR0000000001",
    instrumentId: null,
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

function makeRealization(overrides: Partial<PastRealization>): PastRealization {
  return {
    key: "FR0000000001\x01CTO\x01",
    isin: "FR0000000001",
    support: "CTO",
    broker: null,
    instrumentName: "Test",
    assetClass: "etf",
    currency: "EUR",
    saleDate: "2025-01-01",
    saleQty: 1,
    saleNet: 0,
    costBasis: 0,
    pruAtSale: 0,
    dividendsAttributed: 0,
    holdingFeesAttributed: 0,
    pnlCapital: 0,
    pnlTotal: 0,
    xirrCapital: 0,
    xirrTotal: 0,
    xirrCapitalNetFees: 0,
    xirrTotalNetFees: 0,
    ...overrides,
  };
}

describe("aggregate", () => {
  it("splits same ISIN into separate positions when supports differ", () => {
    const orders: OrderRow[] = [
      makeOrder({ id: "a", isin: "FR0010315770", support: "CTO", quantity: 5, price: 100 }),
      makeOrder({ id: "b", isin: "FR0010315770", support: "PEA", quantity: 7, price: 110 }),
    ];

    const positions = aggregate(orders, { FR0010315770: eur(120) });

    expect(positions).toHaveLength(2);

    const ctoPos = positions.find((p) => p.support === "CTO");
    const peaPos = positions.find((p) => p.support === "PEA");

    expect(ctoPos).toBeDefined();
    expect(peaPos).toBeDefined();
    expect(ctoPos!.isin).toBe("FR0010315770");
    expect(peaPos!.isin).toBe("FR0010315770");
    expect(ctoPos!.qty).toBe(5);
    expect(peaPos!.qty).toBe(7);

    expect(ctoPos!.key).not.toBe(peaPos!.key);
    expect(ctoPos!.key).toContain("CTO");
    expect(peaPos!.key).toContain("PEA");
  });

  it("looks up current price by raw ISIN, not the composite key", () => {
    const orders: OrderRow[] = [
      makeOrder({ isin: "FR0010315770", support: "PEA", quantity: 4, price: 50 }),
    ];

    const positions = aggregate(orders, { FR0010315770: eur(75) });

    expect(positions).toHaveLength(1);
    expect(positions[0]!.currentPrice).toBe(75);
    expect(positions[0]!.valuation).toBe(4 * 75);
  });

  it("merges orders with same ISIN and same support into one position", () => {
    const orders: OrderRow[] = [
      makeOrder({ id: "a", isin: "FR0010315770", support: "CTO", quantity: 3, price: 100 }),
      makeOrder({ id: "b", isin: "FR0010315770", support: "CTO", quantity: 2, price: 110 }),
    ];

    const positions = aggregate(orders, { FR0010315770: eur(120) });

    expect(positions).toHaveLength(1);
    expect(positions[0]!.support).toBe("CTO");
    expect(positions[0]!.qty).toBe(5);
    expect(positions[0]!.ordersCount).toBe(2);
  });

  it("ignores dividend and fee rows when building positions", () => {
    const orders: OrderRow[] = [
      makeOrder({ id: "buy1", isin: "FR0010315770", quantity: 10, price: 100 }),
      makeOrder({
        id: "div1",
        isin: "FR0010315770",
        kind: "dividend",
        quantity: null,
        price: null,
        grossAmount: 25,
      }),
      makeOrder({
        id: "fee1",
        isin: "",
        kind: "fee",
        quantity: null,
        price: null,
        grossAmount: 4.03,
        instrumentName: "Droits de garde",
        assetClass: "cash",
      }),
    ];

    const positions = aggregate(orders, { FR0010315770: eur(120) });

    expect(positions).toHaveLength(1);
    const p = positions[0]!;
    expect(p.qty).toBe(10);
    expect(p.ordersCount).toBe(1);
    expect(p.invested).toBe(1000);
    expect(p.valuation).toBe(1200);
  });

  it("filters buy/sell rows with null quantity or price", () => {
    const orders: OrderRow[] = [
      makeOrder({ id: "ok", isin: "FR0010315770", quantity: 5, price: 100 }),
      makeOrder({
        id: "bad",
        isin: "FR0010315770",
        quantity: null,
        price: null,
      }),
    ];

    const positions = aggregate(orders, { FR0010315770: eur(120) });

    expect(positions).toHaveLength(1);
    expect(positions[0]!.qty).toBe(5);
    expect(positions[0]!.ordersCount).toBe(1);
  });

  it("aggregateWithRealizations exposes both active positions and realized sales", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b1",
        kind: "buy",
        tradeDate: "2024-01-01",
        quantity: 10,
        price: 100,
        grossAmount: 1000,
      }),
      makeOrder({
        id: "s1",
        kind: "sell",
        tradeDate: "2025-01-01",
        quantity: 4,
        price: 150,
        grossAmount: 600,
      }),
    ];

    const result = aggregateWithRealizations(orders, { FR0000000001: eur(200) });

    expect(result.positions).toHaveLength(1);
    expect(result.positions[0]!.qty).toBe(6);
    expect(result.realizations).toHaveLength(1);
    expect(result.realizations[0]!.saleQty).toBe(4);
    expect(result.realizations[0]!.pnlCapital).toBeCloseTo(200, 8);
  });

  it("populates new Position fields for capital vs total P&L", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b1",
        kind: "buy",
        tradeDate: "2024-01-01",
        quantity: 10,
        price: 100,
        grossAmount: 1000,
      }),
      makeOrder({
        id: "d1",
        kind: "dividend",
        tradeDate: "2024-06-01",
        quantity: null,
        price: null,
        grossAmount: 50,
      }),
    ];

    const positions = aggregate(orders, { FR0000000001: eur(110) });
    const p = positions[0]!;

    expect(p.invested).toBeCloseTo(1000, 8);
    expect(p.valuation).toBeCloseTo(1100, 8);
    expect(p.dividendsAttributed).toBeCloseTo(50, 8);
    expect(p.pnlCapital).toBeCloseTo(100, 8);
    expect(p.pnlTotal).toBeCloseTo(150, 8);
    expect(p.pnlPctCapital).toBeCloseTo(0.1, 8);
    expect(p.pnlPctTotal).toBeCloseTo(0.15, 8);
    // Legacy aliases.
    expect(p.pnl).toBeCloseTo(p.pnlCapital, 8);
    expect(p.pnlPct).toBeCloseTo(p.pnlPctCapital, 8);
  });

  it("computeTotals derives xirrCapital and xirrTotal from concatenated cash flows", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b1",
        kind: "buy",
        tradeDate: "2024-05-12",
        quantity: 10,
        price: 100,
        grossAmount: 1000,
      }),
      makeOrder({
        id: "d1",
        kind: "dividend",
        tradeDate: "2024-11-12",
        quantity: null,
        price: null,
        grossAmount: 20,
      }),
    ];

    const today = new Date("2026-05-12T00:00:00Z");
    const positions = aggregate(orders, { FR0000000001: eur(121) }, today);
    const totals = computeTotals(positions, today);

    expect(totals.invested).toBeCloseTo(1000, 6);
    expect(totals.valuation).toBeCloseTo(1210, 6);
    expect(totals.dividendsTotal).toBeCloseTo(20, 6);
    expect(totals.pnl).toBeCloseTo(210, 6);
    expect(totals.pnlTotal).toBeCloseTo(230, 6);
    expect(Number.isFinite(totals.xirrCapital)).toBe(true);
    expect(Number.isFinite(totals.xirrTotal)).toBe(true);
    expect(totals.xirrTotal).toBeGreaterThan(totals.xirrCapital);
    // pnlAnnualized stays aligned with xirrCapital for compat.
    expect(totals.pnlAnnualized).toBeCloseTo(totals.xirrCapital, 6);
  });

  it("propagates Position.broker from the order rows", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "a",
        isin: "FR0010315770",
        broker: "Bourse Direct",
        quantity: 5,
        price: 100,
        grossAmount: 500,
      }),
    ];

    const positions = aggregate(orders, { FR0010315770: eur(120) });
    expect(positions).toHaveLength(1);
    expect(positions[0]!.broker).toBe("Bourse Direct");
  });

  it("splits same (isin, support) into separate positions when brokers differ", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "a",
        isin: "FR0010315770",
        support: "CTO",
        broker: "Bourse Direct",
        quantity: 5,
        price: 100,
        grossAmount: 500,
      }),
      makeOrder({
        id: "b",
        isin: "FR0010315770",
        support: "CTO",
        broker: "IBKR",
        quantity: 7,
        price: 110,
        grossAmount: 770,
      }),
    ];

    const positions = aggregate(orders, { FR0010315770: eur(120) });
    expect(positions).toHaveLength(2);
    const bd = positions.find((p) => p.broker === "Bourse Direct")!;
    const ibkr = positions.find((p) => p.broker === "IBKR")!;
    expect(bd.qty).toBe(5);
    expect(ibkr.qty).toBe(7);
    expect(bd.key).not.toBe(ibkr.key);
  });

  it("computeRealizationTotals sums fields and weights XIRR by costBasis", () => {
    const reals: PastRealization[] = [
      makeRealization({
        saleNet: 600,
        costBasis: 400,
        pnlCapital: 200,
        pnlTotal: 220,
        xirrCapital: 0.1,
        xirrTotal: 0.12,
        xirrCapitalNetFees: 0.09,
        xirrTotalNetFees: 0.11,
      }),
      makeRealization({
        saleNet: 1200,
        costBasis: 1000,
        pnlCapital: 200,
        pnlTotal: 240,
        xirrCapital: 0.2,
        xirrTotal: 0.22,
        xirrCapitalNetFees: 0.19,
        xirrTotalNetFees: 0.21,
      }),
    ];

    const totals = computeRealizationTotals(reals);

    expect(totals.count).toBe(2);
    expect(totals.capitalRecovered).toBeCloseTo(1800, 8);
    expect(totals.costBasis).toBeCloseTo(1400, 8);
    expect(totals.pnlCapital).toBeCloseTo(400, 8);
    expect(totals.pnlTotal).toBeCloseTo(460, 8);

    const expectedCapital = (0.1 * 400 + 0.2 * 1000) / 1400;
    const expectedTotal = (0.12 * 400 + 0.22 * 1000) / 1400;
    const expectedCapitalNet = (0.09 * 400 + 0.19 * 1000) / 1400;
    const expectedTotalNet = (0.11 * 400 + 0.21 * 1000) / 1400;
    expect(totals.xirrCapital).toBeCloseTo(expectedCapital, 8);
    expect(totals.xirrTotal).toBeCloseTo(expectedTotal, 8);
    expect(totals.xirrCapitalNetFees).toBeCloseTo(expectedCapitalNet, 8);
    expect(totals.xirrTotalNetFees).toBeCloseTo(expectedTotalNet, 8);
  });

  it("computeRealizationTotals ignores non-finite XIRR samples in the weighted average", () => {
    const reals: PastRealization[] = [
      makeRealization({
        saleNet: 600,
        costBasis: 400,
        pnlCapital: 200,
        pnlTotal: 200,
        xirrCapital: 0.1,
        xirrTotal: 0.1,
        xirrCapitalNetFees: 0.1,
        xirrTotalNetFees: 0.1,
      }),
      makeRealization({
        saleNet: 1200,
        costBasis: 1000,
        pnlCapital: 200,
        pnlTotal: 200,
        xirrCapital: Number.NaN,
        xirrTotal: Number.POSITIVE_INFINITY,
        xirrCapitalNetFees: Number.NEGATIVE_INFINITY,
        xirrTotalNetFees: Number.NaN,
      }),
    ];

    const totals = computeRealizationTotals(reals);

    expect(totals.xirrCapital).toBeCloseTo(0.1, 8);
    expect(totals.xirrTotal).toBeCloseTo(0.1, 8);
    expect(totals.xirrCapitalNetFees).toBeCloseTo(0.1, 8);
    expect(totals.xirrTotalNetFees).toBeCloseTo(0.1, 8);
  });

  it("computeRealizationTotals returns zeros and NaN XIRR on an empty list", () => {
    const totals = computeRealizationTotals([]);
    expect(totals.count).toBe(0);
    expect(totals.capitalRecovered).toBe(0);
    expect(totals.costBasis).toBe(0);
    expect(totals.pnlCapital).toBe(0);
    expect(totals.pnlTotal).toBe(0);
    expect(Number.isNaN(totals.xirrCapital)).toBe(true);
    expect(Number.isNaN(totals.xirrTotal)).toBe(true);
    expect(Number.isNaN(totals.xirrCapitalNetFees)).toBe(true);
    expect(Number.isNaN(totals.xirrTotalNetFees)).toBe(true);
  });

  it("computeMovementTotals splits buy/sell/dividend/fee rows correctly", () => {
    const orders: OrderRow[] = [
      makeOrder({ id: "b1", kind: "buy", grossAmount: 1000, fees: 5 }),
      makeOrder({ id: "b2", kind: "buy", grossAmount: 500, fees: 2 }),
      makeOrder({ id: "s1", kind: "sell", grossAmount: 800, fees: 4 }),
      makeOrder({
        id: "d1",
        kind: "dividend",
        grossAmount: 50,
        fees: 999,
        quantity: null,
        price: null,
      }),
      makeOrder({
        id: "f1",
        kind: "fee",
        grossAmount: 12,
        fees: 0,
        quantity: null,
        price: null,
      }),
    ];

    const totals = computeMovementTotals(orders);

    expect(totals.count).toBe(5);
    expect(totals.totalBuys).toBeCloseTo(1500, 8);
    expect(totals.totalSells).toBeCloseTo(800, 8);
    expect(totals.dividendsReceived).toBeCloseTo(50, 8);
    // 5 + 2 (buy fees) + 4 (sell fees) + 12 (fee row grossAmount). Dividend fees ignored.
    expect(totals.feesPaid).toBeCloseTo(23, 8);
    expect(totals.depositsTotal).toBe(0);
    expect(totals.withdrawalsTotal).toBe(0);
    expect(totals.interestReceived).toBe(0);
    expect(totals.taxesPaid).toBe(0);
  });

  it("computeMovementTotals tallies cash kinds (deposit/withdrawal/interest/tax)", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "dep",
        kind: "deposit",
        grossAmount: 10_000,
        quantity: null,
        price: null,
      }),
      makeOrder({
        id: "wd",
        kind: "withdrawal",
        grossAmount: 1_500,
        quantity: null,
        price: null,
      }),
      makeOrder({
        id: "int",
        kind: "interest",
        grossAmount: 12,
        quantity: null,
        price: null,
      }),
      makeOrder({
        id: "tax",
        kind: "tax",
        grossAmount: 1.8,
        quantity: null,
        price: null,
      }),
    ];

    const totals = computeMovementTotals(orders);
    expect(totals.depositsTotal).toBeCloseTo(10_000, 8);
    expect(totals.withdrawalsTotal).toBeCloseTo(1_500, 8);
    expect(totals.interestReceived).toBeCloseTo(12, 8);
    expect(totals.taxesPaid).toBeCloseTo(1.8, 8);
  });

  it("computeMovementTotals projects native amounts to EUR via fxRate", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "buy-usd",
        kind: "buy",
        currency: "USD",
        fxRate: 0.9,
        grossAmount: 1000,
        fees: 5,
      }),
    ];
    const totals = computeMovementTotals(orders);
    // 1000 USD * 0.9 = 900 EUR
    expect(totals.totalBuys).toBeCloseTo(900, 8);
    // 5 USD * 0.9 = 4.5 EUR
    expect(totals.feesPaid).toBeCloseTo(4.5, 8);
  });

  it("includes a cash position when a deposit is recorded alongside instrument trades", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "dep",
        kind: "deposit",
        grossAmount: 5000,
        quantity: null,
        price: null,
        broker: "Bourse Direct",
      }),
      makeOrder({
        id: "b1",
        isin: "FR0010315770",
        kind: "buy",
        quantity: 10,
        price: 100,
        grossAmount: 1000,
        broker: "Bourse Direct",
      }),
    ];

    const positions = aggregate(orders, { FR0010315770: eur(120) });
    const cash = positions.find((p) => p.assetClass === "cash");
    expect(cash).toBeDefined();
    expect(cash!.qty).toBeCloseTo(4000, 6);
    expect(cash!.currency).toBe("EUR");
    expect(positions.find((p) => p.isin === "FR0010315770")).toBeDefined();
  });

  it("computeTotals counts cash in valuation + lines but excludes it from invested/pnl/xirr", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "dep",
        kind: "deposit",
        grossAmount: 5000,
        quantity: null,
        price: null,
        broker: "Bourse Direct",
        tradeDate: "2024-05-12",
      }),
      makeOrder({
        id: "b1",
        isin: "FR0000000001",
        kind: "buy",
        tradeDate: "2024-05-12",
        quantity: 10,
        price: 100,
        grossAmount: 1000,
        broker: "Bourse Direct",
      }),
    ];

    const today = new Date("2026-05-12T00:00:00Z");
    const positions = aggregate(orders, { FR0000000001: eur(110) }, today);
    const totals = computeTotals(positions, today);

    // 2 lines: 1 instrument + 1 cash.
    expect(totals.lines).toBe(2);
    // Valuation: 1100 (instrument) + 4000 (cash 5000 - 1000) = 5100.
    expect(totals.valuation).toBeCloseTo(5100, 6);
    // Invested counts only the instrument capital.
    expect(totals.invested).toBeCloseTo(1000, 6);
    // PnL is anchored on instrument valuation, not cash.
    expect(totals.pnl).toBeCloseTo(100, 6);
    expect(totals.pnlPct).toBeCloseTo(0.1, 6);
    // XIRR derived from instrument flows only.
    expect(Number.isFinite(totals.xirrCapital)).toBe(true);
  });

  it("computeTotals dividendsTotal excludes cash interest", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "dep",
        kind: "deposit",
        grossAmount: 5000,
        quantity: null,
        price: null,
        broker: "Bourse Direct",
        tradeDate: "2024-05-12",
      }),
      makeOrder({
        id: "b1",
        isin: "FR0000000001",
        kind: "buy",
        tradeDate: "2024-05-12",
        quantity: 10,
        price: 100,
        grossAmount: 1000,
        broker: "Bourse Direct",
      }),
      makeOrder({
        id: "d1",
        isin: "FR0000000001",
        kind: "dividend",
        tradeDate: "2024-11-12",
        quantity: null,
        price: null,
        grossAmount: 20,
        broker: "Bourse Direct",
      }),
      makeOrder({
        id: "int",
        isin: "",
        kind: "interest",
        tradeDate: "2024-12-01",
        quantity: null,
        price: null,
        grossAmount: 12,
        broker: "Bourse Direct",
      }),
    ];

    const positions = aggregate(orders, { FR0000000001: eur(110) });
    const totals = computeTotals(positions);

    // dividendsTotal = instrument dividend only (20), not cash interest (12).
    expect(totals.dividendsTotal).toBeCloseTo(20, 6);
  });

  it("exposes Position.holdingFees and a portfolio holding-fees total with a depressed net XIRR", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b-us-1",
        isin: "US0231351067",
        kind: "buy",
        tradeDate: "2024-05-12",
        quantity: 10,
        price: 100,
        grossAmount: 1000,
      }),
      makeOrder({
        id: "b-us-2",
        isin: "US88160R1014",
        kind: "buy",
        tradeDate: "2024-05-12",
        quantity: 5,
        price: 200,
        grossAmount: 1000,
      }),
      makeOrder({
        id: "f1",
        isin: "",
        kind: "fee",
        tradeDate: "2025-05-12",
        quantity: null,
        price: null,
        grossAmount: 40,
        notes: "Droits de garde 2025 S1",
        instrumentName: "Droits de garde",
        assetClass: "cash",
      }),
    ];

    const today = new Date("2026-05-12T00:00:00Z");
    const positions = aggregate(
      orders,
      { US0231351067: eur(121), US88160R1014: eur(242) },
      today,
    );
    const totals = computeTotals(positions, today);

    for (const p of positions) {
      expect(p.holdingFees).toBeGreaterThan(0);
    }
    expect(totals.holdingFeesTotal).toBeCloseTo(40, 6);
    expect(Number.isFinite(totals.xirrCapitalNetFees)).toBe(true);
    expect(Number.isFinite(totals.xirrTotalNetFees)).toBe(true);
    expect(totals.xirrCapitalNetFees).toBeLessThan(totals.xirrCapital);
    expect(totals.xirrTotalNetFees).toBeLessThan(totals.xirrTotal);
  });

  it("propagates pruPctPar and currentPctPar from the replay for bond positions", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b1",
        isin: "US023135CV68",
        instrumentName: "AMZN 4.5 2030",
        assetClass: "bond",
        currency: "USD",
        fxRate: 0.9,
        kind: "buy",
        tradeDate: "2024-05-12",
        quantity: 56_000,
        price: 98.948,
        grossAmount: 55_410.88,
        fees: 21.5,
      }),
    ];

    const positions = aggregate(orders, {
      US023135CV68: {
        native: 97.383,
        eur: (97.383 / 100) * 0.9,
        currency: "USD",
        fxToEur: 0.9,
      },
    });

    expect(positions).toHaveLength(1);
    const p = positions[0]!;
    expect(p.pruPctPar).toBeCloseTo(98.948, 8);
    expect(p.currentPctPar).toBeCloseTo(97.383, 8);
    expect(p.valuation).toBeCloseTo((56_000 * 97.383 * 0.9) / 100, 4);
  });

  it("leaves pruPctPar and currentPctPar null for non-bond and cash positions", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "dep",
        kind: "deposit",
        grossAmount: 5_000,
        quantity: null,
        price: null,
        broker: "Bourse Direct",
        tradeDate: "2024-05-12",
      }),
      makeOrder({
        id: "b1",
        isin: "FR0010315770",
        kind: "buy",
        tradeDate: "2024-05-12",
        quantity: 10,
        price: 100,
        grossAmount: 1_000,
        broker: "Bourse Direct",
        assetClass: "etf",
      }),
    ];

    const positions = aggregate(orders, { FR0010315770: eur(110) });
    const etf = positions.find((p) => p.assetClass === "etf")!;
    const cash = positions.find((p) => p.assetClass === "cash")!;

    expect(etf.pruPctPar).toBeNull();
    expect(etf.currentPctPar).toBeNull();
    expect(cash.pruPctPar).toBeNull();
    expect(cash.currentPctPar).toBeNull();
  });
});
