import { describe, expect, it } from "vitest";

import type { PortfolioTotals } from "../aggregate";
import { getPositionsKpiCopy } from "./kpi-strip";

function totals(overrides: Partial<PortfolioTotals>): PortfolioTotals {
  return {
    invested: 0,
    valuation: 0,
    pnl: 0,
    pnlTotal: 0,
    pnlPct: 0,
    pnlPctTotal: 0,
    pnlAnnualized: 0,
    xirrCapital: 0,
    xirrTotal: 0,
    xirrCapitalNetFees: 0,
    xirrTotalNetFees: 0,
    dividendsTotal: 0,
    holdingFeesTotal: 0,
    yearsHeld: 0,
    totalFees: 0,
    lines: 0,
    kpiMode: "instruments",
    investedReal: 0,
    dividendsTotalReal: 0,
    holdingFeesTotalReal: 0,
    pnlReal: 0,
    pnlTotalReal: 0,
    pnlPctReal: 0,
    pnlPctTotalReal: 0,
    xirrCapitalReal: 0,
    xirrTotalReal: 0,
    xirrCapitalNetFeesReal: 0,
    xirrTotalNetFeesReal: 0,
    ...overrides,
  };
}

describe("getPositionsKpiCopy", () => {
  it("uses the instruments labels when kpiMode is instruments", () => {
    const copy = getPositionsKpiCopy(
      totals({
        kpiMode: "instruments",
        lines: 3,
        totalFees: 12.34,
        holdingFeesTotal: 0,
      }),
      { withDividends: false, netOfFees: false },
    );

    expect(copy.investedLabel).toBe("Capital investi");
    expect(copy.valuationLabel).toBe("Valorisation");
    expect(copy.pnlLabel).toBe("PnL latent");
    expect(copy.xirrLabel).toBe("PnL annualisé");
    expect(copy.xirrSubLabel).toBe("MWR · capital seul");
    expect(copy.investedSub).toContain("3 lignes");
    expect(copy.investedSub).toContain("frais cumulés");
  });

  it("appends 'net frais' to the xirr sub-label when netOfFees is true", () => {
    const copy = getPositionsKpiCopy(
      totals({ kpiMode: "instruments", lines: 1 }),
      { withDividends: true, netOfFees: true },
    );
    expect(copy.xirrSubLabel).toBe("MWR · avec divs · net frais");
  });

  it("switches to cash labels when kpiMode is cash", () => {
    const copy = getPositionsKpiCopy(
      totals({
        kpiMode: "cash",
        lines: 2,
        holdingFeesTotal: 5,
      }),
      { withDividends: false, netOfFees: false },
    );

    expect(copy.investedLabel).toBe("Solde cash courant");
    expect(copy.valuationLabel).toBe("Valorisation EUR");
    expect(copy.pnlLabel).toBe("Gain net");
    expect(copy.xirrLabel).toBe("PnL annualisé");
    expect(copy.xirrSubLabel).toBe("Rendement annualisé cash");
    expect(copy.investedSub).toContain("2 ligne(s)");
    expect(copy.investedSub).toContain("frais & taxes cumulés");
  });

  it("ignores withDividends and netOfFees toggles in cash mode", () => {
    const copy = getPositionsKpiCopy(
      totals({ kpiMode: "cash", lines: 1, holdingFeesTotal: 0 }),
      { withDividends: true, netOfFees: true },
    );
    expect(copy.xirrSubLabel).toBe("Rendement annualisé cash");
    expect(copy.pnlLabel).toBe("Gain net");
  });
});
