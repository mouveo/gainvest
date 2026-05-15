"use server";

import { revalidatePath } from "next/cache";

import {
  coingeckoProvider,
  type Listing,
  pickPreferredListing,
  pickProviderFor,
  quoteProvider,
} from "@/lib/quotes";
import { findListingForPreference, shouldRejectDivergentQuote } from "@/lib/quotes/ranking";
import { createClient } from "@/lib/supabase/server";

import { getActiveAccount, resolveWritableAccountId } from "@/features/accounts/active";
import { ALL_ACCOUNTS } from "@/features/accounts/constants";

import { SUPPORTS, type Support } from "./types";

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
// Auto-refresh runs once per day at most. EODHD free tier is capped at 20 API
// calls per day; bouton "Rafraîchir" (force=true) bypasses the TTL when the
// user wants a fresh quote on demand.
const PRICE_TTL_MS = 24 * 60 * 60 * 1000;

export type AddOrderResult = { ok: true } | { ok: false; error: string };

const ADD_ORDER_KINDS = ["buy", "sell", "deposit", "withdrawal", "interest", "fee"] as const;
type AddOrderKind = (typeof ADD_ORDER_KINDS)[number];

const INITIAL_CASH_NOTE = "Solde initial — saisie manuelle";

async function resolveFxRate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  currency: string,
): Promise<{ ok: true; rate: number } | { ok: false; error: string }> {
  if (currency === "EUR") return { ok: true, rate: 1 };
  const { data, error } = await supabase
    .from("fx_rates")
    .select("eur_rate")
    .eq("currency", currency)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data || data.eur_rate == null) {
    return {
      ok: false,
      error: `Devise ${currency} non disponible — aucun taux FX en cache. Utilise EUR ou rafraîchis les cours pour télécharger le taux.`,
    };
  }
  return { ok: true, rate: Number(data.eur_rate) };
}

/**
 * Create (or reuse) an instrument by ISIN for buy/sell rows, or insert a
 * cash flow (deposit/withdrawal/interest/fee) without an instrument.
 */
