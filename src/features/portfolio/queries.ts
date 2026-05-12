import "server-only";

import { createClient } from "@/lib/supabase/server";

import {
  aggregateWithRealizations,
  type CurrentPrice,
  type OrderRow,
  type Position,
} from "./aggregate";
import type { PastRealization } from "./realize";
import type { Support } from "./types";

/**
 * Read the current user's transactions joined with their instrument metadata
 * (RLS already restricts to the caller's rows).
 *
 * Cash kinds (deposit/withdrawal/interest/tax) are included unconditionally so
 * the replay can compute per-(support, broker, currency) cash balances.
 */
const UI_KINDS = new Set([
  "buy",
  "sell",
  "dividend",
  "fee",
  "interest",
  "tax",
  "deposit",
  "withdrawal",
]);

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
        fx_rate,
        notes,
        currency,
        execution_venue,
        broker,
        support,
        instrument:instruments (
          id,
          isin,
          name,
          asset_class,
          currency,
          preferred_mic,
          preferred_currency,
          bond_coupon_rate,
          bond_maturity_date,
          bond_coupon_frequency
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
    let instrumentId: string | null = null;
    let preferredMic: string | null = null;
    let preferredCurrency: string | null = null;
    let instrumentName: string;
    let assetClass: string;
    let currency: string;
    let bondCouponRate: number | null = null;
    let bondMaturityDate: string | null = null;
    let bondCouponFrequency: 1 | 2 | 4 | null = null;

    if (instrument) {
      isin = instrument.isin ?? "";
      instrumentId = instrument.id ?? null;
      preferredMic = instrument.preferred_mic ?? null;
      preferredCurrency = instrument.preferred_currency ?? null;
      instrumentName = instrument.name;
      assetClass = instrument.asset_class;
      // For cash flows we keep the row's native currency (the row may be in
      // USD even when the instrument it references is EUR-denominated for
      // example). Native arithmetic + per-row fxRate handles the EUR view.
      currency = row.currency ?? instrument.currency;
      bondCouponRate =
        instrument.bond_coupon_rate == null ? null : Number(instrument.bond_coupon_rate);
      bondMaturityDate = instrument.bond_maturity_date ?? null;
      const rawFreq = instrument.bond_coupon_frequency;
      bondCouponFrequency =
        rawFreq === 1 || rawFreq === 2 || rawFreq === 4 ? rawFreq : null;
    } else {
      // Cash row without an instrument: synthetic name from notes/kind.
      instrumentName = row.notes ?? kind;
      assetClass = "cash";
      currency = row.currency ?? "EUR";
    }

    orders.push({
      id: row.id,
      isin,
      instrumentId,
      preferredMic,
      preferredCurrency,
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
      fxRate: Number(row.fx_rate ?? 1),
      notes: row.notes ?? null,
      executionVenue: row.execution_venue,
      broker: row.broker,
      support: row.support as Support,
      bondCouponRate,
      bondMaturityDate,
      bondCouponFrequency,
    });
  }
  return orders;
}

/**
 * Map of `isin -> CurrentPrice` for all instruments referenced by the user.
 *
 * `native` is the price as quoted by the provider in the instrument's own
 * currency. For `asset_class="bond"` this is the standard "% of par" quote
 * (e.g. 97.38 means 97.38% of nominal) — bond valuation downstream is
 * `qty × native / 100 × fxToEur`. For every other asset class, `native` is
 * the unit price and `eur = native × fxToEur` is the EUR-per-unit shortcut
 * used by `qty × eur` valuations.
 *
 * Falls back to the most recent buy price when no quote has been set yet:
 * `transactions.price` is stored in the instrument's native currency, so it
 * maps to `native` directly.
 */
export async function getCurrentPrices(
  orders: OrderRow[],
): Promise<Record<string, CurrentPrice>> {
  const supabase = await createClient();
  const tradable = orders.filter((o) => (o.kind === "buy" || o.kind === "sell") && o.isin !== "");
  const isins = Array.from(new Set(tradable.map((o) => o.isin)));
  if (isins.length === 0) return {};

  const { data, error } = await supabase
    .from("instruments")
    .select("isin, current_price, currency, asset_class")
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

  const assetClassByIsin = new Map<string, string>();
  const map: Record<string, CurrentPrice> = {};
  for (const row of data ?? []) {
    if (!row.isin) continue;
    const ccy = (row.currency ?? "EUR").toUpperCase();
    const fxToEur = fxByCcy[ccy] ?? 1; // unknown currency → no conversion (best effort)
    if (row.asset_class) assetClassByIsin.set(row.isin, row.asset_class);
    if (row.current_price == null) continue;
    const native = Number(row.current_price);
    const eur = row.asset_class === "bond" ? (native / 100) * fxToEur : native * fxToEur;
    map[row.isin] = { native, eur, currency: ccy, fxToEur };
  }

  // Fallback: use the most recent buy price for instruments without a quote.
  // `transactions.price` is stored in native currency. For bonds it's already
  // expressed in % of par (the order sheet captures the quote that way), so
  // the bond/non-bond branching mirrors the live-quote path.
  for (const isin of isins) {
    if (map[isin] != null) continue;
    const fallback = tradable.find((o) => o.isin === isin && o.kind === "buy");
    if (!fallback || fallback.price == null) continue;
    const native = fallback.price;
    const ccy = (fallback.currency ?? "EUR").toUpperCase();
    const fxToEur = fxByCcy[ccy] ?? 1;
    const assetClass = assetClassByIsin.get(isin) ?? fallback.assetClass;
    const eur = assetClass === "bond" ? (native / 100) * fxToEur : native * fxToEur;
    map[isin] = { native, eur, currency: ccy, fxToEur };
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

async function getFxRates(orders: OrderRow[]): Promise<Record<string, number>> {
  const ccys = new Set<string>();
  for (const o of orders) {
    const ccy = (o.currency ?? "EUR").toUpperCase();
    if (ccy !== "EUR") ccys.add(ccy);
  }
  if (ccys.size === 0) return { EUR: 1 };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fx_rates")
    .select("currency, eur_rate")
    .in("currency", Array.from(ccys));
  if (error) throw error;
  const out: Record<string, number> = { EUR: 1 };
  for (const r of data ?? []) {
    if (r.currency && r.eur_rate != null) {
      out[r.currency.toUpperCase()] = Number(r.eur_rate);
    }
  }
  return out;
}

export async function getPositions(): Promise<{
  orders: OrderRow[];
  positions: Position[];
  realizations: PastRealization[];
  priceByIsin: Record<string, CurrentPrice>;
  pricesUpdatedAt: string | null;
}> {
  const orders = await getOrders();
  const priceByIsin = await getCurrentPrices(orders);
  const pricesUpdatedAt = await getPricesUpdatedAt(orders);
  const fxByCurrency = await getFxRates(orders);
  const { positions, realizations } = aggregateWithRealizations(
    orders,
    priceByIsin,
    new Date(),
    fxByCurrency,
  );
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
