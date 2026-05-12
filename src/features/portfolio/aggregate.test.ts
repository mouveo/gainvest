import { describe, expect, it } from "vitest";

import { aggregate, aggregateWithRealizations, computeTotals, type OrderRow } from "./aggregate";

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
    notes: null,
    executionVenue: null,
    broker: null,
    support: "CTO",
    ...overrides,
  };
}

describe("aggregate", () => {
  it("splits same ISIN into separate positions when supports differ", () => {
    const orders: OrderRow[] = [
      makeOrder({ id: "a", isin: "FR0010315770", support: "CTO", quantity: 5, price: 100 }),
      makeOrder({ id: "b", isin: "FR0010315770", support: "PEA", quantity: 7, price: 110 }),
    ];

    const positions = aggregate(orders, { FR0010315770: 120 });

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

    const positions = aggregate(orders, { FR0010315770: 75 });

    expect(positions).toHaveLength(1);
    expect(positions[0]!.currentPrice).toBe(75);
    expect(positions[0]!.valuation).toBe(4 * 75);
  });

  it("merges orders with same ISIN and same support into one position", () => {
    const orders: OrderRow[] = [
      makeOrder({ id: "a", isin: "FR0010315770", support: "CTO", quantity: 3, price: 100 }),
      makeOrder({ id: "b", isin: "FR0010315770", support: "CTO", quantity: 2, price: 110 }),
    ];

    const positions = aggregate(orders, { FR0010315770: 120 });

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

    const positions = aggregate(orders, { FR0010315770: 120 });

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

    const positions = aggregate(orders, { FR0010315770: 120 });

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

    const result = aggregateWithRealizations(orders, { FR0000000001: 200 });

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

    const positions = aggregate(orders, { FR0000000001: 110 });
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
    const positions = aggregate(orders, { FR0000000001: 121 }, today);
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

    const positions = aggregate(orders, { FR0010315770: 120 });
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

    const positions = aggregate(orders, { FR0010315770: 120 });
    expect(positions).toHaveLength(2);
    const bd = positions.find((p) => p.broker === "Bourse Direct")!;
    const ibkr = positions.find((p) => p.broker === "IBKR")!;
    expect(bd.qty).toBe(5);
    expect(ibkr.qty).toBe(7);
    expect(bd.key).not.toBe(ibkr.key);
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
      { US0231351067: 121, US88160R1014: 242 },
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
});
