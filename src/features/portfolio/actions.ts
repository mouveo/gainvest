"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

import { getDefaultAccountId } from "./queries";

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

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
