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
});