export async function addOrder(formData: FormData): Promise<AddOrderResult> {
  const isin = String(formData.get("isin") ?? "")
    .trim()
    .toUpperCase();
  const symbol = String(formData.get("symbol") ?? "")
    .trim()
    .toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  const kindRaw = String(formData.get("kind") ?? "buy");
  if (!ADD_ORDER_KINDS.includes(kindRaw as AddOrderKind)) {
    return { ok: false, error: "Type de mouvement invalide." };
  }
  const kind = kindRaw as AddOrderKind;
  const assetClass = String(formData.get("asset_class") ?? "etf");
  const currency = String(formData.get("currency") ?? "EUR").toUpperCase();

  const preferredMicRaw = String(formData.get("preferred_mic") ?? "").trim().toUpperCase();
  const preferredCurrencyRaw = String(formData.get("preferred_currency") ?? "")
    .trim()
    .toUpperCase();
  // Only honour a fully-specified pair. Partial pairs are silently dropped —
  // downstream quote resolution expects (mic, currency) to be set together.
  const preferredMic = preferredMicRaw && preferredCurrencyRaw ? preferredMicRaw : null;
  const preferredCurrency =
    preferredMicRaw && preferredCurrencyRaw ? preferredCurrencyRaw : null;

  const quantity = parseDec(formData.get("quantity"));
  const price = parseDec(formData.get("price"));
  const grossAmount = parseDec(formData.get("gross_amount")) || quantity * price;
  const fees = parseDec(formData.get("fees"));
  const tradeDate = String(formData.get("trade_date") ?? "");
  const tradeTime = String(formData.get("trade_time") ?? "") || null;
  const executionVenue = String(formData.get("execution_venue") ?? "").trim() || null;
  const broker = String(formData.get("broker") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const supportRaw = String(formData.get("support") ?? "CTO");

  if (!SUPPORTS.includes(supportRaw as Support)) {
    return { ok: false, error: "Support invalide." };
  }

  const support = supportRaw as Support;
  const isCashKind = kind !== "buy" && kind !== "sell";
  // Crypto branch: support=CRYPTO or asset_class=crypto. ISIN is not required
  // — the symbol field carries identity and the instrument is resolved via
  // CoinGecko (same path as the Coinbase importer, LOT 3).
  const isCryptoOrder = !isCashKind && (support === "CRYPTO" || assetClass === "crypto");

  if (!tradeDate) return { ok: false, error: "La date d'exécution est requise." };

  if (!isCashKind) {
    if (isCryptoOrder) {
      if (!symbol) return { ok: false, error: "Symbole crypto requis." };
    } else {
      if (!ISIN_RE.test(isin)) return { ok: false, error: "ISIN invalide." };
    }
    if (!name) return { ok: false, error: "Le nom de l'instrument est requis." };
    if (quantity <= 0) return { ok: false, error: "La quantité doit être > 0." };
    if (price <= 0) return { ok: false, error: "Le cours doit être > 0." };
  } else {
    if (!broker) return { ok: false, error: "Opérateur requis pour un mouvement cash." };
    if (grossAmount <= 0) return { ok: false, error: "Le montant doit être > 0." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Non authentifié." };

  // Cash kinds in non-EUR currencies require a known FX rate so the replay
  // can project the flow back to EUR.
  const fxLookup = await resolveFxRate(supabase, currency);
  if (!fxLookup.ok) return { ok: false, error: fxLookup.error };
  const fxRate = fxLookup.rate;

  const accountIdRaw = String(formData.get("account_id") ?? "").trim();
  const resolved = await resolveWritableAccountId(accountIdRaw || null);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const accountId = resolved.accountId;

  let instrumentId: string | null = null;
  if (isCryptoOrder) {
    // Crypto: lookup by (symbol, asset_class='crypto'). No OpenFIGI; if absent
    // locally, resolve via CoinGecko and create with provider/provider_symbol
    // pre-filled so refreshPrices can quote immediately.
    const { data: existing, error: existErr } = await supabase
      .from("instruments")
      .select("id")
      .eq("symbol", symbol)
      .eq("asset_class", "crypto")
      .maybeSingle();
    if (existErr) return { ok: false, error: existErr.message };
    if (existing) {
      instrumentId = existing.id;
    } else {
      const listings = await coingeckoProvider.searchListings(symbol);
      const chosen = listings[0] ?? null;
      if (!chosen) {
        return {
          ok: false,
          error: `Symbole crypto "${symbol}" introuvable sur CoinGecko.`,
        };
      }
      const { data: inserted, error: insErr } = await supabase
        .from("instruments")
        .insert({
          isin: null,
          symbol,
          mic: null,
          name: name || symbol,
          asset_class: "crypto",
          currency: "EUR",
          country: null,
          provider: "coingecko",
          provider_symbol: chosen.providerSymbol,
          preferred_mic: null,
          preferred_currency: "EUR",
        })
        .select("id")
        .single();
      if (insErr) return { ok: false, error: insErr.message };
      instrumentId = inserted.id;
    }
  } else if (!isCashKind) {
    // Find the existing catalog row keyed on (symbol = isin, mic IS NULL).
    // We deliberately avoid upsert on `symbol,mic` here: an upsert that
    // includes `preferred_mic` would overwrite a user's previously locked
    // listing — a strict no-no per the LOT plan.
    const { data: existing, error: existErr } = await supabase
      .from("instruments")
      .select("id, preferred_mic, preferred_currency")
      .eq("symbol", isin)
      .is("mic", null)
      .maybeSingle();
    if (existErr) return { ok: false, error: existErr.message };

    if (existing) {
      instrumentId = existing.id;
      // Only fill the preferred listing when the cached row has none yet
      // AND the form supplied a complete pair.
      if (
        preferredMic &&
        preferredCurrency &&
        existing.preferred_mic == null &&
        existing.preferred_currency == null
      ) {
        const { error: updErr } = await supabase
          .from("instruments")
          .update({
            preferred_mic: preferredMic,
            preferred_currency: preferredCurrency,
          })
          .eq("id", existing.id);
        if (updErr) return { ok: false, error: updErr.message };
      }
    } else {
      const insertPayload: {
        isin: string;
        symbol: string;
        name: string;
        asset_class: string;
        currency: string;
        preferred_mic?: string;
        preferred_currency?: string;
      } = {
        isin,
        symbol: isin,
        name,
        asset_class: assetClass,
        currency,
      };
      if (preferredMic && preferredCurrency) {
        insertPayload.preferred_mic = preferredMic;
        insertPayload.preferred_currency = preferredCurrency;
      }
      const { data: inserted, error: instErr } = await supabase
        .from("instruments")
        .insert(insertPayload)
        .select("id")
        .single();
      if (instErr) return { ok: false, error: instErr.message };
      instrumentId = inserted.id;
    }
  }

  const { error: insertErr } = await supabase.from("transactions").insert({
    user_id: user.id,
    account_id: accountId,
    instrument_id: instrumentId,
    kind,
    trade_date: tradeDate,
    trade_time: isCashKind ? null : tradeTime,
    quantity: isCashKind ? null : quantity,
    price: isCashKind ? null : price,
    gross_amount: grossAmount,
    fees: isCashKind ? 0 : fees,
    currency,
    fx_rate: fxRate,
    notes,
    execution_venue: isCashKind ? null : executionVenue,
    broker,
    support,
  });

  if (insertErr) return { ok: false, error: insertErr.message };

  revalidatePath("/portfolio");
  return { ok: true };
}

export type SetCashBalanceResult =
  | { ok: true; gap: number; action: "noop" | "updated" | "inserted" }
  | { ok: false; error: string };

const CASH_KIND_SIGN: Record<string, 1 | -1> = {
  deposit: 1,
  sell: 1,
  dividend: 1,
  interest: 1,
  withdrawal: -1,
  buy: -1,
  fee: -1,
  tax: -1,
};

function shiftDate(d: string, days: number): string {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Calibrate the cash balance for a (support, broker, currency) bucket at a
 * given date by replaying every transaction that hits cash and either
 * adjusting the existing manual "Solde initial" deposit, or inserting one
 * dated just before the first observed flow.
 */
export async function setCashBalance(input: {
  support: Support;
  broker: string;
  currency: string;
  amount: number;
  atDate: string;
  accountId?: string | null;
}): Promise<SetCashBalanceResult> {
  const support = input.support;
  const broker = input.broker.trim();
  const currency = input.currency.trim().toUpperCase();
  const amount = Number(input.amount);
  const atDate = input.atDate;

  if (!SUPPORTS.includes(support)) return { ok: false, error: "Support invalide." };
  if (!broker) return { ok: false, error: "Opérateur requis." };
  if (!currency) return { ok: false, error: "Devise requise." };
  if (!Number.isFinite(amount)) return { ok: false, error: "Montant invalide." };
  if (!atDate) return { ok: false, error: "Date de calibration requise." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Non authentifié." };

  const resolved = await resolveWritableAccountId(input.accountId);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const accountId = resolved.accountId;

  const fxLookup = await resolveFxRate(supabase, currency);
  if (!fxLookup.ok) return { ok: false, error: fxLookup.error };
  const fxRate = fxLookup.rate;

  // Replay every cash-impacting transaction up to atDate, in native currency,
  // for the targeted bucket. Mirrors the logic in realize.ts.
  const { data: rows, error: txErr } = await supabase
    .from("transactions")
    .select("id, kind, gross_amount, fees, trade_date, notes")
    .eq("user_id", user.id)
    .eq("account_id", accountId)
    .eq("support", support)
    .eq("broker", broker)
    .eq("currency", currency)
    .lte("trade_date", atDate);
  if (txErr) return { ok: false, error: txErr.message };

  let balance = 0;
  let firstDate: string | null = null;
  let initialRow: { id: string; gross_amount: number } | null = null;
  for (const r of rows ?? []) {
    const sign = CASH_KIND_SIGN[r.kind];
    if (!sign) continue;
    const gross = Number(r.gross_amount ?? 0);
    const fees = Number(r.fees ?? 0);
    if (r.kind === "buy") balance -= gross + fees;
    else if (r.kind === "sell") balance += gross - fees;
    else balance += sign * gross;
    if (firstDate === null || r.trade_date < firstDate) firstDate = r.trade_date;
    if (r.kind === "deposit" && r.notes === INITIAL_CASH_NOTE) {
      initialRow = { id: r.id, gross_amount: gross };
    }
  }

  const gap = amount - balance;
  if (Math.abs(gap) < 0.01) return { ok: true, gap: 0, action: "noop" };

  if (initialRow) {
    const next = initialRow.gross_amount + gap;
    if (next <= 0) {
      return {
        ok: false,
        error: "Le solde calibré rendrait la transaction initiale négative ou nulle.",
      };
    }
    const { error: updErr } = await supabase
      .from("transactions")
      .update({ gross_amount: next })
      .eq("id", initialRow.id);
    if (updErr) return { ok: false, error: updErr.message };
    revalidatePath("/portfolio");
    return { ok: true, gap, action: "updated" };
  }

  if (gap <= 0) {
    return {
      ok: false,
      error:
        "Aucune transaction initiale à ajuster — calibrage descendant nécessite un dépôt préalable.",
    };
  }

  // Insert a deposit dated one day before the earliest flow (or atDate when
  // the bucket has no other flows yet).
  const anchorDate = firstDate ?? atDate;
  const initialDate = shiftDate(anchorDate < atDate ? anchorDate : atDate, -1);

  const { error: insErr } = await supabase.from("transactions").insert({
    user_id: user.id,
    account_id: accountId,
    instrument_id: null,
    kind: "deposit",
    trade_date: initialDate,
    quantity: null,
    price: null,
    gross_amount: gap,
    fees: 0,
    currency,
    fx_rate: fxRate,
    notes: INITIAL_CASH_NOTE,
    broker,
    support,
  });
  if (insErr) return { ok: false, error: insErr.message };

  revalidatePath("/portfolio");
  return { ok: true, gap, action: "inserted" };
}

export async function deleteOrder(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/portfolio");
}

export async function deleteTransactionsByBroker(
  brokerName: string,
  accountIdOverride?: string,
): Promise<{ deleted: number } | { ok: false; error: string }> {
  if (!brokerName || brokerName.length > 200) {
    return { ok: false, error: "Nom de courtier invalide." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Non authentifié." };

  const resolved = await resolveWritableAccountId(accountIdOverride ?? null);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const accountId = resolved.accountId;

  const { data, error } = await supabase
    .from("transactions")
    .delete()
    .eq("user_id", user.id)
    .eq("account_id", accountId)
    .eq("broker", brokerName)
    .select("id");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/portfolio");
  return { deleted: data?.length ?? 0 };
}

export async function fetchAvailableListings(isin: string): Promise<Listing[]> {
  const cleaned = isin.trim().toUpperCase();
  if (!cleaned) return [];
  // Authentication required to avoid leaking provider quota to anonymous callers.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const listings = await quoteProvider.searchListings(cleaned);
  // Sort by the same ranking used for auto-pick so the preferred candidate
  // surfaces first in the UI list.
  const preferred = pickPreferredListing(listings);
  if (!preferred) return listings;
  const head = listings.find((l) => l.providerSymbol === preferred.providerSymbol);
  if (!head) return listings;
  return [head, ...listings.filter((l) => l.providerSymbol !== preferred.providerSymbol)];
}

export type SetInstrumentListingResult = { ok: true } | { ok: false; error: string };

export async function setInstrumentListing(
  instrumentId: string,
  mic: string,
  currency: string,
): Promise<SetInstrumentListingResult> {
  const cleanedMic = mic.trim().toUpperCase();
  const cleanedCcy = currency.trim().toUpperCase();
  if (!instrumentId) return { ok: false, error: "Instrument inconnu." };
  if (!cleanedMic) return { ok: false, error: "MIC requis." };
  if (!cleanedCcy) return { ok: false, error: "Devise requise." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Non authentifié." };

  // Ownership check: when a specific account is active, restrict to that
  // account's transactions. In ALL mode, fall back to the user-wide check
  // so consolidated views can still edit listings they hold somewhere.
  const active = await getActiveAccount();
  let txnQuery = supabase
    .from("transactions")
    .select("id")
    .eq("user_id", user.id)
    .eq("instrument_id", instrumentId);
  if (active !== ALL_ACCOUNTS) {
    txnQuery = txnQuery.eq("account_id", active);
  }
  const { data: txn, error: txnErr } = await txnQuery.limit(1).maybeSingle();
  if (txnErr) return { ok: false, error: txnErr.message };
  if (!txn) return { ok: false, error: "Instrument non détenu par cet utilisateur." };

  const { error: updErr } = await supabase
    .from("instruments")
    .update({
      preferred_mic: cleanedMic,
      preferred_currency: cleanedCcy,
      currency: cleanedCcy,
      provider: null,
      provider_symbol: null,
    })
    .eq("id", instrumentId);
  if (updErr) return { ok: false, error: updErr.message };

  revalidatePath("/portfolio");
  return { ok: true };
}

export type SetBondMetadataResult = { ok: true } | { ok: false; error: string };

export async function setBondMetadata(args: {
  instrumentId: string;
  couponRate: number;
  maturityDate: string;
  frequency: 1 | 2 | 4;
}): Promise<SetBondMetadataResult> {
  const { instrumentId, couponRate, maturityDate, frequency } = args;

  if (!instrumentId) return { ok: false, error: "Instrument inconnu." };
  if (!Number.isFinite(couponRate) || couponRate < 0 || couponRate >= 30) {
    return { ok: false, error: "Coupon invalide (0 à 30 %)." };
  }
  if (frequency !== 1 && frequency !== 2 && frequency !== 4) {
    return { ok: false, error: "Fréquence invalide (1, 2 ou 4)." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(maturityDate)) {
    return { ok: false, error: "Date de maturité invalide." };
  }
  const parsed = new Date(`${maturityDate}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== maturityDate
  ) {
    return { ok: false, error: "Date de maturité invalide." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Non authentifié." };

  // Mirror setInstrumentListing: only allow editing an instrument the user
  // actually holds via at least one transaction. Scopes to the active account
  // when one is selected; falls back to user-wide in ALL mode.
  const active = await getActiveAccount();
  let txnQuery = supabase
    .from("transactions")
    .select("id")
    .eq("user_id", user.id)
    .eq("instrument_id", instrumentId);
  if (active !== ALL_ACCOUNTS) {
    txnQuery = txnQuery.eq("account_id", active);
  }
  const { data: txn, error: txnErr } = await txnQuery.limit(1).maybeSingle();
  if (txnErr) return { ok: false, error: txnErr.message };
  if (!txn) return { ok: false, error: "Instrument non détenu par cet utilisateur." };

  const { error: updErr } = await supabase
    .from("instruments")
    .update({
      bond_coupon_rate: couponRate,
      bond_maturity_date: maturityDate,
      bond_coupon_frequency: frequency,
    })
    .eq("id", instrumentId);
  if (updErr) return { ok: false, error: updErr.message };

  revalidatePath("/portfolio");
  return { ok: true };
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
  symbol: string | null;
  asset_class: string | null;
  name: string;
  currency: string;
  preferred_mic: string | null;
  preferred_currency: string | null;
  provider: string | null;
  provider_symbol: string | null;
  current_price: number | null;
  current_price_updated_at: string | null;
};

const FX_TTL_MS = 24 * 60 * 60 * 1000; // 24 h — FX moves slowly enough; daily refresh suffices

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

  const active = await getActiveAccount();
  let rowsQuery = supabase
    .from("transactions")
    .select(
      `
        instrument:instruments(
          id,
          isin,
          symbol,
          asset_class,
          name,
          currency,
          preferred_mic,
          preferred_currency,
          provider,
          provider_symbol,
          current_price,
          current_price_updated_at
        )
      `,
    )
    .in("kind", ["buy", "sell"]);
  if (active !== ALL_ACCOUNTS) {
    rowsQuery = rowsQuery.eq("account_id", active);
  }
  const { data: rows, error } = await rowsQuery;

  if (error) throw error;

  const byId = new Map<string, RefreshableInstrument>();
  for (const row of rows ?? []) {
    const inst = row.instrument;
    if (!inst || !inst.id) continue;
    if (byId.has(inst.id)) continue;
    byId.set(inst.id, {
      id: inst.id,
      isin: inst.isin ?? null,
      symbol: inst.symbol ?? null,
      asset_class: inst.asset_class ?? null,
      name: inst.name,
      currency: inst.currency ?? "EUR",
      preferred_mic: inst.preferred_mic ?? null,
      preferred_currency: inst.preferred_currency ?? null,
      provider: inst.provider ?? null,
      provider_symbol: inst.provider_symbol ?? null,
      current_price: inst.current_price ?? null,
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

  // Step 1 — auto-pick a preferred listing for instruments without one.
  // Crypto uses CoinGecko (search by symbol, EUR-native), everything else
  // routes through EODHD with an ISIN.
  for (const inst of stale) {
    if (inst.preferred_mic) continue;
    const provider = pickProviderFor(inst.asset_class);
    const isCrypto = inst.asset_class === "crypto";
    const searchKey = isCrypto ? inst.symbol : inst.isin;
    if (!searchKey) {
      failed.push(inst.isin ?? inst.symbol ?? inst.name);
      continue;
    }
    const listings = await provider.searchListings(searchKey);
    const chosen = isCrypto ? listings[0] : pickPreferredListing(listings);
    if (!chosen) {
      failed.push(searchKey);
      continue;
    }
    const { error: updErr } = await supabase
      .from("instruments")
      .update({
        preferred_mic: chosen.mic,
        preferred_currency: chosen.currency,
        currency: chosen.currency,
        provider: provider.name,
        provider_symbol: chosen.providerSymbol,
      })
      .eq("id", inst.id);
    if (updErr) {
      failed.push(searchKey);
      continue;
    }
    inst.preferred_mic = chosen.mic;
    inst.preferred_currency = chosen.currency;
    inst.currency = chosen.currency;
    inst.provider = provider.name;
    inst.provider_symbol = chosen.providerSymbol;
  }

  // Step 2 — remap provider_symbol when the stored provider no longer
  // matches the active one (or the symbol was never persisted).
  for (const inst of stale) {
    if (!inst.preferred_mic) continue;
    const provider = pickProviderFor(inst.asset_class);
    if (inst.provider === provider.name && inst.provider_symbol) continue;
    const isCrypto = inst.asset_class === "crypto";
    const searchKey = isCrypto ? inst.symbol : inst.isin;
    if (!searchKey) {
      failed.push(inst.isin ?? inst.symbol ?? inst.name);
      continue;
    }
    const listings = await provider.searchListings(searchKey);
    const match = isCrypto
      ? (listings[0] ?? null)
      : findListingForPreference(listings, inst.preferred_mic, inst.preferred_currency);
    if (!match) {
      failed.push(searchKey);
      continue;
    }
    const nextCurrency = inst.preferred_currency ?? match.currency;
    const { error: updErr } = await supabase
      .from("instruments")
      .update({
        provider: provider.name,
        provider_symbol: match.providerSymbol,
        currency: nextCurrency,
      })
      .eq("id", inst.id);
    if (updErr) {
      failed.push(searchKey);
      continue;
    }
    inst.provider = provider.name;
    inst.provider_symbol = match.providerSymbol;
    inst.currency = nextCurrency;
  }

  // Step 3 — fetch a fresh quote per instrument and apply the divergence guard.
  let refreshed = 0;
  const updatedAt = new Date().toISOString();
  for (const inst of stale) {
    if (!inst.provider_symbol) continue;
    const provider = pickProviderFor(inst.asset_class);
    const quote = await provider.fetchQuote(inst.provider_symbol);
    if (!quote) {
      failed.push(inst.isin ?? inst.name);
      continue;
    }
    if (shouldRejectDivergentQuote(inst.current_price, quote.close, force)) {
      failed.push(
        `${inst.isin ?? inst.name}: divergence >50%, kept ${inst.current_price} -> ${quote.close}`,
      );
      continue;
    }
    const { error: updErr } = await supabase
      .from("instruments")
      .update({
        current_price: quote.close,
        current_price_updated_at: updatedAt,
      })
      .eq("id", inst.id);
    if (updErr) {
      failed.push(inst.isin ?? inst.name);
      continue;
    }
    inst.current_price = quote.close;
    refreshed += 1;
  }

  // Step 4 — refresh FX cache for every distinct non-EUR currency we touched.
  // instrument.currency is kept aligned with preferred_currency above, so a
  // GBX/GBP/USD listing surfaces here automatically.
  const currencies = new Set<string>();
  for (const inst of byId.values()) {
    const ccy = (inst.currency || "EUR").toUpperCase();
    if (ccy !== "EUR") currencies.add(ccy);
  }
  if (currencies.size > 0) {
    const { data: existingFx } = await supabase
      .from("fx_rates")
      .select("currency, fetched_at")
      .in("currency", Array.from(currencies));
    const fxByCcy = new Map((existingFx ?? []).map((r) => [r.currency, r.fetched_at]));
    for (const ccy of currencies) {
      const last = fxByCcy.get(ccy);
      if (!force && last) {
        const age = now - Date.parse(last);
        if (Number.isFinite(age) && age < FX_TTL_MS) continue;
      }
      const rate = await quoteProvider.fetchFxToEur(ccy);
      if (rate == null) {
        failed.push(`FX ${ccy}->EUR`);
        continue;
      }
      const { error: fxErr } = await supabase
        .from("fx_rates")
        .upsert(
          { currency: ccy, eur_rate: rate, fetched_at: updatedAt },
          { onConflict: "currency" },
        );
      if (fxErr) failed.push(`FX ${ccy}->EUR`);
    }
  }

  if (refreshed > 0) revalidatePath("/portfolio");

  return { refreshed, skipped, failed };
}
