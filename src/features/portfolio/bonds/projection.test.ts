import { describe, expect, it } from "vitest";

import { computeBondProjection } from "./projection";

describe("computeBondProjection — AMZN 4.65 11/20/35", () => {
  const projection = computeBondProjection({
    today: new Date("2026-05-12T00:00:00Z"),
    maturity: new Date("2035-11-20T00:00:00Z"),
    couponRatePct: 4.65,
    frequency: 2,
    faceValue: 56000,
    purchasePricePctPar: 98.948,
    currentPricePctPar: 97.383003,
    fxToEur: 0.85571,
  });

  it("counts the 20 remaining coupons", () => {
    expect(projection.remainingCoupons).toBe(20);
  });

  it("sums total coupons natively to 26040 USD", () => {
    expect(projection.totalCouponsNative).toBeCloseTo(26040, 6);
  });

  it("converts total coupons to ~22284 EUR", () => {
    expect(projection.totalCouponsEur).toBeCloseTo(22282.69, 1);
  });

  it("captures the capital gain at maturity in native and EUR", () => {
    const expectedNative = 56000 - (98.948 * 56000) / 100;
    expect(projection.capitalGainAtMaturityNative).toBeCloseTo(expectedNative, 6);
    expect(projection.capitalGainAtMaturityEur).toBeCloseTo(
      expectedNative * 0.85571,
      4,
    );
  });

  it("derives consistent YTMs at purchase and current price", () => {
    // Bought below par → YTM at purchase > coupon yield.
    expect(projection.ytmAtPurchase).toBeGreaterThan(0.046);
    expect(projection.ytmAtPurchase).toBeLessThan(0.052);
    // Current price below purchase → YTM current > YTM at purchase.
    expect(projection.ytmCurrent).toBeGreaterThan(projection.ytmAtPurchase);
    expect(projection.ytmCurrent).toBeLessThan(0.055);
  });

  it("exposes the underlying cashflow schedule", () => {
    expect(projection.cashflows).toHaveLength(20);
    expect(projection.cashflows[0]!.date).toBe("2026-05-20");
    expect(projection.cashflows[projection.cashflows.length - 1]!.date).toBe(
      "2035-11-20",
    );
  });
});
