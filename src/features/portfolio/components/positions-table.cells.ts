// Pure display logic for the positions table — keeps the bond/cash/non-bond
// branching out of the React component so it can be exercised with plain
// Node Vitest, without a DOM or a renderer.

import type { Position } from "../aggregate";
import { fmtCcy, fmtNum, fmtPctPar } from "../format";

export type DashCell = { kind: "dash" };
export type PctParCell = { kind: "pctPar"; text: string; value: number };
export type EurTextCell = { kind: "eur"; text: string; value: number };
export type EditableEurCell = { kind: "editable-eur"; value: number };

export type PruRender = DashCell | PctParCell | EurTextCell;
// `eur` is used for crypto current price — read-only since CoinGecko is the
// source of truth and there's no manual override in V1.
export type CurrentPriceRender = DashCell | PctParCell | EditableEurCell | EurTextCell;

type PruInput = Pick<Position, "assetClass" | "pru" | "pruPctPar">;
type CurrentPriceInput = Pick<Position, "assetClass" | "currentPrice" | "currentPctPar">;
type PruGrossInput = Pick<Position, "assetClass" | "pruGross">;

function eurUnitText(value: number): string {
  return `${fmtNum(value, value < 50 ? 3 : 2)} €`;
}

// Crypto prices live on a much wider range than equities/ETFs (BTC ≈ €60 000
// down to memecoins below €0.01), so we adapt the decimal width: 2dp once
// the price clears one euro, 6dp below.
function cryptoUnitText(value: number): string {
  const dp = Math.abs(value) >= 1 ? 2 : 6;
  return `${fmtNum(value, dp)} €`;
}

function pctParText(value: number): string {
  return `${fmtPctPar(value)} (% par)`;
}

export function pruCell(p: PruInput): PruRender {
  if (p.assetClass === "cash") return { kind: "dash" };
  if (p.assetClass === "bond" && p.pruPctPar != null) {
    return { kind: "pctPar", text: pctParText(p.pruPctPar), value: p.pruPctPar };
  }
  if (p.assetClass === "crypto") {
    return { kind: "eur", text: cryptoUnitText(p.pru), value: p.pru };
  }
  return { kind: "eur", text: eurUnitText(p.pru), value: p.pru };
}

// PRU brut (gross of fees) is only meaningful as a per-unit EUR value today.
// Bonds don't carry a `pruGrossPctPar` aggregate, so we surface a dash rather
// than mixing units across rows.
export function pruGrossCell(p: PruGrossInput): PruRender {
  if (p.assetClass === "cash" || p.assetClass === "bond") return { kind: "dash" };
  if (p.assetClass === "crypto") {
    return {
      kind: "eur",
      text: cryptoUnitText(p.pruGross),
      value: p.pruGross,
    };
  }
  return {
    kind: "eur",
    text: fmtCcy(p.pruGross, p.pruGross < 50 ? 3 : 2),
    value: p.pruGross,
  };
}

export function currentPriceCell(p: CurrentPriceInput): CurrentPriceRender {
  if (p.assetClass === "cash") return { kind: "dash" };
  if (p.assetClass === "bond" && p.currentPctPar != null) {
    return {
      kind: "pctPar",
      text: pctParText(p.currentPctPar),
      value: p.currentPctPar,
    };
  }
  // Crypto: CoinGecko is the source of truth and there's no point letting the
  // user type a price by hand in V1 — surface a read-only EUR text.
  if (p.assetClass === "crypto") {
    return {
      kind: "eur",
      text: cryptoUnitText(p.currentPrice),
      value: p.currentPrice,
    };
  }
  return { kind: "editable-eur", value: p.currentPrice };
}

// Annualized yield (XIRR-based). Cash rows used to be forced to "dash" — now
// they surface their XIRR like every other position; the only "dash" path is
// a non-finite rate (e.g. trivial cash pouch with one deposit and no time
// elapsed, or an instrument line with degenerate flows).
export type AnnualizedYieldCell = { kind: "dash" } | { kind: "rate"; value: number };

