"use server";

// Manual backfill: scans existing bond instruments and fills missing bond_*
// columns by re-parsing the stored `name` (preferred) then `symbol`. Intended
// for one-off ops/admin use after the metadata columns were introduced — it
// is NOT wired into any auto-run path. Invoke explicitly from a debug page
// or a one-shot script. Manual edits already in DB are preserved: a column
// is only updated when its current value is NULL.

import { createClient } from "@/lib/supabase/server";

import { parseBondSymbol, type BondMetadata } from "./parse-symbol";

export type BondBackfillResult = {
  updated: number;
  failed: string[];
};

export async function backfillBondMetadata(): Promise<BondBackfillResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("instruments")
    .select(
      "id, isin, name, symbol, bond_coupon_rate, bond_maturity_date, bond_coupon_frequency",
    )
    .eq("asset_class", "bond")
    .or(
      "bond_coupon_rate.is.null,bond_maturity_date.is.null,bond_coupon_frequency.is.null",
    );

  if (error) {
    return { updated: 0, failed: [`select failed: ${error.message}`] };
  }

  const failed: string[] = [];
  let updated = 0;

  for (const row of data ?? []) {
    const meta: BondMetadata | null =
      parseBondSymbol(row.name ?? "") ?? parseBondSymbol(row.symbol ?? "");
    if (!meta) {
      failed.push(row.isin ?? row.id);
      continue;
    }

    const patch: {
      bond_coupon_rate?: number;
      bond_maturity_date?: string;
      bond_coupon_frequency?: number;
    } = {};
    if (row.bond_coupon_rate == null) patch.bond_coupon_rate = meta.couponRate;
    if (row.bond_maturity_date == null) patch.bond_maturity_date = meta.maturityDate;
    if (row.bond_coupon_frequency == null) patch.bond_coupon_frequency = meta.frequency;
    if (Object.keys(patch).length === 0) continue;

    const { error: updErr } = await supabase
      .from("instruments")
      .update(patch)
      .eq("id", row.id);
    if (updErr) {
      failed.push(row.isin ?? row.id);
      continue;
    }
    updated += 1;
  }

  return { updated, failed };
}
