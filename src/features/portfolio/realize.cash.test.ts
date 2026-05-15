import { describe, expect, it } from "vitest";

import type { CurrentPrice, OrderRow } from "./aggregate";
import { replayTransactions } from "./realize";

function eur(n: number): CurrentPrice {
  return { native: n, eur: n, currency: "EUR", fxToEur: 1 };
}

function makeOrder(overrides: Partial<OrderRow>): OrderRow {
  return {
    id: "x",
    isin: "",
    instrumentId: null,
    instrumentSymbol: null,
    convertPairId: null,
    preferredMic: null,
    preferredCurrency: null,
    instrumentName: "Cash",
    assetClass: "cash",
    currency: "EUR",
    kind: "deposit",
    tradeDate: "2025-01-01",
    tradeTime: null,
    quantity: null,
    price: null,
    grossAmount: 0,
    fees: 0,
    fxRate: 1,
    notes: null,
    executionVenue: null,
    broker: "Bourse Direct",
    support: "CTO",
    bondCouponRate: null,
    bondMaturityDate: null,
    bondCouponFrequency: null,
    ...overrides,
  };
}

const TODAY = new Date("2026-05-12T00:00:00Z");

describe("replayTransactions — cash replay", () => {
  it("replays an EUR cash flow chain to 8055.20", () => {
    // 10000 (dep) - 4000 (buy) + 2000 (sell) + 50 (div) + 12 (int) - 5 (fee) - 1.80 (tax) = 8055.20
    const orders: OrderRow[] = [
      makeOrder({
        id: "dep",
        kind: "deposit",
        grossAmount: 10000,
        tradeDate: "2025-01-01",
      }),
      makeOrder({
        id: "buy",
        kind: "buy",
        isin: "FR0010315770",
        instrumentName: "ETF Test",
        assetClass: "etf",
        quantity: 40,
        price: 100,
        grossAmount: 4000,
        tradeDate: "2025-02-01",
      }),
      makeOrder({
        id: "sell",
        kind: "sell",
        isin: "FR0010315770",
        instrumentName: "ETF Test",
        assetClass: "etf",
        quantity: 20,
        price: 100,
        grossAmount: 2000,
        tradeDate: "2025-03-01",
      }),
      makeOrder({
        id: "div",
        kind: "dividend",
        isin: "FR0010315770",
        instrumentName: "ETF Test",
        assetClass: "etf",
        grossAmount: 50,
        tradeDate: "2025-04-01",
      }),
      makeOrder({
        id: "int",
        kind: "interest",
        isin: "",
        grossAmount: 12,
        tradeDate: "2025-05-01",
      }),
      makeOrder({
        id: "fee",
        kind: "fee",
        isin: "",
        grossAmount: 5,
        tradeDate: "2025-06-01",
        notes: "Frais virement",
      }),
      makeOrder({
        id: "tax",
        kind: "tax",
        isin: "",
        grossAmount: 1.8,
        tradeDate: "2025-07-01",
      }),
    ];

    const { positions } = replayTransactions(
      orders,
      { FR0010315770: eur(100) },
      TODAY,
    );

    const cash = positions.find((p) => p.assetClass === "cash");
    expect(cash).toBeDefined();
    expect(cash!.qty).toBeCloseTo(8055.2, 6);
    expect(cash!.currency).toBe("EUR");
    expect(cash!.support).toBe("CTO");
    expect(cash!.broker).toBe("Bourse Direct");
    expect(cash!.isin).toBe("CASH-EUR-BOURSEDIRECT");
    // pnlTotal cash = interest(12) - fees(5) - tax(1.8) = 5.2
    expect(cash!.pnlTotal).toBeCloseTo(5.2, 6);
    expect(cash!.pnlCapital).toBe(0);
    // Cash row surfaces both cash fees and tax withholdings in totalFees /
    // holdingFeesAttributed so the UI can show every drag on cash in one
    // column.
    expect(cash!.totalFees).toBeCloseTo(6.8, 6);
    expect(cash!.holdingFeesAttributed).toBeCloseTo(6.8, 6);
    // Cash XIRR is now finite: flows = -10000 dep, +4000 buy, -2000 sell,
    // -50 dividend with ISIN, +8055.20 final → small positive yield.
    expect(Number.isFinite(cash!.xirrCapital)).toBe(true);
    expect(Number.isFinite(cash!.xirrTotal)).toBe(true);
  });

  it("emits one cash position per (broker, currency) on a multi-currency import", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "dep-eur",
        kind: "deposit",
        currency: "EUR",
        fxRate: 1,
        grossAmount: 5000,
        broker: "Interactive Brokers",
        tradeDate: "2025-01-01",
      }),
      makeOrder({
        id: "dep-usd",
        kind: "deposit",
        currency: "USD",
        fxRate: 0.92,
        grossAmount: 10000,
        broker: "Interactive Brokers",
        tradeDate: "2025-01-02",
      }),
      makeOrder({
        id: "buy-usd",
        kind: "buy",
        isin: "US0231351067",
        instrumentName: "AMZN",
        assetClass: "equity",
        currency: "USD",
        fxRate: 0.92,
        quantity: 10,
        price: 200,
        grossAmount: 2000,
        broker: "Interactive Brokers",
        tradeDate: "2025-02-01",
      }),
    ];

    const fxByCurrency = { EUR: 1, USD: 0.95 };
    const { positions } = replayTransactions(
      orders,
      { US0231351067: eur(220) },
      TODAY,
      fxByCurrency,
    );

    const cashLines = positions.filter((p) => p.assetClass === "cash");
    expect(cashLines).toHaveLength(2);

    const eurCash = cashLines.find((p) => p.currency === "EUR")!;
    const usd = cashLines.find((p) => p.currency === "USD")!;

    expect(eurCash.qty).toBeCloseTo(5000, 6);
    expect(eurCash.currentPrice).toBe(1);
    expect(eurCash.valuation).toBeCloseTo(5000, 6);

    // USD: 10000 deposit - 2000 buy = 8000 USD. Valuation in EUR = 8000 * 0.95
    expect(usd.qty).toBeCloseTo(8000, 6);
    expect(usd.currentPrice).toBe(0.95);
    expect(usd.valuation).toBeCloseTo(7600, 6);
    expect(usd.isin).toBe("CASH-USD-INTERACTIVEBROKERS");
  });

  it("interest with ISIN feeds the instrument and bumps cash without a duplicate cash KPI", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "dep",
        kind: "deposit",
        grossAmount: 5000,
        tradeDate: "2024-01-01",
      }),
      makeOrder({
        id: "buy",
        kind: "buy",
        isin: "US912828YV68",
        instrumentName: "US Treasury 2027",
        assetClass: "bond",
        quantity: 50,
        price: 100,
        grossAmount: 5000,
        tradeDate: "2024-02-01",
      }),
      makeOrder({
        id: "int",
        kind: "interest",
        isin: "US912828YV68",
        instrumentName: "US Treasury 2027",
        assetClass: "bond",
        grossAmount: 75,
        tradeDate: "2024-08-01",
      }),
    ];

    const { positions } = replayTransactions(
      orders,
      { US912828YV68: eur(102) },
      TODAY,
    );

    const cash = positions.find((p) => p.assetClass === "cash")!;
    const bond = positions.find((p) => p.isin === "US912828YV68")!;

    // Cash bumps by 75 (interest received), but cash interest KPI stays 0
    // because the interest was attributed to the bond instrument.
    expect(cash.qty).toBeCloseTo(75, 6); // 5000 - 5000 + 75
    expect(cash.pnlTotal).toBeCloseTo(0, 6);

    // The bond receives the 75 as a dividend-equivalent flow.
    expect(bond.dividendsAttributed).toBeCloseTo(75, 6);
  });

  it("computes a finite XIRR ≈ 90/200000 for deposit + interest + tax", () => {
    // J-365 = 2025-05-12 (TODAY is 2026-05-12).
    // Deposit 200000 → external flow -200000.
    // Interest 100 (no ISIN) → balance only, NOT in externalFlows.
    // Tax 10 → balance only, NOT in externalFlows.
    // Final balance = 200000 + 100 - 10 = 200090.
    const orders: OrderRow[] = [
      makeOrder({
        id: "dep",
        kind: "deposit",
        grossAmount: 200000,
        tradeDate: "2025-05-12",
      }),
      makeOrder({
        id: "int",
        kind: "interest",
        isin: "",
        grossAmount: 100,
        tradeDate: "2025-11-01",
      }),
      makeOrder({
        id: "tax",
        kind: "tax",
        isin: "",
        grossAmount: 10,
        tradeDate: "2025-12-01",
      }),
    ];

    const { positions } = replayTransactions(orders, {}, TODAY);
    const cash = positions.find((p) => p.assetClass === "cash")!;
    expect(cash).toBeDefined();
    expect(cash.qty).toBeCloseTo(200090, 6);
    // XIRR ≈ 90/200000 = 0.00045 over one year (~0.045%).
    expect(Number.isFinite(cash.xirrCapital)).toBe(true);
    expect(cash.xirrCapital).toBeGreaterThan(0);
    expect(cash.xirrCapital).toBeCloseTo(90 / 200000, 4);
    // Same yield in every variant — cash has no capital/total split.
    expect(cash.xirrTotal).toBe(cash.xirrCapital);
    expect(cash.xirrCapitalNetFees).toBe(cash.xirrCapital);
    expect(cash.xirrTotalNetFees).toBe(cash.xirrCapital);
    // Tax surfaces in the cash row's totalFees / holdingFeesAttributed.
    expect(cash.totalFees).toBeCloseTo(10, 6);
    expect(cash.holdingFeesAttributed).toBeCloseTo(10, 6);
  });

  it("computes a positive XIRR for a deposit + buy + cash interest arbitrage", () => {
    // Deposit 100000, buy instrument 60000, earn 1000 cash interest → 41000 left.
    // External flows: [-100000 deposit, +60000 buy]. Final value = 41000.
    // Sum = +1000 → small positive yield, NOT strongly negative.
    const orders: OrderRow[] = [
      makeOrder({
        id: "dep",
        kind: "deposit",
        grossAmount: 100000,
        tradeDate: "2025-05-12",
      }),
      makeOrder({
        id: "buy",
        kind: "buy",
        isin: "FR0010315770",
        instrumentName: "ETF Test",
        assetClass: "etf",
        quantity: 600,
        price: 100,
        grossAmount: 60000,
        tradeDate: "2025-06-01",
      }),
      makeOrder({
        id: "int",
        kind: "interest",
        isin: "",
        grossAmount: 1000,
        tradeDate: "2025-12-01",
      }),
    ];

    const { positions } = replayTransactions(
      orders,
      { FR0010315770: eur(100) },
      TODAY,
    );
    const cash = positions.find((p) => p.assetClass === "cash")!;
    expect(cash).toBeDefined();
    expect(cash.qty).toBeCloseTo(41000, 6);
    expect(Number.isFinite(cash.xirrCapital)).toBe(true);
    expect(cash.xirrCapital).toBeGreaterThan(0);
    // Sanity check: not in pathological territory.
    expect(cash.xirrCapital).toBeLessThan(1);
    expect(cash.xirrCapital).toBeGreaterThan(-0.1);
  });

  it("does not emit a cash position when no deposit/withdrawal happened", () => {
    const orders: OrderRow[] = [
      makeOrder({
        id: "buy",
        kind: "buy",
        isin: "FR0010315770",
        instrumentName: "ETF",
        assetClass: "etf",
        quantity: 10,
        price: 100,
        grossAmount: 1000,
        broker: null,
        tradeDate: "2025-01-01",
      }),
    ];

    const { positions } = replayTransactions(orders, { FR0010315770: eur(110) }, TODAY);
    const cashLines = positions.filter((p) => p.assetClass === "cash");
    expect(cashLines).toHaveLength(0);
    expect(positions).toHaveLength(1);
  });
});