type AnnualizedYieldInput = Pick<
  Position,
  | "xirrCapital"
  | "xirrTotal"
  | "xirrCapitalNetFees"
  | "xirrTotalNetFees"
  | "xirrCapitalReal"
  | "xirrTotalReal"
  | "xirrCapitalNetFeesReal"
  | "xirrTotalNetFeesReal"
>;

export type CellOpts = {
  withDividends: boolean;
  netOfFees: boolean;
  inflationAdjusted?: boolean;
};

export function pnlAnnualizedCell(
  p: AnnualizedYieldInput,
  opts: CellOpts,
): AnnualizedYieldCell {
  const real = opts.inflationAdjusted === true;
  const v = opts.netOfFees
    ? opts.withDividends
      ? real
        ? p.xirrTotalNetFeesReal
        : p.xirrTotalNetFees
      : real
        ? p.xirrCapitalNetFeesReal
        : p.xirrCapitalNetFees
    : opts.withDividends
      ? real
        ? p.xirrTotalReal
        : p.xirrTotal
      : real
        ? p.xirrCapitalReal
        : p.xirrCapital;
  return Number.isFinite(v) ? { kind: "rate", value: v } : { kind: "dash" };
}

// Picks the dedicated PnL field for the current (withDividends, netOfFees,
// inflationAdjusted) combination. The *NetFees variants are pre-computed
// upstream (realize.ts), so this never recomputes `base - holdingFees` in
// the UI — it just selects the right scalar.
export type PnlPick = Pick<
  Position,
  | "pnlCapital"
  | "pnlTotal"
  | "pnlCapitalReal"
  | "pnlTotalReal"
  | "pnlCapitalNetFeesReal"
  | "pnlTotalNetFeesReal"
  | "holdingFees"
>;

export function pickPnlValue(p: PnlPick, opts: CellOpts): number {
  const real = opts.inflationAdjusted === true;
  if (opts.netOfFees) {
    if (real) {
      return opts.withDividends ? p.pnlTotalNetFeesReal : p.pnlCapitalNetFeesReal;
    }
    const base = opts.withDividends ? p.pnlTotal : p.pnlCapital;
    return base - p.holdingFees;
  }
  if (real) {
    return opts.withDividends ? p.pnlTotalReal : p.pnlCapitalReal;
  }
  return opts.withDividends ? p.pnlTotal : p.pnlCapital;
}

// PnL % stays a dash for cash — a percent on a current balance has no
// well-defined denominator (cash mode uses XIRR for the rate of return view).
export type PnlPctCell = { kind: "dash" } | { kind: "pct"; value: number };

type PnlPctInput = Pick<Position, "assetClass" | "invested" | "investedReal"> & PnlPick;

export function pnlPctCell(
  p: PnlPctInput,
  opts: CellOpts,
): PnlPctCell {
  if (p.assetClass === "cash") return { kind: "dash" };
  const real = opts.inflationAdjusted === true;
  const numerator = pickPnlValue(p, opts);
  const denominator = real ? p.investedReal : p.invested;
  const value = denominator > 0 ? numerator / denominator : 0;
  if (!Number.isFinite(value)) return { kind: "dash" };
  return { kind: "pct", value };
}

// Custody / holding fees column. For cash rows, `holdingFees` is fed from
// (cash fees + tax withholdings) via the realize step — so this column also
// surfaces taxes on cash, which is intentional. Sub-cent values fall back to
// a dash to avoid noise.
export type HoldingFeesCell = { kind: "dash" } | { kind: "amount"; value: number };

export function holdingFeesCell(p: Pick<Position, "holdingFees">): HoldingFeesCell {
  return p.holdingFees > 0.005
    ? { kind: "amount", value: p.holdingFees }
    : { kind: "dash" };
}

export type OrderPriceCell =
  | { kind: "pctPar"; text: string }
  | { kind: "eur"; text: string };

export function orderPriceCell(
  order: { price: number },
  assetClass: string,
): OrderPriceCell {
  if (assetClass === "bond") {
    return { kind: "pctPar", text: pctParText(order.price) };
  }
  if (assetClass === "crypto") {
    return { kind: "eur", text: cryptoUnitText(order.price) };
  }
  const dp = order.price < 50 ? 3 : 2;
  return { kind: "eur", text: `${fmtNum(order.price, dp)} €` };
}
