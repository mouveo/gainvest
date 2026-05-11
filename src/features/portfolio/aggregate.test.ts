import { describe, expect, it } from "vitest";

import { aggregate, type OrderRow } from "./aggregate";

function makeOrder(overrides: Partial<OrderRow>): OrderRow {
  return {
    id: "x",
    isin: "FR0000000001",
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
});
