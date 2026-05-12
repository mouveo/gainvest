import { describe, expect, it } from "vitest";

import { parseBondSymbol } from "./parse-symbol";

describe("parseBondSymbol", () => {
  it("parses a 2-digit year description", () => {
    expect(parseBondSymbol("AMZN 4.65 11/20/35")).toEqual({
      couponRate: 4.65,
      maturityDate: "2035-11-20",
      frequency: 2,
    });
  });

  it("parses a 4-digit year description", () => {
    expect(parseBondSymbol("AAPL 3.0 02/08/2032")).toEqual({
      couponRate: 3,
      maturityDate: "2032-02-08",
      frequency: 2,
    });
  });

  it("parses a high coupon under 30 with a 2-digit year", () => {
    expect(parseBondSymbol("BOND 12.5 12/31/26")).toEqual({
      couponRate: 12.5,
      maturityDate: "2026-12-31",
      frequency: 2,
    });
  });

  it("accepts zero-coupon bonds", () => {
    expect(parseBondSymbol("ZERO 0 11/20/35")).toEqual({
      couponRate: 0,
      maturityDate: "2035-11-20",
      frequency: 2,
    });
  });

  it("returns null when the maturity is missing", () => {
    expect(parseBondSymbol("AMZN 4.65")).toBeNull();
  });

  it("returns null on an empty string", () => {
    expect(parseBondSymbol("")).toBeNull();
  });

  it("returns null when the coupon is out of range", () => {
    expect(parseBondSymbol("HIGH 999 06/15/30")).toBeNull();
  });

  it("returns null on an invalid calendar date", () => {
    expect(parseBondSymbol("BAD 4.0 02/30/30")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(parseBondSymbol("  AMZN 4.65 11/20/35  ")).toEqual({
      couponRate: 4.65,
      maturityDate: "2035-11-20",
      frequency: 2,
    });
  });
});
