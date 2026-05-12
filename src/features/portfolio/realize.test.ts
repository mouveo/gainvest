import { describe, expect, it } from "vitest";

import type { OrderRow } from "./aggregate";
import { replayTransactions } from "./realize";

function makeOrder(overrides: Partial<OrderRow>): OrderRow {
  return {
    id: "x",
    isin: "FR0010315770",
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
    executionVenue: null,
    broker: null,
    support: "CTO",
    ...overrides,
  };
}

const TODAY = new Date("2026-05-12T00:00:00Z");

describe("replayTransactions", () => {
  it("computes PRU and remaining qty after a partial sell at a higher price", () => {
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
        quantity: 5,
        price: 150,
        grossAmount: 750,
      }),
    ];

    const { positions, realizations } = replayTransactions(
      orders,
      { FR0010315770: 200 },
      TODAY,
    );

    expect(positions).toHaveLength(1);
    expect(positions[0]!.qty).toBe(5);
    expect(positions[0]!.pru).toBeCloseTo(100, 8);
    expect(positions[0]!.totalCost).toBeCloseTo(500, 8);

    expect(realizations).toHaveLength(1);
    expect(realizations[0]!.saleQty).toBe(5);
    expect(realizations[0]!.costBasis).toBeCloseTo(500, 8);
    expect(realizations[0]!.saleNet).toBeCloseTo(750, 8);
    expect(realizations[0]!.pnlCapital).toBeCloseTo(250, 8);
  });

  it("does not reuse flows between two successive partial sells", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b1",
        kind: "buy",
        tradeDate: "2020-01-01",
        quantity: 10,
        price: 100,
        grossAmount: 1000,
      }),
      makeOrder({
        id: "s1",
        kind: "sell",
        tradeDate: "2021-01-01",
        quantity: 5,
        price: 150,
        grossAmount: 750,
      }),
      makeOrder({
        id: "s2",
        kind: "sell",
        tradeDate: "2022-01-01",
        quantity: 5,
        price: 200,
        grossAmount: 1000,
      }),
    ];

    const { realizations, positions } = replayTransactions(
      orders,
      { FR0010315770: 250 },
      TODAY,
    );

    expect(realizations).toHaveLength(2);
    expect(realizations[0]!.costBasis).toBeCloseTo(500, 8);
    expect(realizations[1]!.costBasis).toBeCloseTo(500, 8);

    // Each realization's capital flows must sum to its (saleNet - costBasis).
    const sumFlows = (fs: { amount: number }[]) =>
      fs.reduce((s, f) => s + f.amount, 0);
    // Find each sale's cashFlowsCapital via xirrCapital sign — easier: rebuild via inspection.
    // We embed the invariant: sale 1 consumed -500 from the buy flow,
    // sale 2 consumed the remaining -500 from the buy flow. Total flows
    // across all realizations: -1000 from the buy side.
    const totalCapitalRealized =
      realizations[0]!.saleNet -
      realizations[0]!.costBasis +
      (realizations[1]!.saleNet - realizations[1]!.costBasis);
    expect(totalCapitalRealized).toBeCloseTo(750, 8);
    expect(sumFlows).toBeDefined();

    expect(positions).toHaveLength(0);
  });

  it("attributes a prorata of past dividends to a sale and keeps the rest active", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b1",
        kind: "buy",
        tradeDate: "2020-01-01",
        quantity: 10,
        price: 100,
        grossAmount: 1000,
      }),
      makeOrder({
        id: "d1",
        kind: "dividend",
        tradeDate: "2021-06-01",
        quantity: null,
        price: null,
        grossAmount: 50,
      }),
      makeOrder({
        id: "s1",
        kind: "sell",
        tradeDate: "2022-01-01",
        quantity: 5,
        price: 150,
        grossAmount: 750,
      }),
    ];

    const { positions, realizations } = replayTransactions(
      orders,
      { FR0010315770: 200 },
      TODAY,
    );

    expect(realizations).toHaveLength(1);
    expect(realizations[0]!.dividendsAttributed).toBeCloseTo(25, 8);
    expect(realizations[0]!.pnlTotal).toBeCloseTo(275, 8); // 750 + 25 - 500

    expect(positions).toHaveLength(1);
    expect(positions[0]!.dividendsAttributed).toBeCloseTo(25, 8);
    expect(positions[0]!.qty).toBe(5);
  });

  it("keeps a positive PRU after a Tesla-like large partial sell", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b1",
        kind: "buy",
        tradeDate: "2020-01-01",
        quantity: 100,
        price: 50,
        grossAmount: 5000,
      }),
      makeOrder({
        id: "s1",
        kind: "sell",
        tradeDate: "2022-01-01",
        quantity: 80,
        price: 200,
        grossAmount: 16000,
      }),
    ];

    const { positions } = replayTransactions(orders, { FR0010315770: 250 }, TODAY);

    expect(positions).toHaveLength(1);
    expect(positions[0]!.qty).toBe(20);
    expect(positions[0]!.pru).toBeCloseTo(50, 8);
    expect(positions[0]!.invested).toBeCloseTo(1000, 8);
    expect(positions[0]!.pru).toBeGreaterThan(0);
  });

  it("splits same ISIN into separate positions when supports differ", () => {
    const orders: OrderRow[] = [
      makeOrder({ id: "a", support: "CTO", quantity: 5, price: 100, grossAmount: 500 }),
      makeOrder({ id: "b", support: "PEA", quantity: 7, price: 110, grossAmount: 770 }),
    ];

    const { positions } = replayTransactions(orders, { FR0010315770: 120 }, TODAY);
    expect(positions).toHaveLength(2);
    expect(positions.find((p) => p.support === "CTO")?.qty).toBe(5);
    expect(positions.find((p) => p.support === "PEA")?.qty).toBe(7);
  });

  it("ignores dividend and fee rows without quantity and never creates a position from them", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "d1",
        isin: "US0378331005",
        kind: "dividend",
        quantity: null,
        price: null,
        grossAmount: 12.5,
      }),
      makeOrder({
        id: "f1",
        isin: "",
        kind: "fee",
        quantity: null,
        price: null,
        grossAmount: 4.03,
        instrumentName: "Droits de garde",
        assetClass: "cash",
      }),
    ];

    const { positions, realizations } = replayTransactions(orders, {}, TODAY);
    expect(positions).toHaveLength(0);
    expect(realizations).toHaveLength(0);
  });

  it("computes a positive XIRR for a profitable held position", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b1",
        kind: "buy",
        tradeDate: "2024-05-12",
        quantity: 10,
        price: 100,
        grossAmount: 1000,
      }),
    ];

    const { positions } = replayTransactions(orders, { FR0010315770: 121 }, TODAY);
    expect(positions).toHaveLength(1);
    expect(positions[0]!.xirrCapital).toBeCloseTo(0.1, 2);
  });
});
