import { describe, expect, it } from "vitest";

import type { CurrentPrice, OrderRow } from "./aggregate";
import { replayTransactions } from "./realize";

function makeOrder(overrides: Partial<OrderRow>): OrderRow {
  return {
    id: "x",
    isin: "US023135CV68",
    instrumentId: null,
    preferredMic: null,
    preferredCurrency: "USD",
    instrumentName: "AMZN 4.5 2030",
    assetClass: "bond",
    currency: "USD",
    kind: "buy",
    tradeDate: "2024-05-12",
    tradeTime: null,
    quantity: 56000,
    price: 98.948,
    grossAmount: 55410.88,
    fees: 21.5,
    fxRate: 0.85571,
    notes: null,
    executionVenue: null,
    broker: "Interactive Brokers",
    support: "CTO",
    ...overrides,
  };
}

const TODAY = new Date("2026-05-12T00:00:00Z");

describe("replayTransactions — bond valuation in % of par", () => {
  it("values a single bond buy with the % of par × FX × nominal formula", () => {
    const orders: OrderRow[] = [makeOrder({ id: "b1" })];
    const price: CurrentPrice = {
      native: 97.383003,
      eur: (97.383003 / 100) * 0.85571,
      currency: "USD",
      fxToEur: 0.85571,
    };

    const { positions } = replayTransactions(
      orders,
      { US023135CV68: price },
      TODAY,
    );

    expect(positions).toHaveLength(1);
    const p = positions[0]!;
    expect(p.assetClass).toBe("bond");
    expect(p.qty).toBe(56000);
    expect(p.pruPctPar).toBeCloseTo(98.948, 8);
    expect(p.currentPctPar).toBeCloseTo(97.383003, 8);
    expect(p.currentPrice).toBeCloseTo(97.383003, 8);

    const expectedValuation = (56000 * 97.383003 * 0.85571) / 100;
    expect(p.valuation).toBeCloseTo(expectedValuation, 4);

    // Sanity: legacy "qty × price" formula would over-value by ~100x.
    expect(p.valuation).toBeLessThan(56000 * 97.383003 * 0.85571);

    const expectedInvested = (55410.88 + 21.5) * 0.85571;
    expect(p.invested).toBeCloseTo(expectedInvested, 4);
    expect(p.pnlCapital).toBeCloseTo(p.valuation - p.invested, 4);
  });

  it("keeps non-bond positions on the legacy EUR-per-unit valuation path", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "eq",
        isin: "US0231351067",
        instrumentName: "AMZN",
        assetClass: "equity",
        kind: "buy",
        currency: "USD",
        fxRate: 0.9,
        quantity: 10,
        price: 200,
        grossAmount: 2000,
        fees: 1,
      }),
    ];
    const price: CurrentPrice = {
      native: 250,
      eur: 250 * 0.92,
      currency: "USD",
      fxToEur: 0.92,
    };

    const { positions } = replayTransactions(
      orders,
      { US0231351067: price },
      TODAY,
    );

    expect(positions).toHaveLength(1);
    const p = positions[0]!;
    expect(p.assetClass).toBe("equity");
    expect(p.pruPctPar).toBeNull();
    expect(p.currentPctPar).toBeNull();
    // currentPrice exposes EUR-per-unit for non-bonds.
    expect(p.currentPrice).toBeCloseTo(250 * 0.92, 8);
    expect(p.valuation).toBeCloseTo(10 * 250 * 0.92, 6);
  });

  it("reduces totalNativePriceQty prorata on a partial sell, keeping pruPctPar stable", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b1",
        tradeDate: "2024-01-01",
        quantity: 10_000,
        price: 98,
        grossAmount: 9_800,
        fees: 0,
        fxRate: 1,
        currency: "EUR",
      }),
      makeOrder({
        id: "b2",
        tradeDate: "2024-06-01",
        quantity: 10_000,
        price: 102,
        grossAmount: 10_200,
        fees: 0,
        fxRate: 1,
        currency: "EUR",
      }),
      makeOrder({
        id: "s1",
        kind: "sell",
        tradeDate: "2025-01-01",
        quantity: 5_000,
        price: 101,
        grossAmount: 5_050,
        fees: 0,
        fxRate: 1,
        currency: "EUR",
      }),
    ];
    const price: CurrentPrice = {
      native: 100,
      eur: 1,
      currency: "EUR",
      fxToEur: 1,
    };

    const { positions } = replayTransactions(
      orders,
      { US023135CV68: price },
      TODAY,
    );

    expect(positions).toHaveLength(1);
    const p = positions[0]!;
    expect(p.qty).toBe(15_000);
    // Weighted-average % of par before the sell: (98×10000 + 102×10000)/20000 = 100
    // The sell consumes a 5000/20000 = 25% prorata of every accumulated metric,
    // so the remaining weighted average stays at 100.
    expect(p.pruPctPar).toBeCloseTo(100, 8);
    expect(p.currentPctPar).toBeCloseTo(100, 8);
    expect(p.valuation).toBeCloseTo((15_000 * 100) / 100, 6); // qty × native/100 × fx
  });
});
