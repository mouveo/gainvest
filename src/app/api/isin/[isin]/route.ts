import { NextResponse, type NextRequest } from "next/server";

import { isValidIsin, lookupIsin, type IsinLookup } from "@/lib/openfigi";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ isin: string }> },
) {
  const raw = (await params).isin ?? "";
  const isin = raw.trim().toUpperCase();

  if (!isValidIsin(isin)) {
    return NextResponse.json({ ok: false, error: "ISIN invalide." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Non authentifié." }, { status: 401 });
  }

  const { data: cachedBySymbol } = await supabase
    .from("instruments")
    .select("isin, symbol, name, asset_class, currency, country")
    .eq("symbol", isin)
    .maybeSingle();

  let cached = cachedBySymbol;
  if (!cached) {
    const { data: cachedByIsin } = await supabase
      .from("instruments")
      .select("isin, symbol, name, asset_class, currency, country")
      .eq("isin", isin)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    cached = cachedByIsin;
  }

  if (cached?.name) {
    const data: IsinLookup = {
      isin: cached.isin ?? isin,
      name: cached.name,
      assetClass: cached.asset_class as IsinLookup["assetClass"],
      currency: cached.currency,
      country: cached.country,
      ticker: null,
      exchCode: null,
      source: "cache",
    };
    return NextResponse.json({ ok: true, data });
  }

  const remote = await lookupIsin(isin);
  if (!remote) {
    return NextResponse.json({ ok: false, error: "ISIN introuvable." }, { status: 404 });
  }

  await supabase.from("instruments").insert({
    isin: remote.isin,
    symbol: remote.isin,
    mic: null,
    name: remote.name,
    asset_class: remote.assetClass,
    currency: remote.currency,
    country: remote.country,
  });

  return NextResponse.json({ ok: true, data: remote });
}
