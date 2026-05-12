import type { AssetClass } from "./types";

const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  equity: "Actions",
  etf: "ETF",
  fund: "ETF",
  bond: "Obligation",
  crypto: "Crypto",
  real_estate: "Immobilier",
  cash: "Liquidités",
};

export function labelAssetClass(value: string | null | undefined): string {
  if (!value) return "—";
  return ASSET_CLASS_LABEL[value as AssetClass] ?? value;
}

export function assetClassFilterValue(value: string | null | undefined): string {
  if (value === "etf" || value === "fund") return "etf";
  return value ?? "";
}

import type { FacetedFilterOption } from "@/components/data-table/data-table-faceted-filter";

export const ASSET_CLASS_FACETED_OPTIONS: FacetedFilterOption[] = [
  { label: "Actions", value: "equity" },
  { label: "ETF", values: ["etf", "fund"] },
  { label: "Obligation", value: "bond" },
  { label: "Crypto", value: "crypto" },
  { label: "Immobilier", value: "real_estate" },
  { label: "Liquidités", value: "cash" },
];
