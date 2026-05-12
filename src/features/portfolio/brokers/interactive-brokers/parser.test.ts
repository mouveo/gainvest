import { describe, expect, it } from "vitest";

import { parseIbkrFlexXml } from "./parser";

const FRAMEWORK_OPEN = `<FlexQueryResponse>
<FlexStatements>
<FlexStatement>`;
const FRAMEWORK_CLOSE = `</FlexStatement>
</FlexStatements>
</FlexQueryResponse>`;

function buildXml(inner: string): string {
  return `${FRAMEWORK_OPEN}\n${inner}\n${FRAMEWORK_CLOSE}`;
}

describe("parseIbkrFlexXml — native amounts + fxRate", () => {
  it("keeps trade amounts in native currency and surfaces fxRateToBase", () => {
    const xml = buildXml(`
<Trades>
  <Trade
    buySell="BUY"
    isin="US0231351067"
    symbol="AMZN"
    description="AMAZON.COM INC"
    currency="USD"
    fxRateToBase="0.92"
    quantity="10"
    tradePrice="200"
    proceeds="-2000"
    ibCommission="-1.5"
    tradeDate="2024-05-12"
    ibExecID="exec-1"
  />
</Trades>`);

    const rows = parseIbkrFlexXml(xml, { support: "CTO" });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.kind).toBe("buy");
    expect(r.isin).toBe("US0231351067");
    expect(r.currency).toBe("USD");
    expect(r.fxRate).toBeCloseTo(0.92, 8);
    // grossAmount stays in native currency (USD), no longer pre-multiplied to EUR.
    expect(r.grossAmount).toBeCloseTo(2000, 8);
    expect(r.fees).toBeCloseTo(1.5, 8);
    expect(r.price).toBeCloseTo(200, 8);
    expect(r.quantity).toBeCloseTo(10, 8);
    expect(r.broker).toBe("Interactive Brokers");
  });

  it("preserves the IBKR raw type in notes for cash transactions (e.g. Bond Interest Paid)", () => {
    const xml = buildXml(`
<CashTransactions>
  <CashTransaction
    type="Bond Interest Paid"
    isin="US912828YV68"
    symbol="UST 4.125 2027"
    description="UST 4.125 11/15/27"
    currency="USD"
    fxRateToBase="0.91"
    amount="123.45"
    dateTime="2024-11-15"
    transactionID="tx-1"
  />
  <CashTransaction
    type="Broker Interest Received"
    currency="USD"
    fxRateToBase="0.91"
    amount="12.5"
    dateTime="2024-12-01"
    transactionID="tx-2"
  />
</CashTransactions>`);

    const rows = parseIbkrFlexXml(xml, { support: "CTO" });
    expect(rows).toHaveLength(2);

    const bondInt = rows.find((r) => r.isin === "US912828YV68")!;
    expect(bondInt.kind).toBe("interest");
    expect(bondInt.currency).toBe("USD");
    expect(bondInt.fxRate).toBeCloseTo(0.91, 8);
    expect(bondInt.grossAmount).toBeCloseTo(123.45, 8);
    expect(bondInt.notes).toContain("Bond Interest Paid");

    const brokerInt = rows.find((r) => r.notes?.includes("Broker Interest Received"))!;
    expect(brokerInt.kind).toBe("interest");
    expect(brokerInt.isin).toBeNull();
    expect(brokerInt.grossAmount).toBeCloseTo(12.5, 8);
  });

  it("capitalises BOND PURCHASE ACCRUED interest onto the originating buy", () => {
    const xml = buildXml(`
<Trades>
  <Trade
    buySell="BUY"
    assetCategory="BOND"
    subCategory="CORP"
    isin="US912828YV68"
    symbol="UST 4.125 2027"
    description="UST 4.125 11/15/27"
    currency="USD"
    fxRateToBase="0.91"
    quantity="10000"
    tradePrice="98.5"
    proceeds="-9850"
    ibCommission="-2"
    tradeDate="2024-06-01"
    ibExecID="exec-bond-1"
    tradeID="trade-bond-1"
  />
</Trades>
<CashTransactions>
  <CashTransaction
    type="Bond Interest Paid"
    isin="US912828YV68"
    symbol="UST 4.125 2027"
    description="UST 4.125 11/15/27 PURCHASE ACCRUED INTEREST"
    currency="USD"
    fxRateToBase="0.91"
    amount="-50.25"
    dateTime="2024-06-03"
    transactionID="tx-accrued-1"
    tradeID="trade-bond-1"
  />
</CashTransactions>`);

    const rows = parseIbkrFlexXml(xml, { support: "CTO" });

    expect(rows).toHaveLength(1);
    const buy = rows[0]!;
    expect(buy.kind).toBe("buy");
    expect(buy.assetClass).toBe("bond");
    // grossAmount: 9850 (native) + 50.25 accrued = 9900.25 USD
    expect(buy.grossAmount).toBeCloseTo(9900.25, 8);
    // totalAmount: gross 9850 + fees 2 + accrued 50.25 = 9902.25 USD
    expect(buy.totalAmount).toBeCloseTo(9902.25, 8);
    expect(buy.currency).toBe("USD");
    // No interest line emitted for the accrued purchase entry.
    expect(rows.find((r) => r.kind === "interest")).toBeUndefined();
  });

  it("keeps real BOND coupons as interest rows (positive Bond Interest Paid)", () => {
    const xml = buildXml(`
<Trades>
  <Trade
    buySell="BUY"
    assetCategory="BOND"
    subCategory="CORP"
    isin="US912828YV68"
    symbol="UST 4.125 2027"
    description="UST 4.125 11/15/27"
    currency="USD"
    fxRateToBase="0.91"
    quantity="10000"
    tradePrice="98.5"
    proceeds="-9850"
    ibCommission="-2"
    tradeDate="2024-06-01"
    ibExecID="exec-bond-1"
    tradeID="trade-bond-1"
  />
</Trades>
<CashTransactions>
  <CashTransaction
    type="Bond Interest Paid"
    isin="US912828YV68"
    symbol="UST 4.125 2027"
    description="UST 4.125 11/15/27 BOND COUPON"
    currency="USD"
    fxRateToBase="0.91"
    amount="206.25"
    dateTime="2024-11-15"
    transactionID="tx-coupon-1"
  />
</CashTransactions>`);

    const rows = parseIbkrFlexXml(xml, { support: "CTO" });
    const interest = rows.find((r) => r.kind === "interest")!;
    expect(interest).toBeDefined();
    expect(interest.grossAmount).toBeCloseTo(206.25, 8);
    expect(interest.notes).toContain("Bond Interest Paid");
  });

  it("classifies IBKR asset categories on each trade row", () => {
    const xml = buildXml(`
<Trades>
  <Trade
    buySell="BUY"
    assetCategory="STK"
    subCategory="COMMON"
    isin="US0231351067"
    symbol="AMZN"
    description="AMAZON.COM INC"
    currency="USD"
    fxRateToBase="0.92"
    quantity="10"
    tradePrice="200"
    proceeds="-2000"
    ibCommission="-1"
    tradeDate="2024-05-12"
    ibExecID="exec-stk"
  />
  <Trade
    buySell="BUY"
    assetCategory="STK"
    subCategory="ETF"
    isin="FR0010315770"
    symbol="LYX"
    description="LYXOR CORE ETF"
    currency="EUR"
    fxRateToBase="1"
    quantity="5"
    tradePrice="100"
    proceeds="-500"
    ibCommission="-0.5"
    tradeDate="2024-05-12"
    ibExecID="exec-etf"
  />
</Trades>`);

    const rows = parseIbkrFlexXml(xml, { support: "CTO" });
    const equity = rows.find((r) => r.isin === "US0231351067")!;
    const etf = rows.find((r) => r.isin === "FR0010315770")!;
    expect(equity.assetClass).toBe("equity");
    expect(etf.assetClass).toBe("etf");
  });

  it("maps Deposits/Withdrawals on amount sign", () => {
    const xml = buildXml(`
<CashTransactions>
  <CashTransaction
    type="Deposits/Withdrawals"
    currency="EUR"
    fxRateToBase="1"
    amount="10000"
    dateTime="2024-01-01"
    transactionID="tx-dep"
  />
  <CashTransaction
    type="Deposits/Withdrawals"
    currency="EUR"
    fxRateToBase="1"
    amount="-500"
    dateTime="2024-06-01"
    transactionID="tx-wd"
  />
</CashTransactions>`);

    const rows = parseIbkrFlexXml(xml, { support: "CTO" });
    const deposit = rows.find((r) => r.kind === "deposit")!;
    const withdrawal = rows.find((r) => r.kind === "withdrawal")!;

    expect(deposit.grossAmount).toBeCloseTo(10000, 8);
    expect(deposit.currency).toBe("EUR");
    expect(deposit.fxRate).toBe(1);

    expect(withdrawal.grossAmount).toBeCloseTo(500, 8);
  });
});
