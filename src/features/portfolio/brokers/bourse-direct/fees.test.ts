import { describe, expect, it } from "vitest";

import {
  computeBourseDirectFees,
  solveBourseDirectGrossFromTotal,
} from "./fees";

describe("computeBourseDirectFees — Euronext brackets", () => {
  it("uses 0,99 € for gross ≤ 500 €", () => {
    const f = computeBourseDirectFees(500, {
      market: "euronext",
      support: "CTO",
      isFREquity: false,
      isBuy: true,
    });
    expect(f.brokerage).toBe(0.99);
    expect(f.ttf).toBe(0);
  });

  it("uses 1,90 € for gross in ]500, 1000]", () => {
    const f = computeBourseDirectFees(500.01, {
      market: "euronext",
      support: "CTO",
      isFREquity: false,
      isBuy: true,
    });
    expect(f.brokerage).toBe(1.9);
  });

  it("applies 0,09 % above 4400 €", () => {
    const f = computeBourseDirectFees(10000, {
      market: "euronext",
      support: "CTO",
      isFREquity: false,
      isBuy: true,
    });
    expect(f.brokerage).toBe(9);
  });
});

describe("computeBourseDirectFees — US bracket", () => {
  it("uses flat 8,50 € up to 10 000 €", () => {
    const f = computeBourseDirectFees(9999, {
      market: "us",
      support: "CTO",
      isFREquity: false,
      isBuy: true,
    });
    expect(f.brokerage).toBe(8.5);
  });

  it("applies 0,09 % above 10 000 €", () => {
    const f = computeBourseDirectFees(20000, {
      market: "us",
      support: "CTO",
      isFREquity: false,
      isBuy: true,
    });
    expect(f.brokerage).toBe(18);
  });
});

describe("computeBourseDirectFees — TTF FR equity", () => {
  it("adds 0,3 % on FR equity buys", () => {
    const f = computeBourseDirectFees(10000, {
      market: "euronext",
      support: "CTO",
      isFREquity: true,
      isBuy: true,
    });
    expect(f.brokerage).toBe(9);
    expect(f.ttf).toBe(30);
    expect(f.total).toBe(39);
  });

  it("does not add TTF on sells", () => {
    const f = computeBourseDirectFees(10000, {
      market: "euronext",
      support: "CTO",
      isFREquity: true,
      isBuy: false,
    });
    expect(f.ttf).toBe(0);
  });
});

describe("computeBourseDirectFees — PEA cap", () => {
  it("caps PEA brokerage at 0,5 % of gross on Euronext", () => {
    // Sur 100 € en PEA, palier nominal = 0,99 € (1 %). Plafonné à 0,50 €.
    const f = computeBourseDirectFees(100, {
      market: "euronext",
      support: "PEA",
      isFREquity: true,
      isBuy: true,
    });
    expect(f.brokerage).toBe(0.5);
  });

  it("does not cap PEA on non-EU markets (US)", () => {
    const f = computeBourseDirectFees(1000, {
      market: "us",
      support: "PEA",
      isFREquity: false,
      isBuy: true,
    });
    expect(f.brokerage).toBe(8.5);
  });
});

describe("solveBourseDirectGrossFromTotal", () => {
  it("Amazon US: computes fees from resolved gross, not total proxy", () => {
    const { grossAmount, fees } = solveBourseDirectGrossFromTotal(50892.24, {
      market: "us",
      support: "CTO",
      isFREquity: false,
      isBuy: true,
    });
    // Naïve proxy : 50892.24 * 0.0009 = 45.80 €. Vrai calcul : ~45.76 €.
    expect(fees.brokerage).toBeLessThan(45.8);
    expect(fees.brokerage).toBeGreaterThan(45.7);
    expect(grossAmount).toBeGreaterThan(50845);
    expect(grossAmount).toBeLessThan(50847);
    // The resolved gross must reconstruct (within a cent) the input total.
    expect(grossAmount + fees.total).toBeCloseTo(50892.24, 1);
  });

  it("Euronext threshold: total = 500.99 € resolves to gross = 500 € with 0.99 € brokerage", () => {
    const { grossAmount, fees } = solveBourseDirectGrossFromTotal(500.99, {
      market: "euronext",
      support: "CTO",
      isFREquity: false,
      isBuy: true,
    });
    expect(grossAmount).toBeCloseTo(500, 1);
    expect(fees.brokerage).toBe(0.99);
  });

  it("Euronext above threshold: total = 502 € forces gross > 500 with 1.90 € brokerage", () => {
    const { grossAmount, fees } = solveBourseDirectGrossFromTotal(502, {
      market: "euronext",
      support: "CTO",
      isFREquity: false,
      isBuy: true,
    });
    expect(grossAmount).toBeGreaterThan(500);
    expect(fees.brokerage).toBe(1.9);
  });

  it("sell: gross = total + brokerage (no TTF on sells)", () => {
    const { grossAmount, fees } = solveBourseDirectGrossFromTotal(9991.5, {
      market: "us",
      support: "CTO",
      isFREquity: false,
      isBuy: false,
    });
    // total 9991.5 + brokerage 8.50 = 10000 (gross under threshold)
    expect(grossAmount).toBeCloseTo(10000, 1);
    expect(fees.brokerage).toBe(8.5);
    expect(fees.ttf).toBe(0);
  });
});
