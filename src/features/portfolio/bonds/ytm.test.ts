import { describe, expect, it } from "vitest";

import { generateBondCashflows } from "./cashflows";
import { computeYtm } from "./ytm";

describe("computeYtm", () => {
  const today = new Date("2015-01-01T00:00:00Z");
  const maturity = new Date("2025-01-01T00:00:00Z");

  function par5pct() {
    return generateBondCashflows({
      today,
      maturity,
      couponRatePct: 5,
      faceValue: 100,
      frequency: 2,
    });
  }

  it("returns about 5% for a par bond paying a 5% semi-annual coupon over 10 years", () => {
    const ytm = computeYtm({
      pricePctPar: 100,
      cashflows: par5pct(),
      today,
      faceValue: 100,
      frequency: 2,
    });
    expect(ytm).toBeCloseTo(0.05, 2);
  });

  it("returns about 5.7% for a 5% coupon bond trading at 95 over 10 years", () => {
    const ytm = computeYtm({
      pricePctPar: 95,
      cashflows: par5pct(),
      today,
      faceValue: 100,
      frequency: 2,
    });
    expect(ytm).toBeCloseTo(0.057, 2);
  });

  it("returns about 4.4% for a 5% coupon bond trading at 105 over 10 years", () => {
    const ytm = computeYtm({
      pricePctPar: 105,
      cashflows: par5pct(),
      today,
      faceValue: 100,
      frequency: 2,
    });
    expect(ytm).toBeCloseTo(0.044, 2);
  });

  it("returns about 3.6% for a 10-year zero-coupon bond priced at 70", () => {
    const zero = generateBondCashflows({
      today,
      maturity,
      couponRatePct: 0,
      faceValue: 100,
      frequency: 2,
    });
    const ytm = computeYtm({
      pricePctPar: 70,
      cashflows: zero,
      today,
      faceValue: 100,
      frequency: 2,
    });
    expect(ytm).toBeCloseTo(0.036, 2);
  });

  it("returns NaN when the price is invalid", () => {
    expect(
      computeYtm({
        pricePctPar: 0,
        cashflows: par5pct(),
        today,
        faceValue: 100,
        frequency: 2,
      }),
    ).toBeNaN();
  });

  it("returns NaN when there are no future cashflows", () => {
    expect(
      computeYtm({
        pricePctPar: 100,
        cashflows: [],
        today,
        faceValue: 100,
        frequency: 2,
      }),
    ).toBeNaN();
  });
});
