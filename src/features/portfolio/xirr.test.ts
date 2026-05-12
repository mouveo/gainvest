import { describe, expect, it } from "vitest";

import { xirr, type Flow } from "./xirr";

describe("xirr", () => {
  it("returns ~10% for -1000 then +1100 one year later", () => {
    const flows: Flow[] = [
      { date: "2020-01-01", amount: -1000 },
      { date: "2021-01-01", amount: 1100 },
    ];
    const r = xirr(flows);
    expect(r).toBeCloseTo(0.1, 3);
  });

  it("returns NaN with fewer than two flows", () => {
    expect(xirr([])).toBeNaN();
    expect(xirr([{ date: "2020-01-01", amount: -100 }])).toBeNaN();
  });

  it("returns NaN when no sign change in flows", () => {
    expect(
      xirr([
        { date: "2020-01-01", amount: -100 },
        { date: "2021-01-01", amount: -50 },
      ]),
    ).toBeNaN();
    expect(
      xirr([
        { date: "2020-01-01", amount: 100 },
        { date: "2021-01-01", amount: 50 },
      ]),
    ).toBeNaN();
  });

  it("handles a deeply negative return (loss)", () => {
    const r = xirr([
      { date: "2020-01-01", amount: -1000 },
      { date: "2021-01-01", amount: 500 },
    ]);
    expect(r).toBeCloseTo(-0.5, 2);
  });

  it("handles multi-flow streams", () => {
    const r = xirr([
      { date: "2020-01-01", amount: -1000 },
      { date: "2020-07-01", amount: -1000 },
      { date: "2022-01-01", amount: 2200 },
    ]);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(0.5);
  });
});
