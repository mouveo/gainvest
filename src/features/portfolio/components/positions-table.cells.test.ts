import { describe, expect, it } from "vitest";

import type { Position } from "../aggregate";

import {
  currentPriceCell,
  orderPriceCell,
  pruCell,
  pruGrossCell,
} from "./positions-table.cells";

function pos(overrides: Partial<Position> = {}): Position {
  return {
    key: "k",
    isin: "FR0010315770",
    instrumentId: null,
    preferredMic: null,
    preferredCurrency: null,
    support: "CTO",
    broker: null,
    instrumentName: "Test",
    assetClass: "etf",
    currency: "EUR",
    qty: 10,
    pru: 100,
    pruGross: 100,
    investedGross: 1000,
    pnlCapitalGross: 0,
    currentPrice: 110,
    pruPctPar: null,
    currentPctPar: null,
    valuation: 1100,
    invested: 1000,
    pnl: 100,
    pnlPct: 0.1,
    pnlAnnualized: 0,
    meanDate: new Date("2024-01-01"),
    daysHeld: 100,
    yearsHeld: 0.3,
    ordersCount: 1,
    buyCount: 1,
    sellCount: 0,
    totalFees: 0,
    orders: [],
    dividendsAttributed: 0,
    pnlCapital: 100,
    pnlTotal: 100,
    pnlPctCapital: 0.1,
    pnlPctTotal: 0.1,
    xirrCapital: 0.05,
    xirrTotal: 0.05,
    cashFlowsCapital: [],
    cashFlowsTotal: [],
    holdingFees: 0,
    cashFlowsCapitalNetFees: [],
    cashFlowsTotalNetFees: [],
    xirrCapitalNetFees: 0.05,
    xirrTotalNetFees: 0.05,
    ...overrides,
  };
}

describe("pruCell", () => {
  it("returns a `% par` text for bonds carrying a pruPctPar", () => {
    const cell = pruCell(
      pos({ assetClass: "bond", pru: 0.98948, pruPctPar: 98.948 }),
    );
    expect(cell.kind).toBe("pctPar");
    if (cell.kind === "pctPar") {
      expect(cell.value).toBeCloseTo(98.948, 8);
      expect(cell.text).toBe("98,948 (% par)");
    }
  });

  it("falls back to EUR for non-bond positions (ETF)", () => {
    const cell = pruCell(pos({ assetClass: "etf", pru: 100 }));
    expect(cell.kind).toBe("eur");
    if (cell.kind === "eur") {
      expect(cell.text).toBe("100,00 €");
    }
  });

  it("returns a dash for cash positions", () => {
    const cell = pruCell(pos({ assetClass: "cash" }));
    expect(cell.kind).toBe("dash");
  });

  it("falls back to EUR when a bond row is missing pruPctPar (defensive)", () => {
    const cell = pruCell(pos({ assetClass: "bond", pru: 0.98, pruPctPar: null }));
    expect(cell.kind).toBe("eur");
  });
});

describe("pruGrossCell", () => {
  it("renders an EUR value for ETF positions", () => {
    const cell = pruGrossCell(pos({ assetClass: "etf", pruGross: 99.5 }));
    expect(cell.kind).toBe("eur");
  });

  it("returns a dash for bonds (no pruGrossPctPar in V1)", () => {
    const cell = pruGrossCell(pos({ assetClass: "bond", pruGross: 0.98 }));
    expect(cell.kind).toBe("dash");
  });

  it("returns a dash for cash", () => {
    expect(pruGrossCell(pos({ assetClass: "cash" })).kind).toBe("dash");
  });
});

describe("currentPriceCell", () => {
  it("returns a `% par` readonly text for bonds", () => {
    const cell = currentPriceCell(
      pos({ assetClass: "bond", currentPrice: 97.383003, currentPctPar: 97.383003 }),
    );
    expect(cell.kind).toBe("pctPar");
    if (cell.kind === "pctPar") {
      expect(cell.value).toBeCloseTo(97.383003, 8);
      expect(cell.text).toBe("97,383 (% par)");
    }
  });

  it("returns an `editable-eur` marker for non-bond rows", () => {
    const cell = currentPriceCell(pos({ assetClass: "etf", currentPrice: 110 }));
    expect(cell.kind).toBe("editable-eur");
    if (cell.kind === "editable-eur") {
      expect(cell.value).toBe(110);
    }
  });

  it("returns a dash for cash", () => {
    expect(currentPriceCell(pos({ assetClass: "cash" })).kind).toBe("dash");
  });
});

describe("orderPriceCell", () => {
  it("renders bond order price as % par", () => {
    expect(orderPriceCell({ price: 98.948 }, "bond")).toEqual({
      kind: "pctPar",
      text: "98,948 (% par)",
    });
  });

  it("renders equity order price in EUR with 2 dp above 50", () => {
    expect(orderPriceCell({ price: 200 }, "equity")).toEqual({
      kind: "eur",
      text: "200,00 €",
    });
  });

  it("renders sub-50 prices with 3 dp", () => {
    expect(orderPriceCell({ price: 12.345 }, "etf")).toEqual({
      kind: "eur",
      text: "12,345 €",
    });
  });
});
