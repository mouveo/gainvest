import { describe, expect, it } from "vitest";

import { parseCoinbaseCsv } from "./parser";

const HEADER =
  "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,EUR Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes";

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

describe("parseCoinbaseCsv", () => {
  it("returns a warning when the header is unrecognised", () => {
    const result = parseCoinbaseCsv("Foo,Bar\n1,2", { support: "CRYPTO" });
    expect(result.rows).toEqual([]);
    expect(result.warnings[0]).toMatch(/Header CSV Coinbase non reconnu/);
  });

  it("parses a Buy EUR row as kind=buy with crypto fields", () => {
    const result = parseCoinbaseCsv(
      csv('2024-03-12T08:42:11Z,Buy,BTC,0.5,EUR,"60000,00","30000,00","30100,00","100,00",'),
      { support: "CRYPTO" },
    );

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.kind).toBe("buy");
    expect(row.assetClass).toBe("crypto");
    expect(row.symbol).toBe("BTC");
    expect(row.isin).toBeNull();
    expect(row.date).toBe("2024-03-12");
    expect(row.quantity).toBe(0.5);
    expect(row.price).toBe(60000);
    expect(row.grossAmount).toBe(30000);
    expect(row.totalAmount).toBe(30100);
    expect(row.fees).toBe(100);
    expect(row.currency).toBe("EUR");
    expect(row.fxRate).toBe(1);
    expect(row.needsAttention).toBe(false);
    expect(row.broker).toBe("Coinbase");
  });

  it("parses a Sell EUR row as kind=sell", () => {
    const result = parseCoinbaseCsv(
      csv("2024-04-01T10:00:00Z,Sell,ETH,2,EUR,3000,6000,5990,10,"),
      { support: "CRYPTO" },
    );

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.kind).toBe("sell");
    expect(row.symbol).toBe("ETH");
    expect(row.quantity).toBe(2);
    expect(row.price).toBe(3000);
    expect(row.fees).toBe(10);
  });

  it("emits two ParsedRow with the same convertPairId for a Convert pair", () => {
    const result = parseCoinbaseCsv(
      csv(
        '2024-05-01T12:00:00Z,Convert,BTC,0.1,EUR,60000,6000,6000,0,"Converted 0.1 BTC to 1.5 ETH"',
        '2024-05-01T12:00:00Z,Convert,ETH,1.5,EUR,4000,6000,6000,0,"Converted 0.1 BTC to 1.5 ETH"',
      ),
      { support: "CRYPTO" },
    );

    expect(result.rows).toHaveLength(2);
    const [src, dst] = result.rows;
    expect(src!.kind).toBe("sell");
    expect(src!.symbol).toBe("BTC");
    expect(dst!.kind).toBe("buy");
    expect(dst!.symbol).toBe("ETH");
    expect(src!.convertPairId).toBeTruthy();
    expect(src!.convertPairId).toBe(dst!.convertPairId);
  });

  it("does NOT duplicate rows for a Convert pair (one row in == one row out per leg)", () => {
    const result = parseCoinbaseCsv(
      csv(
        '2024-05-01T12:00:00Z,Convert,BTC,0.1,EUR,60000,6000,6000,0,"Converted 0.1 BTC to 1.5 ETH"',
        '2024-05-01T12:00:00Z,Convert,ETH,1.5,EUR,4000,6000,6000,0,"Converted 0.1 BTC to 1.5 ETH"',
      ),
      { support: "CRYPTO" },
    );
    // 2 CSV lines for one logical conversion → 2 ParsedRow (not 4).
    expect(result.rows).toHaveLength(2);
  });

  it("maps Staking Reward to kind=interest", () => {
    const result = parseCoinbaseCsv(
      csv("2024-03-15T00:00:00Z,Staking Reward,ETH,0.01,EUR,3000,30,30,0,"),
      { support: "CRYPTO" },
    );
    expect(result.rows[0]!.kind).toBe("interest");
    expect(result.rows[0]!.needsAttention).toBe(false);
  });

  it("maps Send to kind=withdrawal", () => {
    const result = parseCoinbaseCsv(
      csv("2024-06-01T00:00:00Z,Send,BTC,0.01,EUR,60000,600,600,0,"),
      { support: "CRYPTO" },
    );
    expect(result.rows[0]!.kind).toBe("withdrawal");
  });

  it("maps Receive to kind=deposit and flags needsAttention", () => {
    const result = parseCoinbaseCsv(
      csv("2024-06-01T00:00:00Z,Receive,BTC,0.01,EUR,60000,600,600,0,"),
      { support: "CRYPTO" },
    );
    const row = result.rows[0]!;
    expect(row.kind).toBe("deposit");
    expect(row.needsAttention).toBe(true);
    expect(row.attentionReason).toMatch(/Receive/);
  });

  it("flags unknown transaction types with needsAttention", () => {
    const result = parseCoinbaseCsv(
      csv("2024-06-01T00:00:00Z,Mystery Drop,BTC,0.01,EUR,60000,600,600,0,"),
      { support: "CRYPTO" },
    );
    const row = result.rows[0]!;
    expect(row.needsAttention).toBe(true);
    expect(row.attentionReason).toMatch(/Type Coinbase inconnu/);
  });

  it("flags USD CSVs with attention until an FX rate is supplied", () => {
    const headerUsd =
      "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,USD Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes";
    const text = [
      headerUsd,
      "2024-03-12T08:42:11Z,Buy,BTC,0.5,USD,60000,30000,30100,100,",
    ].join("\n");
    const result = parseCoinbaseCsv(text, { support: "CRYPTO" });
    const row = result.rows[0]!;
    expect(row.currency).toBe("USD");
    expect(row.needsAttention).toBe(true);
    expect(row.attentionReason).toMatch(/USD/);
  });

  it("maps Advanced Trade Buy/Sell to buy/sell", () => {
    const result = parseCoinbaseCsv(
      csv(
        "2024-03-12T08:42:11Z,Advanced Trade Buy,BTC,0.1,EUR,60000,6000,6010,10,",
        "2024-03-13T08:42:11Z,Advanced Trade Sell,BTC,0.1,EUR,60500,6050,6040,10,",
      ),
      { support: "CRYPTO" },
    );
    expect(result.rows.map((r) => r.kind)).toEqual(["buy", "sell"]);
  });

  it("skips preamble lines and locates the real header further down", () => {
    const text = [
      "Coinbase",
      "Transactions History Report",
      "",
      HEADER,
      "2024-03-12T08:42:11Z,Buy,BTC,0.5,EUR,60000,30000,30100,100,",
    ].join("\n");
    const result = parseCoinbaseCsv(text, { support: "CRYPTO" });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.kind).toBe("buy");
  });
});
