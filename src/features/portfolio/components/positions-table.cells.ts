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
export type CurrentPriceRender = DashCell | PctParCell | EditableEurCell;

type PruInput = Pick<Position, "assetClass" | "pru" | "pruPctPar">;
type CurrentPriceInput = Pick<Position, "assetClass" | "currentPrice" | "currentPctPar">;
type PruGrossInput = Pick<Position, "assetClass" | "pruGross">;

function eurUnitText(value: number): string {
  return `${fmtNum(value, value < 50 ? 3 : 2)} €`;
}

function pctParText(value: number): string {
  return `${fmtPctPar(value)} (% par)`;
}

export function pruCell(p: PruInput): PruRender {
  if (p.assetClass === "cash") return { kind: "dash" };
  if (p.assetClass === "bond" && p.pruPctPar != null) {
    return { kind: "pctPar", text: pctParText(p.pruPctPar), value: p.pruPctPar };
  }
  return { kind: "eur", text: eurUnitText(p.pru), value: p.pru };
}

// PRU brut (gross of fees) is only meaningful as a per-unit EUR value today.
// Bonds don't carry a `pruGrossPctPar` aggregate, so we surface a dash rather
// than mixing units across rows.
export function pruGrossCell(p: PruGrossInput): PruRender {
  if (p.assetClass === "cash" || p.assetClass === "bond") return { kind: "dash" };
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
  return { kind: "editable-eur", value: p.currentPrice };
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
  const dp = order.price < 50 ? 3 : 2;
  return { kind: "eur", text: `${fmtNum(order.price, dp)} €` };
}
