import { describe, expect, it } from "vitest";

import type { CurrentPrice, OrderRow } from "./aggregate";
import { replayTransactions } from "./realize";

function eur(n: number): CurrentPrice {
  return { native: n, eur: n, currency: "EUR", fxToEur: 1 };
}

function cryptoOrder(overrides: Partial<OrderRow>): OrderRow {
  return {
    id: "x",
    isin: "",
    instrumentId: "inst-btc",
    instrumentSymbol: "BTC",
    convertPairId: null,
    preferredMic: null,
    preferredCurrency: "EUR",
    instrumentName: "BTC",
    assetClass: "crypto",
    currency: "EUR",
    kind: "buy",
    tradeDate: "2024-01-01",
    tradeTime: null,
    quantity: 1,
    price: 50000,
    grossAmount: 50000,
    fees: 0,
    fxRate: 1,
    notes: null,
    executionVenue: null,
    broker: "Coinbase",
    support: "CRYPTO",
    bondCouponRate: null,
    bondMaturityDate: null,
    bondCouponFrequency: null,
    ...overrides,
  };
}

const TODAY = new Date("2026-05-12T00:00:00Z");

describe("replayTransactions — crypto without ISIN", () => {
  it("aggregates two BTC buys and one partial sell into a CUMP position with correct PRU", () => {
    const orders: OrderRow[] = [
      cryptoOrder({
        id: "b1",
        tradeDate: "2024-01-01",
        quantity: 0.5,
        price: 40000,
        grossAmount: 20000,
      }),
      cryptoOrder({
        id: "b2",
        tradeDate: "2024-06-01",
        quantity: 0.5,
        price: 60000,
        grossAmount: 30000,
      }),
      cryptoOrder({
        id: "s1",
        kind: "sell",
        tradeDate: "2025-01-01",
        quantity: 0.3,
        price: 70000,
        grossAmount: 21000,
      }),
    ];

    const { positions, realizations } = replayTransactions(
      orders,
      // Price map keyed on instrumentId — the replay's preferred lookup.
      { "inst-btc": eur(80000) },
      TODAY,
    );

    expect(positions).toHaveLength(1);
    const p = positions[0]!;
    expect(p.instrumentSymbol).toBe("BTC");
    expect(p.assetClass).toBe("crypto");
    expect(p.qty).toBeCloseTo(0.7, 8);
    // CUMP PRU = (20000 + 30000) / 1 BTC = 50000 / BTC; partial sell of 0.3
    // consumes 0.3 × 50000 = 15000 of cost, leaving 35000 for the remaining
    // 0.7 → PRU stays at 50000.
    expect(p.pru).toBeCloseTo(50000, 6);
    expect(p.totalCost).toBeCloseTo(35000, 6);
    // 0.7 × 80000 EUR per unit
    expect(p.valuation).toBeCloseTo(56000, 6);

    expect(realizations).toHaveLength(1);
    expect(realizations[0]!.saleQty).toBeCloseTo(0.3, 8);
    expect(realizations[0]!.costBasis).toBeCloseTo(15000, 6);
    expect(realizations[0]!.pnlCapital).toBeCloseTo(21000 - 15000, 6);
  });

  it("does not collapse BTC and ETH into a single line when both lack an ISIN", () => {
    const orders: OrderRow[] = [
      cryptoOrder({
        id: "b-btc",
        instrumentId: "inst-btc",
        instrumentSymbol: "BTC",
        instrumentName: "BTC",
        quantity: 0.5,
        price: 40000,
        grossAmount: 20000,
      }),
      cryptoOrder({
        id: "b-eth",
        instrumentId: "inst-eth",
        instrumentSymbol: "ETH",
        instrumentName: "ETH",
        quantity: 2,
        price: 3000,
        grossAmount: 6000,
      }),
    ];

    const { positions } = replayTransactions(
      orders,
      { "inst-btc": eur(60000), "inst-eth": eur(4000) },
      TODAY,
    );

    expect(positions).toHaveLength(2);
    const symbols = positions.map((p) => p.instrumentSymbol).sort();
    expect(symbols).toEqual(["BTC", "ETH"]);
    const btc = positions.find((p) => p.instrumentSymbol === "BTC")!;
    const eth = positions.find((p) => p.instrumentSymbol === "ETH")!;
    expect(btc.qty).toBeCloseTo(0.5, 8);
    expect(eth.qty).toBeCloseTo(2, 8);
  });

  it("treats a Coinbase Convert (BTC → ETH) as one sell on BTC + one buy on ETH, surfacing two distinct positions", () => {
    const pairId = "convert-1";
    const orders: OrderRow[] = [
      cryptoOrder({
        id: "b-btc",
        tradeDate: "2024-01-01",
        instrumentId: "inst-btc",
        instrumentSymbol: "BTC",
        instrumentName: "BTC",
        quantity: 1,
        price: 50000,
        grossAmount: 50000,
      }),
      cryptoOrder({
        id: "conv-sell-btc",
        kind: "sell",
        tradeDate: "2024-06-01",
        instrumentId: "inst-btc",
        instrumentSymbol: "BTC",
        instrumentName: "BTC",
        quantity: 0.5,
        price: 60000,
        grossAmount: 30000,
        convertPairId: pairId,
      }),
      cryptoOrder({
        id: "conv-buy-eth",
        kind: "buy",
        tradeDate: "2024-06-01",
        instrumentId: "inst-eth",
        instrumentSymbol: "ETH",
        instrumentName: "ETH",
        quantity: 10,
        price: 3000,
        grossAmount: 30000,
        convertPairId: pairId,
      }),
    ];

    const { positions, realizations } = replayTransactions(
      orders,
      { "inst-btc": eur(65000), "inst-eth": eur(3500) },
      TODAY,
    );

    expect(positions).toHaveLength(2);
    const btc = positions.find((p) => p.instrumentSymbol === "BTC")!;
    const eth = positions.find((p) => p.instrumentSymbol === "ETH")!;
    // Remaining 0.5 BTC after the convert sell.
    expect(btc.qty).toBeCloseTo(0.5, 8);
    expect(btc.pru).toBeCloseTo(50000, 6);
    // 10 ETH bought via the convert leg.
    expect(eth.qty).toBeCloseTo(10, 8);
    expect(eth.pru).toBeCloseTo(3000, 6);

    // The BTC sell leg surfaces as a realization.
    expect(realizations).toHaveLength(1);
    expect(realizations[0]!.instrumentSymbol).toBe("BTC");
    expect(realizations[0]!.saleQty).toBeCloseTo(0.5, 8);
  });

  it("attributes Coinbase staking (kind=interest) to the underlying BTC line via instrumentId", () => {
    const orders: OrderRow[] = [
      cryptoOrder({
        id: "b-btc",
        tradeDate: "2024-01-01",
        instrumentId: "inst-btc",
        instrumentSymbol: "BTC",
        instrumentName: "BTC",
        quantity: 1,
        price: 50000,
        grossAmount: 50000,
      }),
      cryptoOrder({
        id: "stake-1",
        kind: "interest",
        tradeDate: "2024-03-01",
        instrumentId: "inst-btc",
        instrumentSymbol: "BTC",
        instrumentName: "BTC",
        quantity: null,
        price: null,
        grossAmount: 100,
      }),
    ];

    const { positions } = replayTransactions(
      orders,
      { "inst-btc": eur(60000) },
      TODAY,
    );

    expect(positions).toHaveLength(1);
    const btc = positions[0]!;
    expect(btc.instrumentSymbol).toBe("BTC");
    expect(btc.dividendsAttributed).toBeCloseTo(100, 6);
  });
});
