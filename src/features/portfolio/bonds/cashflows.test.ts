import { describe, expect, it } from "vitest";

import { generateBondCashflows } from "./cashflows";

describe("generateBondCashflows", () => {
  it("generates the AMZN 4.65 11/20/35 semi-annual schedule from today", () => {
    const flows = generateBondCashflows({
      today: new Date("2026-05-12T00:00:00Z"),
      maturity: new Date("2035-11-20T00:00:00Z"),
      couponRatePct: 4.65,
      faceValue: 56000,
      frequency: 2,
    });

    expect(flows).toHaveLength(20);
    expect(flows[0]!.date).toBe("2026-05-20");
    expect(flows[0]!.amount).toBeCloseTo(1302, 8);
    expect(flows[0]!.kind).toBe("coupon");

    const last = flows[flows.length - 1]!;
    expect(last.date).toBe("2035-11-20");
    expect(last.kind).toBe("maturity");
    expect(last.couponAmount).toBeCloseTo(1302, 8);
    expect(last.principalAmount).toBeCloseTo(56000, 8);
    expect(last.amount).toBeCloseTo(57302, 8);
  });

  it("returns a single maturity flow for a zero-coupon bond", () => {
    const flows = generateBondCashflows({
      today: new Date("2026-05-12T00:00:00Z"),
      maturity: new Date("2036-05-12T00:00:00Z"),
      couponRatePct: 0,
      faceValue: 1000,
      frequency: 2,
    });

    expect(flows).toHaveLength(1);
    expect(flows[0]!.kind).toBe("maturity");
    expect(flows[0]!.couponAmount).toBe(0);
    expect(flows[0]!.principalAmount).toBe(1000);
    expect(flows[0]!.amount).toBe(1000);
  });

  it("returns an empty array when maturity is in the past", () => {
    const flows = generateBondCashflows({
      today: new Date("2026-05-12T00:00:00Z"),
      maturity: new Date("2020-01-01T00:00:00Z"),
      couponRatePct: 5,
      faceValue: 1000,
      frequency: 2,
    });

    expect(flows).toEqual([]);
  });
});
