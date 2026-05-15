import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

// CoinGecko historical price helper for the French art. 150 VH bis fiscal
// calculator. Reads from `crypto_prices_daily` first; on a miss, calls
// `/coins/{id}/history?date=DD-MM-YYYY` and writes the result back. Returns
// null when the price is unavailable so the caller can mark the cession as
// "incomplete" without bailing out.
//
// Reference: https://docs.coingecko.com/reference/coins-id-history

const BASE = "https://api.coingecko.com/api/v3";
const TIMEOUT_MS = 7000;

function headers(): HeadersInit {
  const key = process.env["COINGECKO_API_KEY"];
  return key ? { "x-cg-demo-api-key": key } : {};
}

// CoinGecko expects DD-MM-YYYY (their docs are explicit about this format and
// reject ISO dates with a 422).
function toCoingeckoDate(iso: string): string | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

type SupabaseLike = SupabaseClient<Database>;

export type HistoricalPriceLookup = {
  providerSymbol: string;
  date: string; // YYYY-MM-DD
};

export type HistoricalPriceResult =
  | { ok: true; priceEur: number; source: "cache" | "coingecko" }
  | { ok: false; reason: "format" | "cache-miss-and-fetch-failed" };

export async function getCryptoPriceEur(
  supabase: SupabaseLike,
  lookup: HistoricalPriceLookup,
): Promise<HistoricalPriceResult> {
  const date = lookup.date;
  const providerSymbol = lookup.providerSymbol.trim();
  if (!providerSymbol || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, reason: "format" };
  }

  // 1. cache lookup
  const cached = await supabase
    .from("crypto_prices_daily")
    .select("price_eur")
    .eq("provider_symbol", providerSymbol)
    .eq("date", date)
    .eq("currency", "EUR")
    .maybeSingle();
  if (cached.data && cached.data.price_eur != null) {
    return { ok: true, priceEur: Number(cached.data.price_eur), source: "cache" };
  }

  // 2. CoinGecko remote fetch
  const cgDate = toCoingeckoDate(date);
  if (!cgDate) return { ok: false, reason: "format" };
  const url = `${BASE}/coins/${encodeURIComponent(providerSymbol)}/history?date=${cgDate}&localization=false`;
  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      headers: headers(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "cache-miss-and-fetch-failed" };
  }
  if (!res.ok) return { ok: false, reason: "cache-miss-and-fetch-failed" };

  type HistoryPayload = {
    market_data?: {
      current_price?: Record<string, number | string | undefined>;
    };
  };
  const data = (await res.json()) as HistoryPayload;
  const raw = data?.market_data?.current_price?.["eur"];
  const priceEur = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
  if (!Number.isFinite(priceEur) || priceEur <= 0) {
    return { ok: false, reason: "cache-miss-and-fetch-failed" };
  }

  // 3. write-back (best effort — failure to cache doesn't fail the lookup)
  await supabase.from("crypto_prices_daily").upsert(
    {
      provider_symbol: providerSymbol,
      date,
      currency: "EUR",
      price_eur: priceEur,
      source: "coingecko",
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "provider_symbol,date,currency" },
  );

  return { ok: true, priceEur, source: "coingecko" };
}
