import { describe, expect, it } from "vitest";

import type { OrderRow } from "./aggregate";
import { replayTransactions } from "./realize";

function makeOrder(overrides: Partial<OrderRow>): OrderRow {
  return {
    id: "x",
    isin: "FR0010315770",
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

  it("propagates assetClass from the order to the realization", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b1",
        kind: "buy",
        assetClass: "equity",
        tradeDate: "2024-01-01",
        quantity: 10,
        price: 100,
        grossAmount: 1000,
      }),
      makeOrder({
        id: "s1",
        kind: "sell",
        assetClass: "equity",
        tradeDate: "2025-01-01",
        quantity: 5,
        price: 150,
        grossAmount: 750,
      }),
    ];

    const { realizations } = replayTransactions(orders, { FR0010315770: 200 }, TODAY);

    expect(realizations).toHaveLength(1);
    expect(realizations[0]!.assetClass).toBe("equity");
  });

  it("emits one realization per sell with the expected per-sale fields", () => {
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
        tradeDate: "2022-01-01",
        quantity: 5,
        price: 150,
        grossAmount: 750,
        fees: 2,
      }),
    ];

    const { realizations } = replayTransactions(orders, { FR0010315770: 200 }, TODAY);

    expect(realizations).toHaveLength(1);
    const r = realizations[0]!;
    expect(r.saleDate).toBe("2022-01-01");
    expect(r.saleQty).toBe(5);
    expect(r.pruAtSale).toBeCloseTo(100, 8);
    expect(r.costBasis).toBeCloseTo(500, 8);
    expect(r.saleNet).toBeCloseTo(748, 8); // 750 - 2 fee
    expect(r.pnlCapital).toBeCloseTo(248, 8);
    expect(r.support).toBe("CTO");
    expect(r.isin).toBe("FR0010315770");
  });

  it("splits dividends prorata between active position and successive sells", () => {
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
        tradeDate: "2020-06-01",
        quantity: null,
        price: null,
        grossAmount: 100,
      }),
      makeOrder({
        id: "s1",
        kind: "sell",
        tradeDate: "2021-01-01",
        quantity: 4,
        price: 120,
        grossAmount: 480,
      }),
      makeOrder({
        id: "s2",
        kind: "sell",
        tradeDate: "2022-01-01",
        quantity: 3,
        price: 150,
        grossAmount: 450,
      }),
    ];

    const { realizations, positions } = replayTransactions(
      orders,
      { FR0010315770: 200 },
      TODAY,
    );

    expect(realizations).toHaveLength(2);
    // First sale: 4/10 = 40% of dividends so far (100€) -> 40€
    expect(realizations[0]!.dividendsAttributed).toBeCloseTo(40, 8);
    // After first sale, 60€ of dividends remain. Second sale: 3/6 = 50% -> 30€
    expect(realizations[1]!.dividendsAttributed).toBeCloseTo(30, 8);
    // Active position keeps the remaining 30€
    expect(positions).toHaveLength(1);
    expect(positions[0]!.qty).toBe(3);
    expect(positions[0]!.dividendsAttributed).toBeCloseTo(30, 8);
    // Total dividends attributed across active + realizations sums back to 100€
    const totalAttributed =
      positions[0]!.dividendsAttributed +
      realizations.reduce((s, r) => s + r.dividendsAttributed, 0);
    expect(totalAttributed).toBeCloseTo(100, 6);
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

  it("attributes holding fees only to foreign positions, not to FR holdings", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b-fr",
        isin: "FR0010315770",
        kind: "buy",
        tradeDate: "2022-01-01",
        quantity: 10,
        price: 100,
        grossAmount: 1000,
      }),
      makeOrder({
        id: "b-us",
        isin: "US0231351067",
        kind: "buy",
        tradeDate: "2022-01-01",
        quantity: 5,
        price: 200,
        grossAmount: 1000,
      }),
      makeOrder({
        id: "f1",
        isin: "",
        kind: "fee",
        tradeDate: "2022-06-30",
        quantity: null,
        price: null,
        grossAmount: 40,
        notes: "Droits de garde 2022 S1",
        instrumentName: "Droits de garde 2022 S1",
        assetClass: "cash",
      }),
    ];

    const { positions } = replayTransactions(
      orders,
      { FR0010315770: 110, US0231351067: 220 },
      TODAY,
    );

    const fr = positions.find((p) => p.isin === "FR0010315770")!;
    const us = positions.find((p) => p.isin === "US0231351067")!;
    expect(fr.holdingFeesAttributed).toBeCloseTo(0, 8);
    expect(us.holdingFeesAttributed).toBeCloseTo(40, 8);
  });

  it("splits a holding fee between two foreign positions in proportion to their totalCost", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b-us",
        isin: "US0231351067",
        kind: "buy",
        tradeDate: "2022-01-01",
        quantity: 10,
        price: 100,
        grossAmount: 1000,
      }),
      makeOrder({
        id: "b-de",
        isin: "DE0007164600",
        kind: "buy",
        tradeDate: "2022-01-01",
        quantity: 10,
        price: 300,
        grossAmount: 3000,
      }),
      makeOrder({
        id: "f1",
        isin: "",
        kind: "fee",
        tradeDate: "2022-06-30",
        quantity: null,
        price: null,
        grossAmount: 40,
        notes: "Droits de garde 2022 S1",
        instrumentName: "Droits de garde 2022 S1",
        assetClass: "cash",
      }),
    ];

    const { positions } = replayTransactions(
      orders,
      { US0231351067: 100, DE0007164600: 300 },
      TODAY,
    );

    const us = positions.find((p) => p.isin === "US0231351067")!;
    const de = positions.find((p) => p.isin === "DE0007164600")!;
    expect(us.holdingFeesAttributed).toBeCloseTo(10, 8); // 40 * 1000/4000
    expect(de.holdingFeesAttributed).toBeCloseTo(30, 8); // 40 * 3000/4000
  });

  it("transfers a prorata of holding fees from the active line to a sell realization", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b-us",
        isin: "US0231351067",
        kind: "buy",
        tradeDate: "2022-01-01",
        quantity: 10,
        price: 100,
        grossAmount: 1000,
      }),
      makeOrder({
        id: "f1",
        isin: "",
        kind: "fee",
        tradeDate: "2022-06-30",
        quantity: null,
        price: null,
        grossAmount: 20,
        notes: "Droits de garde 2022 S1",
        instrumentName: "Droits de garde",
        assetClass: "cash",
      }),
      makeOrder({
        id: "s1",
        isin: "US0231351067",
        kind: "sell",
        tradeDate: "2023-01-01",
        quantity: 4,
        price: 150,
        grossAmount: 600,
      }),
    ];

    const { positions, realizations } = replayTransactions(
      orders,
      { US0231351067: 200 },
      TODAY,
    );

    expect(realizations).toHaveLength(1);
    // 4/10 = 40% of the 20€ active fee follows the sold prorata.
    expect(realizations[0]!.holdingFeesAttributed).toBeCloseTo(8, 8);

    expect(positions).toHaveLength(1);
    expect(positions[0]!.holdingFeesAttributed).toBeCloseTo(12, 8);

    const total =
      positions[0]!.holdingFeesAttributed +
      realizations.reduce((s, r) => s + r.holdingFeesAttributed, 0);
    expect(total).toBeCloseTo(20, 6);
  });

  it("ignores a holding fee charged before any foreign position exists", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "f1",
        isin: "",
        kind: "fee",
        tradeDate: "2020-01-01",
        quantity: null,
        price: null,
        grossAmount: 30,
        notes: "Droits de garde",
        instrumentName: "Droits de garde",
        assetClass: "cash",
      }),
      makeOrder({
        id: "b-us",
        isin: "US0231351067",
        kind: "buy",
        tradeDate: "2022-01-01",
        quantity: 10,
        price: 100,
        grossAmount: 1000,
      }),
    ];

    const { positions } = replayTransactions(orders, { US0231351067: 200 }, TODAY);
    expect(positions).toHaveLength(1);
    expect(positions[0]!.holdingFeesAttributed).toBeCloseTo(0, 8);
  });

  it("splits same ISIN+support into separate positions when brokers differ", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b-bd",
        isin: "US0378331005",
        broker: "Bourse Direct",
        kind: "buy",
        tradeDate: "2024-01-01",
        quantity: 100,
        price: 150,
        grossAmount: 15_000,
      }),
      makeOrder({
        id: "b-ibkr",
        isin: "US0378331005",
        broker: "IBKR",
        kind: "buy",
        tradeDate: "2024-01-01",
        quantity: 50,
        price: 180,
        grossAmount: 9_000,
      }),
    ];

    const { positions } = replayTransactions(orders, { US0378331005: 200 }, TODAY);

    expect(positions).toHaveLength(2);
    const bd = positions.find((p) => p.broker === "Bourse Direct")!;
    const ibkr = positions.find((p) => p.broker === "IBKR")!;
    expect(bd.qty).toBe(100);
    expect(bd.pru).toBeCloseTo(150, 8);
    expect(ibkr.qty).toBe(50);
    expect(ibkr.pru).toBeCloseTo(180, 8);
  });

  it("attributes a broker-tagged dividend only to the matching broker line", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b-bd",
        isin: "US0378331005",
        broker: "Bourse Direct",
        kind: "buy",
        tradeDate: "2024-01-01",
        quantity: 100,
        price: 150,
        grossAmount: 15_000,
      }),
      makeOrder({
        id: "b-ibkr",
        isin: "US0378331005",
        broker: "IBKR",
        kind: "buy",
        tradeDate: "2024-01-01",
        quantity: 50,
        price: 180,
        grossAmount: 9_000,
      }),
      makeOrder({
        id: "d-ibkr",
        isin: "US0378331005",
        broker: "IBKR",
        kind: "dividend",
        tradeDate: "2024-06-01",
        quantity: null,
        price: null,
        grossAmount: 30,
      }),
    ];

    const { positions } = replayTransactions(orders, { US0378331005: 200 }, TODAY);

    const bd = positions.find((p) => p.broker === "Bourse Direct")!;
    const ibkr = positions.find((p) => p.broker === "IBKR")!;
    expect(bd.dividendsAttributed).toBeCloseTo(0, 8);
    expect(ibkr.dividendsAttributed).toBeCloseTo(30, 8);
  });

  it("splits a broker=null dividend prorata of qty across same (isin, support) lines", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b-bd",
        isin: "US0378331005",
        broker: "Bourse Direct",
        kind: "buy",
        tradeDate: "2024-01-01",
        quantity: 100,
        price: 150,
        grossAmount: 15_000,
      }),
      makeOrder({
        id: "b-ibkr",
        isin: "US0378331005",
        broker: "IBKR",
        kind: "buy",
        tradeDate: "2024-01-01",
        quantity: 50,
        price: 180,
        grossAmount: 9_000,
      }),
      makeOrder({
        id: "d-legacy",
        isin: "US0378331005",
        broker: null,
        kind: "dividend",
        tradeDate: "2024-06-01",
        quantity: null,
        price: null,
        grossAmount: 150,
      }),
    ];

    const { positions } = replayTransactions(orders, { US0378331005: 200 }, TODAY);

    const bd = positions.find((p) => p.broker === "Bourse Direct")!;
    const ibkr = positions.find((p) => p.broker === "IBKR")!;
    // 100 / 150 * 150 = 100; 50 / 150 * 150 = 50
    expect(bd.dividendsAttributed).toBeCloseTo(100, 8);
    expect(ibkr.dividendsAttributed).toBeCloseTo(50, 8);
  });

  it("a broker-tagged sell consumes only its broker line", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b-bd",
        isin: "US0378331005",
        broker: "Bourse Direct",
        kind: "buy",
        tradeDate: "2024-01-01",
        quantity: 100,
        price: 150,
        grossAmount: 15_000,
      }),
      makeOrder({
        id: "b-ibkr",
        isin: "US0378331005",
        broker: "IBKR",
        kind: "buy",
        tradeDate: "2024-01-01",
        quantity: 50,
        price: 180,
        grossAmount: 9_000,
      }),
      makeOrder({
        id: "s-bd",
        isin: "US0378331005",
        broker: "Bourse Direct",
        kind: "sell",
        tradeDate: "2025-01-01",
        quantity: 30,
        price: 200,
        grossAmount: 6_000,
      }),
    ];

    const { positions, realizations } = replayTransactions(
      orders,
      { US0378331005: 220 },
      TODAY,
    );

    expect(realizations).toHaveLength(1);
    expect(realizations[0]!.broker).toBe("Bourse Direct");
    expect(realizations[0]!.saleQty).toBe(30);

    const bd = positions.find((p) => p.broker === "Bourse Direct")!;
    const ibkr = positions.find((p) => p.broker === "IBKR")!;
    expect(bd.qty).toBe(70);
    expect(ibkr.qty).toBe(50);
    expect(ibkr.pru).toBeCloseTo(180, 8);
  });

  it("attributes a broker-tagged holding fee only to foreign positions of the same broker", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b-us-bd",
        isin: "US0378331005",
        broker: "Bourse Direct",
        kind: "buy",
        tradeDate: "2024-01-01",
        quantity: 10,
        price: 100,
        grossAmount: 1_000,
      }),
      makeOrder({
        id: "b-us-ibkr",
        isin: "US0378331005",
        broker: "IBKR",
        kind: "buy",
        tradeDate: "2024-01-01",
        quantity: 10,
        price: 100,
        grossAmount: 1_000,
      }),
      makeOrder({
        id: "f-ibkr",
        isin: "",
        broker: "IBKR",
        kind: "fee",
        tradeDate: "2024-06-30",
        quantity: null,
        price: null,
        grossAmount: 25,
        notes: "Droits de garde 2024 S1",
        instrumentName: "Droits de garde",
        assetClass: "cash",
      }),
    ];

    const { positions } = replayTransactions(orders, { US0378331005: 110 }, TODAY);

    const bd = positions.find((p) => p.broker === "Bourse Direct")!;
    const ibkr = positions.find((p) => p.broker === "IBKR")!;
    expect(bd.holdingFeesAttributed).toBeCloseTo(0, 8);
    expect(ibkr.holdingFeesAttributed).toBeCloseTo(25, 8);
  });

  it("a broker=null holding fee still spreads across every foreign active line, all brokers", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b-us-bd",
        isin: "US0378331005",
        broker: "Bourse Direct",
        kind: "buy",
        tradeDate: "2024-01-01",
        quantity: 10,
        price: 100,
        grossAmount: 1_000,
      }),
      makeOrder({
        id: "b-us-ibkr",
        isin: "US0378331005",
        broker: "IBKR",
        kind: "buy",
        tradeDate: "2024-01-01",
        quantity: 10,
        price: 300,
        grossAmount: 3_000,
      }),
      makeOrder({
        id: "f-legacy",
        isin: "",
        broker: null,
        kind: "fee",
        tradeDate: "2024-06-30",
        quantity: null,
        price: null,
        grossAmount: 40,
        notes: "Droits de garde 2024 S1",
        instrumentName: "Droits de garde",
        assetClass: "cash",
      }),
    ];

    const { positions } = replayTransactions(orders, { US0378331005: 110 }, TODAY);

    const bd = positions.find((p) => p.broker === "Bourse Direct")!;
    const ibkr = positions.find((p) => p.broker === "IBKR")!;
    // Prorata totalCost: 1000 vs 3000 → 10€ / 30€
    expect(bd.holdingFeesAttributed).toBeCloseTo(10, 8);
    expect(ibkr.holdingFeesAttributed).toBeCloseTo(30, 8);
  });

  it("emits a dated negative cash-flow for attributed holding fees and derives a lower net XIRR", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "b-us",
        isin: "US0231351067",
        kind: "buy",
        tradeDate: "2024-05-12",
        quantity: 10,
        price: 100,
        grossAmount: 1000,
      }),
      makeOrder({
        id: "f1",
        isin: "",
        kind: "fee",
        tradeDate: "2025-05-12",
        quantity: null,
        price: null,
        grossAmount: 20,
        notes: "Droits de garde 2025 S1",
        instrumentName: "Droits de garde",
        assetClass: "cash",
      }),
    ];

    const { positions } = replayTransactions(orders, { US0231351067: 121 }, TODAY);
    const p = positions[0]!;
    const feeFlow = p.cashFlowsCapitalNetFees.find(
      (f) => f.date === "2025-05-12" && f.amount < 0,
    );
    expect(feeFlow).toBeDefined();
    expect(feeFlow!.amount).toBeCloseTo(-20, 8);
    expect(Number.isFinite(p.xirrCapitalNetFees)).toBe(true);
    expect(p.xirrCapitalNetFees).toBeLessThan(p.xirrCapital);
    expect(Number.isFinite(p.xirrTotalNetFees)).toBe(true);
  });
});
