import { describe, expect, it } from "vitest";

import type { Position } from "../aggregate";

import {
  currentPriceCell,
  holdingFeesCell,
  orderPriceCell,
  pnlAnnualizedCell,
  pnlPctCell,
  pruCell,
  pruGrossCell,
} from "./positions-table.cells";

function pos(overrides: Partial<Position> = {}): Position {
  return {
    key: "k",
    isin: "FR0010315770",
    instrumentId: null,
    instrumentSymbol: null,
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
    divYieldAnnualized: null,
    xirrCapital: 0.05,
    xirrTotal: 0.05,
    cashFlowsCapital: [],
    cashFlowsTotal: [],
    holdingFees: 0,
    cashFlowsCapitalNetFees: [],
    cashFlowsTotalNetFees: [],
    xirrCapitalNetFees: 0.05,
    xirrTotalNetFees: 0.05,
    bondCouponRate: null,
    bondMaturityDate: null,
    bondCouponFrequency: null,
    fxToEur: 1,
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

describe("pnlAnnualizedCell", () => {
  it("returns the XIRR rate for a cash row with a finite yield", () => {
    const cell = pnlAnnualizedCell(
      pos({
        assetClass: "cash",
        xirrCapital: 0.045,
        xirrTotal: 0.045,
        xirrCapitalNetFees: 0.045,
        xirrTotalNetFees: 0.045,
      }),
      { withDividends: false, netOfFees: false },
    );
    expect(cell).toEqual({ kind: "rate", value: 0.045 });
  });

  it("returns a dash for a cash row whose XIRR is NaN", () => {
    const cell = pnlAnnualizedCell(
      pos({
        assetClass: "cash",
        xirrCapital: Number.NaN,
        xirrTotal: Number.NaN,
        xirrCapitalNetFees: Number.NaN,
        xirrTotalNetFees: Number.NaN,
      }),
      { withDividends: false, netOfFees: false },
    );
    expect(cell.kind).toBe("dash");
  });

  it("picks xirrTotalNetFees when both toggles are on", () => {
    const cell = pnlAnnualizedCell(
      pos({
        xirrCapital: 0.1,
        xirrTotal: 0.2,
        xirrCapitalNetFees: 0.05,
        xirrTotalNetFees: 0.15,
      }),
      { withDividends: true, netOfFees: true },
    );
    expect(cell).toEqual({ kind: "rate", value: 0.15 });
  });
});

describe("pnlPctCell", () => {
  it("returns a dash for cash regardless of values", () => {
    expect(
      pnlPctCell(
        pos({
          assetClass: "cash",
          pnlTotal: 50,
          pnlCapital: 0,
          invested: 1000,
          holdingFees: 0,
        }),
        { withDividends: false, netOfFees: false },
      ).kind,
    ).toBe("dash");
  });

  it("returns the capital pnl ratio for a non-cash position", () => {
    const cell = pnlPctCell(
      pos({
        assetClass: "etf",
        pnlCapital: 100,
        pnlTotal: 120,
        invested: 1000,
        holdingFees: 0,
      }),
      { withDividends: false, netOfFees: false },
    );
    expect(cell).toEqual({ kind: "pct", value: 0.1 });
  });

  it("subtracts holding fees when netOfFees is true", () => {
    const cell = pnlPctCell(
      pos({
        assetClass: "etf",
        pnlCapital: 100,
        pnlTotal: 100,
        invested: 1000,
        holdingFees: 40,
      }),
      { withDividends: false, netOfFees: true },
    );
    expect(cell).toEqual({ kind: "pct", value: 0.06 });
  });
});

describe("holdingFeesCell", () => {
  it("returns the aggregated amount when above the cent threshold", () => {
    expect(holdingFeesCell(pos({ holdingFees: 6.8 }))).toEqual({
      kind: "amount",
      value: 6.8,
    });
  });

  it("returns a dash for sub-cent or zero values", () => {
    expect(holdingFeesCell(pos({ holdingFees: 0 })).kind).toBe("dash");
    expect(holdingFeesCell(pos({ holdingFees: 0.004 })).kind).toBe("dash");
  });

  it("surfaces the aggregated fees+taxes for a cash row", () => {
    // Per LOT 1 the realize step feeds cash holdingFees with (cashFees + taxes).
    const cell = holdingFeesCell(pos({ assetClass: "cash", holdingFees: 5 + 1.8 }));
    expect(cell).toEqual({ kind: "amount", value: 6.8 });
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
