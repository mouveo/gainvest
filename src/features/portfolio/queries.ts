import "server-only";

import { createClient } from "@/lib/supabase/server";

import { aggregateWithRealizations, type OrderRow, type Position } from "./aggregate";
import type { PastRealization } from "./realize";
import type { Support } from "./types";

/**
 * Read the current user's transactions joined with their instrument metadata
 * (RLS already restricts to the caller's rows).
 */
const UI_KINDS = new Set(["buy", "sell", "dividend", "fee"]);

export async function getOrders(): Promise<OrderRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select(
      `
        id,
        kind,
        trade_date,
        trade_time,
        quantity,
        price,
        gross_amount,
        fees,
        tax,
        notes,
        currency,
        execution_venue,
        broker,
        support,
        instrument:instruments (
          isin,
          name,
          asset_class,
          currency
        )
      `,
    )
    .order("trade_date", { ascending: false });

  if (error) throw error;
  if (!data) return [];

  const orders: OrderRow[] = [];
  for (const row of data) {
    if (!UI_KINDS.has(row.kind)) continue;
    const kind = row.kind as OrderRow["kind"];

    const instrument = row.instrument;
    let isin = "";
    let instrumentName: string;
    let assetClass: string;
    let currency: string;

    if (instrument) {
      isin = instrument.isin ?? "";
      instrumentName = instrument.name;
      assetClass = instrument.asset_class;
      currency = instrument.currency;
    } else if (kind === "fee") {
      instrumentName = row.notes ?? "Frais";
      assetClass = "cash";
      currency = row.currency ?? "EUR";
    } else {
      // Non-fee row without an instrument: cannot render meaningfully.
      continue;
    }

    orders.push({
      id: row.id,
      isin,
      instrumentName,
      assetClass,
      currency,
      kind,
      tradeDate: row.trade_date,
      tradeTime: row.trade_time,
      quantity: row.quantity == null ? null : Number(row.quantity),
      price: row.price == null ? null : Number(row.price),
      grossAmount: Number(row.gross_amount ?? 0),
      fees: Number(row.fees ?? 0) + Number(row.tax ?? 0),
      notes: row.notes ?? null,
      executionVenue: row.execution_venue,
      broker: row.broker,
      support: row.support as Support,
    });
  }
  return orders;
}

/**
 * Map of `isin -> current_price` for all instruments referenced by the user,
 * converted to EUR using the cached `fx_rates` table. The aggregate layer
 * compares against PRU (already in EUR because the broker CSV is in EUR), so
 * this avoids mixed-currency arithmetic on PnL/valuation.
 *
 * Falls back to the average buy price when no quote has been set yet — the
 * fallback is already in EUR because `transactions.price` is derived from the
 * EUR `gross_amount`.
 */
export async function getCurrentPrices(orders: OrderRow[]): Promise<Record<string, number>> {
  const supabase = await createClient();
  const tradable = orders.filter((o) => (o.kind === "buy" || o.kind === "sell") && o.isin !== "");
  const isins = Array.from(new Set(tradable.map((o) => o.isin)));
  if (isins.length === 0) return {};

  const { data, error } = await supabase
    .from("instruments")
    .select("isin, current_price, currency")
    .in("isin", isins);

  if (error) throw error;

  // Pull every FX rate we might need (skip EUR, rate is 1).
  const currencies = new Set<string>();
  for (const row of data ?? []) {
    const ccy = (row.currency ?? "EUR").toUpperCase();
    if (ccy !== "EUR") currencies.add(ccy);
  }
  const fxByCcy: Record<string, number> = { EUR: 1 };
  if (currencies.size > 0) {
    const { data: fxRows, error: fxErr } = await supabase
      .from("fx_rates")
      .select("currency, eur_rate")
      .in("currency", Array.from(currencies));
    if (fxErr) throw fxErr;
    for (const r of fxRows ?? []) {
      if (r.currency && r.eur_rate != null) {
        fxByCcy[r.currency.toUpperCase()] = Number(r.eur_rate);
      }
    }
  }

  const map: Record<string, number> = {};
  for (const row of data ?? []) {
    if (!row.isin || row.current_price == null) continue;
    const ccy = (row.currency ?? "EUR").toUpperCase();
    const rate = fxByCcy[ccy] ?? 1; // unknown currency → no conversion (best effort)
    map[row.isin] = Number(row.current_price) * rate;
  }

  // Fallback: use the most recent buy price for instruments without a quote.
  // `tradable[i].price` is already EUR (computed from gross_amount in EUR / quantity).
  for (const isin of isins) {
    if (map[isin] != null) continue;
    const fallback = tradable.find((o) => o.isin === isin && o.kind === "buy");
    if (fallback && fallback.price != null) map[isin] = fallback.price;
  }

  return map;
}

async function getPricesUpdatedAt(orders: OrderRow[]): Promise<string | null> {
  const isins = Array.from(new Set(orders.map((o) => o.isin).filter(Boolean)));
  if (isins.length === 0) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("instruments")
    .select("isin,current_price_updated_at")
    .in("isin", isins);

  if (error) throw error;

  let latest: string | null = null;
  for (const row of data ?? []) {
    const ts = row.current_price_updated_at;
    if (!ts) continue;
    if (latest === null || ts > latest) latest = ts;
  }
  return latest;
}

export async function getPositions(): Promise<{
  orders: OrderRow[];
  positions: Position[];
  realizations: PastRealization[];
  priceByIsin: Record<string, number>;
  pricesUpdatedAt: string | null;
}> {
  const orders = await getOrders();
  const priceByIsin = await getCurrentPrices(orders);
  const pricesUpdatedAt = await getPricesUpdatedAt(orders);
  const { positions, realizations } = aggregateWithRealizations(orders, priceByIsin);
  return { orders, positions, realizations, priceByIsin, pricesUpdatedAt };
}

/**
 * Returns the user's default account id (created by the on_auth_user_created
 * trigger; the helper exists as a safety net for legacy users).
 */
export async function getDefaultAccountId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("accounts")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (data) return data.id;

  // Should not happen — trigger creates one at signup — but be safe.
  const { data: created, error: insertErr } = await supabase
    .from("accounts")
    .insert({ user_id: user.id, name: "Portefeuille", type: "cto", currency: "EUR" })
    .select("id")
    .single();
  if (insertErr) throw insertErr;
  return created.id;
}
