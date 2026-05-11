import "server-only";

import { createClient } from "@/lib/supabase/server";

import { aggregate, type OrderRow, type Position } from "./aggregate";
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
      executionVenue: row.execution_venue,
      broker: row.broker,
      support: row.support as Support,
    });
  }
  return orders;
}

/**
 * Map of `isin -> current_price` for all instruments referenced by the user.
 * Falls back to the average buy price when no quote has been set yet, so a
 * brand-new position doesn't show 0 €.
 */
export async function getCurrentPrices(orders: OrderRow[]): Promise<Record<string, number>> {
  const supabase = await createClient();
  const tradable = orders.filter(
    (o) => (o.kind === "buy" || o.kind === "sell") && o.isin !== "",
  );
  const isins = Array.from(new Set(tradable.map((o) => o.isin)));
  if (isins.length === 0) return {};

  const { data, error } = await supabase
    .from("instruments")
    .select("isin, current_price")
    .in("isin", isins);

  if (error) throw error;

  const map: Record<string, number> = {};
  for (const row of data ?? []) {
    if (row.isin && row.current_price != null) {
      map[row.isin] = Number(row.current_price);
    }
  }

  // Fallback: use the most recent buy price for instruments without a quote.
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
  priceByIsin: Record<string, number>;
  pricesUpdatedAt: string | null;
}> {
  const orders = await getOrders();
  const priceByIsin = await getCurrentPrices(orders);
  const pricesUpdatedAt = await getPricesUpdatedAt(orders);
  const positions = aggregate(orders, priceByIsin);
  return { orders, positions, priceByIsin, pricesUpdatedAt };
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
