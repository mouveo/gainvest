"use server";

import { revalidatePath } from "next/cache";

import { lookupIsin } from "@/lib/openfigi";
import { createClient } from "@/lib/supabase/server";

import { getBroker } from "../brokers/registry";
import type { ParsedKind, ParsedRow } from "../brokers/types";
import { getDefaultAccountId } from "../queries";
import { SUPPORTS, type Support } from "../types";

export type ImportResult =
  | {
      ok: true;
      inserted: number;
      skipped: number;
      failed: { row: number; reason: string }[];
      warnings: string[];
    }
  | { ok: false; error: string };

type InstrumentLite = {
  id: string;
  isin: string | null;
  name: string;
  asset_class: string;
  currency: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dedupKey(
  instrumentId: string | null,
  date: string,
  kind: string,
  qty: number | null,
  gross: number,
  support: string,
): string {
  return `${instrumentId ?? "_"}::${date}::${kind}::${qty ?? "_"}::${round2(gross).toFixed(2)}::${support}`;
}

export async function importBrokerOrders(
  brokerId: string,
  support: Support,
  rows: ParsedRow[],
  warnings: string[] = [],
): Promise<ImportResult> {
  const brokerProfile = getBroker(brokerId);
  if (!brokerProfile) return { ok: false, error: "Courtier inconnu." };
  if (!SUPPORTS.includes(support)) return { ok: false, error: "Support invalide." };
  if (rows.length === 0) {
    return { ok: true, inserted: 0, skipped: 0, failed: [], warnings };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Non authentifié." };

  const accountId = await getDefaultAccountId();

  const failed: { row: number; reason: string }[] = [];

  // Sort rows chronologically (and place liquidations last on same day) so that
  // the per-isin stock used to infer liquidation quantities reflects every
  // buy/sell that took place earlier in the same batch.
  const workingRows: ParsedRow[] = rows.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const aLiq = a.inferQtyFromHoldings ? 1 : 0;
    const bLiq = b.inferQtyFromHoldings ? 1 : 0;
    return aLiq - bLiq;
  });

  // Infer liquidation quantities by replaying the user's history for the
  // affected (isin, support) lines.
  type StockEntry = { date: string; signedQty: number };
  const stockByKey = new Map<string, StockEntry[]>();
  const liqIsins = Array.from(
    new Set(
      workingRows
        .filter((r) => r.inferQtyFromHoldings && r.isin)
        .map((r) => r.isin as string),
    ),
  );

  if (liqIsins.length > 0) {
    const { data: instData, error: instErr } = await supabase
      .from("instruments")
      .select("id, isin")
      .in("isin", liqIsins);
    if (instErr) return { ok: false, error: instErr.message };
    const instIdToIsin = new Map<string, string>();
    for (const inst of instData ?? []) {
      if (inst.id && inst.isin) instIdToIsin.set(inst.id, inst.isin);
    }
    const instIds = Array.from(instIdToIsin.keys());
    if (instIds.length > 0) {
      const { data: priorTx, error: priorErr } = await supabase
        .from("transactions")
        .select("kind, quantity, trade_date, support, instrument_id")
        .eq("user_id", user.id)
        .eq("support", support)
        .in("kind", ["buy", "sell"])
        .in("instrument_id", instIds);
      if (priorErr) return { ok: false, error: priorErr.message };
      for (const t of priorTx ?? []) {
        if (!t.instrument_id || t.quantity == null) continue;
        const isin = instIdToIsin.get(t.instrument_id);
        if (!isin) continue;
        const key = `${isin}::${t.support}`;
        const sign = t.kind === "buy" ? 1 : -1;
        const arr = stockByKey.get(key) ?? [];
        arr.push({ date: t.trade_date, signedQty: sign * Number(t.quantity) });
        stockByKey.set(key, arr);
      }
    }
  }

  // Same-batch contributions (other buy/sell rows that precede the liquidation).
  const batchContribs = new Map<string, StockEntry[]>();
  for (const r of workingRows) {
    if (r.inferQtyFromHoldings) continue;
    if (r.kind !== "buy" && r.kind !== "sell") continue;
    if (!r.isin || r.quantity == null || r.quantity <= 0) continue;
    const key = `${r.isin}::${support}`;
    const arr = batchContribs.get(key) ?? [];
    arr.push({ date: r.date, signedQty: r.kind === "buy" ? r.quantity : -r.quantity });
    batchContribs.set(key, arr);
  }

  for (const r of workingRows) {
    if (!r.inferQtyFromHoldings || !r.isin) continue;
    const key = `${r.isin}::${support}`;
    let stock = 0;
    for (const e of stockByKey.get(key) ?? []) {
      if (e.date <= r.date) stock += e.signedQty;
    }
    for (const e of batchContribs.get(key) ?? []) {
      if (e.date <= r.date) stock += e.signedQty;
    }
    if (stock > 0) {
      r.quantity = stock;
      const gross = r.grossAmount ?? r.totalAmount;
      r.price = Math.round((gross / stock) * 10000) / 10000;
      r.inferQtyFromHoldings = false;
    } else {
      r.needsAttention = true;
      r.attentionReason = "Quantité de liquidation introuvable (stock nul à la date)";
    }
  }

  const valid: ParsedRow[] = [];

  for (const row of workingRows) {
    if (row.needsAttention) {
      failed.push({
        row: row.rawLine,
        reason: row.attentionReason ?? "Ligne à corriger",
      });
      continue;
    }
    if (row.kind === "buy" || row.kind === "sell") {
      if (!row.isin) {
        failed.push({ row: row.rawLine, reason: "ISIN obligatoire pour achat/vente" });
        continue;
      }
      if (row.quantity == null || row.quantity <= 0) {
        failed.push({ row: row.rawLine, reason: "Quantité invalide" });
        continue;
      }
      if (row.price == null) {
        failed.push({ row: row.rawLine, reason: "Cours invalide" });
        continue;
      }
      if (row.grossAmount == null || row.grossAmount <= 0) {
        failed.push({ row: row.rawLine, reason: "Montant brut invalide" });
        continue;
      }
    } else if (row.kind === "dividend") {
      if (!row.isin) {
        failed.push({ row: row.rawLine, reason: "ISIN obligatoire pour coupon" });
        continue;
      }
    }
    valid.push(row);
  }

  // Préchargement des instruments connus par ISIN.
  const isins = Array.from(new Set(valid.map((r) => r.isin).filter((x): x is string => !!x)));
  const byIsin = new Map<string, InstrumentLite>();

  if (isins.length > 0) {
    const { data, error } = await supabase
      .from("instruments")
      .select("id, isin, name, asset_class, currency")
      .in("isin", isins);
    if (error) return { ok: false, error: error.message };
    for (const row of data ?? []) {
      if (row.isin) byIsin.set(row.isin, row);
    }
  }

  for (const isin of isins) {
    if (byIsin.has(isin)) continue;
    const meta = await lookupIsin(isin);
    if (!meta) continue;
    const { data: upserted, error: upsertErr } = await supabase
      .from("instruments")
      .upsert(
        {
          isin,
          symbol: isin,
          name: meta.name,
          asset_class: meta.assetClass,
          currency: meta.currency,
          country: meta.country,
        },
        { onConflict: "symbol,mic" },
      )
      .select("id, isin, name, asset_class, currency")
      .single();
    if (upsertErr || !upserted) continue;
    byIsin.set(isin, upserted);
  }

  // Fenêtre min/max pour la dédup. Charger external_id ET clés synthétiques sur la fenêtre.
  const dates = valid.map((r) => r.date).filter(Boolean);
  const existingKeys = new Set<string>();
  const existingExternalIds = new Set<string>();

  if (dates.length > 0) {
    const minDate = dates.reduce((a, b) => (a < b ? a : b));
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));
    const { data: existingTx, error: existingErr } = await supabase
      .from("transactions")
      .select("instrument_id, trade_date, kind, quantity, gross_amount, support, external_id")
      .gte("trade_date", minDate)
      .lte("trade_date", maxDate);
    if (existingErr) return { ok: false, error: existingErr.message };
    for (const t of existingTx ?? []) {
      existingKeys.add(
        dedupKey(
          t.instrument_id,
          t.trade_date,
          t.kind,
          t.quantity != null ? Number(t.quantity) : null,
          Number(t.gross_amount),
          t.support,
        ),
      );
      if (t.external_id) existingExternalIds.add(t.external_id);
    }
  }

  type Insert = {
    user_id: string;
    account_id: string;
    instrument_id: string | null;
    kind: ParsedKind;
    trade_date: string;
    quantity: number | null;
    price: number | null;
    gross_amount: number;
    fees: number;
    tax: number;
    currency: string;
    notes: string | null;
    broker: string;
    support: Support;
    external_id: string | null;
  };

  const toInsert: Insert[] = [];
  let skipped = 0;

  for (const row of valid) {
    let instrumentId: string | null = null;
    let instrumentCurrency = "EUR";

    if (row.isin) {
      const inst = byIsin.get(row.isin);
      if (!inst) {
        // For cash-only rows (deposit/withdrawal/interest/tax) ISIN is optional;
        // skip the OpenFIGI miss only when the row really needs an instrument.
        if (row.kind === "buy" || row.kind === "sell" || row.kind === "dividend") {
          failed.push({
            row: row.rawLine,
            reason: `ISIN ${row.isin} introuvable (OpenFIGI a échoué)`,
          });
          continue;
        }
      } else {
        instrumentId = inst.id;
        instrumentCurrency = inst.currency;
      }
    }

    const grossAmount = round2(row.grossAmount ?? row.totalAmount);
    const fees = row.computedFees
      ? round2(row.computedFees.brokerage)
      : round2(row.fees ?? 0);
    const tax = row.computedFees ? round2(row.computedFees.ttf) : 0;

    // Dedup: prefer external_id (IBKR), fall back to synthetic key (BD).
    if (row.externalId && existingExternalIds.has(row.externalId)) {
      skipped += 1;
      continue;
    }
    if (!row.externalId) {
      const key = dedupKey(instrumentId, row.date, row.kind, row.quantity, grossAmount, support);
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }
      existingKeys.add(key);
    } else {
      existingExternalIds.add(row.externalId);
    }

    const currency = row.currency ?? (row.kind === "fee" ? "EUR" : instrumentCurrency);
    const notes = row.notes ?? (row.kind === "fee" ? row.description : null);

    toInsert.push({
      user_id: user.id,
      account_id: accountId,
      instrument_id: instrumentId,
      kind: row.kind,
      trade_date: row.date,
      quantity: row.quantity ?? null,
      price: row.price ?? null,
      gross_amount: grossAmount,
      fees,
      tax,
      currency,
      notes,
      broker: row.broker ?? brokerProfile.name,
      support,
      external_id: row.externalId ?? null,
    });
  }

  for (let i = 0; i < toInsert.length; i += 100) {
    const chunk = toInsert.slice(i, i + 100);
    const { error } = await supabase.from("transactions").insert(chunk);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/portfolio");
  return { ok: true, inserted: toInsert.length, skipped, failed, warnings };
}
