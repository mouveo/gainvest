"use server";

import { revalidatePath } from "next/cache";

import { lookupIsin } from "@/lib/openfigi";
import { createClient } from "@/lib/supabase/server";

import type { BondMetadata } from "../bonds/parse-symbol";
import { getBroker } from "../brokers/registry";
import type { ParsedKind, ParsedRow } from "../brokers/types";
import { resolveWritableAccountId } from "@/features/accounts/active";

import { SUPPORTS, type AssetClass, type Support } from "../types";

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
  bond_coupon_rate: number | null;
  bond_maturity_date: string | null;
  bond_coupon_frequency: number | null;
  preferred_mic: string | null;
  preferred_currency: string | null;
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
  options?: { accountId?: string | null },
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

  // Imports must target a specific account: dedup + liquidation inference are
  // both scoped per-account, so the resolver refuses ALL without an explicit
  // override.
  const resolved = await resolveWritableAccountId(options?.accountId ?? null);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const accountId = resolved.accountId;

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
        .eq("account_id", accountId)
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

  // Broker-provided metadata fallback (IBKR carries name/symbol/currency/assetClass
  // even when OpenFIGI doesn't know the ISIN — typically for bonds).
  type BrokerMeta = {
    name: string | null;
    symbol: string | null;
    currency: string | null;
    assetClass: AssetClass | null;
    bondMetadata: BondMetadata | null;
    preferredMic: string | null;
    preferredCurrency: string | null;
  };
  const brokerMetaByIsin = new Map<string, BrokerMeta>();
  for (const r of valid) {
    if (!r.isin) continue;
    const existing = brokerMetaByIsin.get(r.isin) ?? {
      name: null,
      symbol: null,
      currency: null,
      assetClass: null,
      bondMetadata: null,
      preferredMic: null,
      preferredCurrency: null,
    };
    existing.name = existing.name ?? r.name ?? null;
    existing.symbol = existing.symbol ?? r.symbol ?? null;
    existing.currency = existing.currency ?? r.currency ?? null;
    existing.assetClass = existing.assetClass ?? r.assetClass ?? null;
    existing.bondMetadata = existing.bondMetadata ?? r.bondMetadata ?? null;
    // Keep the first complete pair (both mic + currency). Partial pairs are
    // ignored — quote resolution downstream expects a coherent couple.
    if (
      existing.preferredMic == null &&
      existing.preferredCurrency == null &&
      r.preferredMic &&
      r.preferredCurrency
    ) {
      existing.preferredMic = r.preferredMic;
      existing.preferredCurrency = r.preferredCurrency;
    }
    brokerMetaByIsin.set(r.isin, existing);
  }

  if (isins.length > 0) {
    const { data, error } = await supabase
      .from("instruments")
      .select(
        "id, isin, name, asset_class, currency, bond_coupon_rate, bond_maturity_date, bond_coupon_frequency, preferred_mic, preferred_currency",
      )
      .in("isin", isins);
    if (error) return { ok: false, error: error.message };
    for (const row of data ?? []) {
      if (row.isin) byIsin.set(row.isin, row);
    }
  }

  // For instruments already cached locally, reconcile asset_class with what
  // the broker says (e.g. a bond previously misclassified as equity by
  // OpenFIGI fallback). Also fill bond_* columns when they are still NULL —
  // manual edits already in DB are preserved.
  for (const isin of isins) {
    const cached = byIsin.get(isin);
    if (!cached) continue;
    const meta = brokerMetaByIsin.get(isin);
    if (!meta) continue;
    const patch: {
      asset_class?: AssetClass;
      name?: string;
      bond_coupon_rate?: number;
      bond_maturity_date?: string;
      bond_coupon_frequency?: number;
      preferred_mic?: string;
      preferred_currency?: string;
    } = {};
    if (meta.assetClass && meta.assetClass !== cached.asset_class) {
      patch.asset_class = meta.assetClass;
      // When a row flips to "bond", also refresh its name with the broker's
      // bond-specific label (e.g. "AMZN 4.65 11/20/35") so the UI stops
      // showing the issuer alias inherited from OpenFIGI.
      if (meta.assetClass === "bond" && meta.name) {
        patch.name = meta.name;
      }
    }
    if (meta.bondMetadata) {
      if (cached.bond_coupon_rate == null) {
        patch.bond_coupon_rate = meta.bondMetadata.couponRate;
      }
      if (cached.bond_maturity_date == null) {
        patch.bond_maturity_date = meta.bondMetadata.maturityDate;
      }
      if (cached.bond_coupon_frequency == null) {
        patch.bond_coupon_frequency = meta.bondMetadata.frequency;
      }
    }
    // Only fill the preferred listing when both cached columns are still null
    // AND the broker gave us a complete couple. Never overwrite a user's
    // explicit choice — that's why we don't use a Supabase upsert here.
    if (
      cached.preferred_mic == null &&
      cached.preferred_currency == null &&
      meta.preferredMic &&
      meta.preferredCurrency
    ) {
      patch.preferred_mic = meta.preferredMic;
      patch.preferred_currency = meta.preferredCurrency;
    }
    if (Object.keys(patch).length === 0) continue;
    const { data: updated, error: updErr } = await supabase
      .from("instruments")
      .update(patch)
      .eq("id", cached.id)
      .select(
        "id, isin, name, asset_class, currency, bond_coupon_rate, bond_maturity_date, bond_coupon_frequency, preferred_mic, preferred_currency",
      )
      .single();
    if (updErr || !updated) continue;
    byIsin.set(isin, updated);
  }

  for (const isin of isins) {
    if (byIsin.has(isin)) continue;
    const openfigi = await lookupIsin(isin);
    const broker = brokerMetaByIsin.get(isin) ?? null;
    if (!openfigi && !(broker?.name && broker.assetClass && broker.currency)) continue;

    // Merge with broker precedence on assetClass + bond-specific name. IBKR
    // gives us `assetCategory="BOND"` and the bond symbol directly, which is
    // strictly more authoritative than OpenFIGI's market-sector heuristic.
    const assetClass: AssetClass = broker?.assetClass ?? openfigi?.assetClass ?? "equity";
    const name: string =
      assetClass === "bond"
        ? (broker?.name ?? openfigi?.name ?? isin)
        : (openfigi?.name ?? broker?.name ?? isin);
    const currency: string = openfigi?.currency ?? broker?.currency ?? "EUR";
    const country: string = openfigi?.country ?? isin.slice(0, 2);
    const symbol: string = broker?.symbol ?? isin;

    const insertPayload: {
      isin: string;
      symbol: string;
      name: string;
      asset_class: AssetClass;
      currency: string;
      country: string;
      bond_coupon_rate?: number;
      bond_maturity_date?: string;
      bond_coupon_frequency?: number;
      preferred_mic?: string;
      preferred_currency?: string;
    } = { isin, symbol, name, asset_class: assetClass, currency, country };

    if (assetClass === "bond" && broker?.bondMetadata) {
      insertPayload.bond_coupon_rate = broker.bondMetadata.couponRate;
      insertPayload.bond_maturity_date = broker.bondMetadata.maturityDate;
      insertPayload.bond_coupon_frequency = broker.bondMetadata.frequency;
    }
    if (broker?.preferredMic && broker?.preferredCurrency) {
      insertPayload.preferred_mic = broker.preferredMic;
      insertPayload.preferred_currency = broker.preferredCurrency;
    }
    const { data: upserted, error: upsertErr } = await supabase
      .from("instruments")
      .upsert(insertPayload, { onConflict: "symbol,mic" })
      .select(
        "id, isin, name, asset_class, currency, bond_coupon_rate, bond_maturity_date, bond_coupon_frequency, preferred_mic, preferred_currency",
      )
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
      .eq("account_id", accountId)
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
    fx_rate: number;
    notes: string | null;
    broker: string;
    support: Support;
    external_id: string | null;
  };

  const toInsert: Insert[] = [];
  let skipped = 0;

  for (const row of valid) {
    let instrumentId: string | null = null;
    let instrumentCurrency: string | null = null;

    if (row.isin) {
      const inst = byIsin.get(row.isin);
      if (!inst) {
        // For buy/sell/dividend the instrument is required.
        // For cash-only rows (deposit/withdrawal/interest/tax/fee) ISIN is
        // optional: when the lookup fails we still import the cash flow with
        // a warning so the cash balance stays correct.
        if (row.kind === "buy" || row.kind === "sell" || row.kind === "dividend") {
          failed.push({
            row: row.rawLine,
            reason: `ISIN ${row.isin} introuvable (OpenFIGI a échoué)`,
          });
          continue;
        }
        warnings.push(
          `Ligne ${row.rawLine} : ISIN ${row.isin} non résolu — importé en flux cash sans instrument`,
        );
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

    // Preserve the row's native currency (don't force EUR for IBKR multi-ccy).
    const currency = row.currency ?? instrumentCurrency ?? "EUR";
    const notes = row.notes ?? (row.kind === "fee" ? row.description : null);
    const fxRate = row.fxRate ?? 1;

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
      fx_rate: fxRate,
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
