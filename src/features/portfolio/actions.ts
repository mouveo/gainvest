"use server";

import { revalidatePath } from "next/cache";

import { lookupIsin } from "@/lib/openfigi";
import { createClient } from "@/lib/supabase/server";
import { buildStooqSymbol, fetchStooqQuotes } from "@/lib/stooq";

import { getDefaultAccountId } from "./queries";
import { SUPPORTS, type Support } from "./types";

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const PRICE_TTL_MS = 5 * 60 * 1000;

export type AddOrderResult = { ok: true } | { ok: false; error: string };

/**
 * Create (or reuse) an instrument by ISIN, then insert a buy/sell transaction
 * on the user's default account.
 */
export async function addOrder(formData: FormData): Promise<AddOrderResult> {
  const isin = String(formData.get("isin") ?? "")
    .trim()
    .toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  const kindRaw = String(formData.get("kind") ?? "buy");
  const kind = kindRaw === "sell" ? "sell" : "buy";
  const assetClass = String(formData.get("asset_class") ?? "etf");
  const currency = String(formData.get("currency") ?? "EUR").toUpperCase();

  const quantity = parseDec(formData.get("quantity"));
  const price = parseDec(formData.get("price"));
  const grossAmount = parseDec(formData.get("gross_amount")) || quantity * price;
  const fees = parseDec(formData.get("fees"));
  const tradeDate = String(formData.get("trade_date") ?? "");
  const tradeTime = String(formData.get("trade_time") ?? "") || null;
  const executionVenue = String(formData.get("execution_venue") ?? "").trim() || null;
  const broker = String(formData.get("broker") ?? "").trim() || null;

  const supportRaw = String(formData.get("support") ?? "CTO");

  if (!SUPPORTS.includes(supportRaw as Support)) {
    return { ok: false, error: "Support invalide." };
  }

  const support = supportRaw as Support;

  if (!ISIN_RE.test(isin)) return { ok: false, error: "ISIN invalide." };
  if (!name) return { ok: false, error: "Le nom de l'instrument est requis." };
  if (quantity <= 0) return { ok: false, error: "La quantité doit être > 0." };
  if (price <= 0) return { ok: false, error: "Le cours doit être > 0." };
  if (!tradeDate) return { ok: false, error: "La date d'exécution est requise." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Non authentifié." };

  const accountId = await getDefaultAccountId();

  // Upsert instrument by ISIN (MIC kept null in V0 — single venue per ISIN).
  const { data: instrument, error: instErr } = await supabase
    .from("instruments")
    .upsert(
      {
        isin,
        symbol: isin,
        name,
        asset_class: assetClass,
        currency,
      },
      { onConflict: "symbol,mic" },
    )
    .select("id")
    .single();

  if (instErr) return { ok: false, error: instErr.message };

  const { error: insertErr } = await supabase.from("transactions").insert({
    user_id: user.id,
    account_id: accountId,
    instrument_id: instrument.id,
    kind,
    trade_date: tradeDate,
    trade_time: tradeTime,
    quantity,
    price,
    gross_amount: grossAmount,
    fees,
    currency,
    execution_venue: executionVenue,
    broker,
    support,
  });

  if (insertErr) return { ok: false, error: insertErr.message };

  revalidatePath("/portfolio");
  return { ok: true };
}

export async function deleteOrder(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/portfolio");
}

export async function updateInstrumentPrice(isin: string, price: number): Promise<void> {
  if (!Number.isFinite(price) || price < 0) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from("instruments")
    .update({
      current_price: price,
      current_price_updated_at: new Date().toISOString(),
    })
    .eq("isin", isin);
  if (error) throw error;
  revalidatePath("/portfolio");
}

function parseDec(v: FormDataEntryValue | null): number {
  if (v == null) return 0;
  const cleaned = String(v).replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

type RefreshableInstrument = {
  id: string;
  isin: string | null;
  name: string;
  yahoo_symbol: string | null;
  current_price_updated_at: string | null;
};

export async function refreshPrices(options?: { force?: boolean }): Promise<{
  refreshed: number;
  skipped: number;
  failed: string[];
}> {
  const force = options?.force === true;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { refreshed: 0, skipped: 0, failed: [] };

  const { data: rows, error } = await supabase
    .from("transactions")
    .select(
      `
        instrument:instruments(
          id,
          isin,
          name,
          yahoo_symbol,
          current_price_updated_at
        )
      `,
    )
    .in("kind", ["buy", "sell"]);

  if (error) throw error;

  const byId = new Map<string, RefreshableInstrument>();
  for (const row of rows ?? []) {
    const inst = row.instrument;
    if (!inst || !inst.id) continue;
    if (byId.has(inst.id)) continue;
    byId.set(inst.id, {
      id: inst.id,
      isin: inst.isin ?? null,
      name: inst.name,
      yahoo_symbol: inst.yahoo_symbol ?? null,
      current_price_updated_at: inst.current_price_updated_at ?? null,
    });
  }

  const failed: string[] = [];
  let skipped = 0;
  const now = Date.now();
  const stale: RefreshableInstrument[] = [];

  for (const inst of byId.values()) {
    if (!force && inst.current_price_updated_at) {
      const updatedAt = Date.parse(inst.current_price_updated_at);
      if (Number.isFinite(updatedAt) && now - updatedAt < PRICE_TTL_MS) {
        skipped += 1;
        continue;
      }
    }
    stale.push(inst);
  }

  for (const inst of stale) {
    if (inst.yahoo_symbol) continue;
    if (!inst.isin) {
      failed.push(inst.name);
      continue;
    }
    const meta = await lookupIsin(inst.isin);
    const ticker = meta?.ticker?.trim();
    if (!ticker) {
      failed.push(inst.isin);
      continue;
    }
    const stooqSymbol = buildStooqSymbol(ticker, meta?.exchCode ?? null);
    if (!stooqSymbol) {
      // OpenFIGI exchCode unmapped → Stooq cannot resolve; user can edit the
      // price inline via EditablePrice or set instruments.yahoo_symbol manually.
      failed.push(inst.isin);
      continue;
    }
    const { error: updErr } = await supabase
      .from("instruments")
      .update({ yahoo_symbol: stooqSymbol })
      .eq("id", inst.id);
    if (updErr) {
      failed.push(inst.isin);
      continue;
    }
    inst.yahoo_symbol = stooqSymbol;
  }

  const symbols = stale
    .map((inst) => inst.yahoo_symbol)
    .filter((s): s is string => typeof s === "string" && s.length > 0);

  const quotes = symbols.length > 0 ? await fetchStooqQuotes(symbols) : [];
  const quoteBySymbol = new Map<string, (typeof quotes)[number]>();
  for (const q of quotes) quoteBySymbol.set(q.symbol, q);

  let refreshed = 0;
  const updatedAt = new Date().toISOString();
  for (const inst of stale) {
    if (!inst.yahoo_symbol) continue;
    const quote = quoteBySymbol.get(inst.yahoo_symbol);
    if (!quote) {
      failed.push(inst.isin ?? inst.name);
      continue;
    }
    const { error: updErr } = await supabase
      .from("instruments")
      .update({
        current_price: quote.price,
        current_price_updated_at: updatedAt,
      })
      .eq("id", inst.id);
    if (updErr) {
      failed.push(inst.isin ?? inst.name);
      continue;
    }
    refreshed += 1;
  }

  if (refreshed > 0) revalidatePath("/portfolio");

  return { refreshed, skipped, failed };
}
