import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getCryptoPriceEur } from "@/lib/quotes/providers/coingecko-history";
import { createClient } from "@/lib/supabase/server";

import type { OrderRow } from "@/features/portfolio/aggregate";
import {
  computeFrenchCryptoTax,
  CRYPTO_TAX_THRESHOLD_EUR,
} from "@/features/portfolio/crypto-tax";
import { fmtCcy, fmtDateFR } from "@/features/portfolio/format";
import { getOrders } from "@/features/portfolio/queries";

export const metadata: Metadata = {
  title: "Fiscal crypto",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ year: string }>;
};

export default async function FiscalCryptoYearPage({ params }: PageProps) {
  const { year: yearParam } = await params;
  const year = Number.parseInt(yearParam, 10);

  if (!Number.isFinite(year) || year < 2000 || year > 9999) {
    return <InvalidYear value={yearParam} />;
  }

  const orders = await getOrders();
  const cryptoOrders = orders.filter((o) => o.assetClass === "crypto");

  // Step 1 — for every crypto coin held at any point this year, resolve its
  // CoinGecko provider id via the instruments table (we already store it on
  // every crypto instrument since LOT 3 / LOT 5).
  const supabase = await createClient();
  const instrumentIds = Array.from(
    new Set(cryptoOrders.map((o) => o.instrumentId).filter((x): x is string => !!x)),
  );
  const providerSymbolByInstrumentId = new Map<string, string>();
  if (instrumentIds.length > 0) {
    const { data } = await supabase
      .from("instruments")
      .select("id, provider_symbol")
      .in("id", instrumentIds);
    for (const row of data ?? []) {
      if (row.id && row.provider_symbol) {
        providerSymbolByInstrumentId.set(row.id, row.provider_symbol);
      }
    }
  }

  const providerSymbolFor = (o: OrderRow): string | null => {
    if (!o.instrumentId) return null;
    return providerSymbolByInstrumentId.get(o.instrumentId) ?? null;
  };

  // Step 2 — collect every (providerSymbol, cessionDate) pair we'll need.
  // Each fiat sell triggers a portfolio-valuation snapshot at its date, so
  // we need a price for every coin still held at every cession date.
  const cessionDates = Array.from(
    new Set(
      cryptoOrders
        .filter((o) => o.kind === "sell" && o.convertPairId === null)
        .filter((o) => o.tradeDate.startsWith(String(year)))
        .map((o) => o.tradeDate),
    ),
  );
  const providerSymbols = Array.from(
    new Set(
      cryptoOrders
        .map((o) => providerSymbolFor(o))
        .filter((x): x is string => !!x),
    ),
  );

  // Step 3 — resolve every needed price (cache-first, CoinGecko fallback).
  // Map<date, Map<providerSymbol, eurPrice>> for O(1) lookup in the pure
  // calculator below.
  const priceByDateBySymbol = new Map<string, Map<string, number>>();
  for (const date of cessionDates) {
    const perDate = new Map<string, number>();
    for (const sym of providerSymbols) {
      const res = await getCryptoPriceEur(supabase, { providerSymbol: sym, date });
      if (res.ok) perDate.set(sym, res.priceEur);
    }
    priceByDateBySymbol.set(date, perDate);
  }

  const priceAt = (providerSymbol: string, date: string): number | null => {
    const perDate = priceByDateBySymbol.get(date);
    if (!perDate) return null;
    return perDate.get(providerSymbol) ?? null;
  };

  // Step 4 — pure fiscal computation.
  const summary = computeFrenchCryptoTax(orders, { year, providerSymbolFor, priceAt });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">
          Fiscal crypto — {year}
        </h1>
        <p className="text-muted-foreground text-sm">
          Art. 150 VH bis · plus-value brute calculée par la méthode du PMP
          global. Les conversions crypto-crypto sont exclues du périmètre fiscal.
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Cessions fiat" value={fmtCcy(summary.totalCessions, 2)} />
        <Kpi label="Coût attribué" value={fmtCcy(summary.totalCostShare, 2)} />
        <Kpi
          label="Plus-value brute"
          value={fmtCcy(summary.totalPlusValueBrute, 2)}
          highlight
        />
        <Kpi
          label="Statut"
          value={
            summary.belowThreshold ? `Sous seuil ${CRYPTO_TAX_THRESHOLD_EUR} €` : "Imposable"
          }
        />
      </section>

      {summary.incomplete ? (
        <div className="border-warning/40 bg-warning/10 text-warning-foreground rounded-lg border px-4 py-3 text-sm">
          <p className="font-medium">Calcul incomplet — ne pas déclarer en l&apos;état.</p>
          <p className="text-muted-foreground mt-1">
            Au moins un prix historique CoinGecko n&apos;a pas pu être résolu pour
            une date de cession. Voir la colonne <em>Manquants</em> ci-dessous.
          </p>
        </div>
      ) : null}

      {summary.cessions.length === 0 ? (
        <div className="border-border bg-muted/30 flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
          <h3 className="text-base font-medium">
            Aucune cession fiat sur {year}
          </h3>
          <p className="text-muted-foreground max-w-sm text-sm">
            Les conversions Coinbase liées par <code>convert_pair_id</code> sont
            exclues du périmètre fiscal et n&apos;apparaissent jamais ici.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Coin</TableHead>
                <TableHead className="text-right">Encaissé</TableHead>
                <TableHead className="text-right">Coût attribué</TableHead>
                <TableHead className="text-right">Plus-value</TableHead>
                <TableHead className="text-right">Valeur ptf à la date</TableHead>
                <TableHead>Manquants</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.cessions.map((c, idx) => (
                <TableRow key={`${c.date}-${c.symbol}-${idx}`}>
                  <TableCell>{fmtDateFR(c.date)}</TableCell>
                  <TableCell className="font-mono">{c.symbol}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtCcy(c.proceedsEur, 2)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtCcy(c.costShareEur, 2)}
                  </TableCell>
                  <TableCell
                    className={
                      "text-right font-mono tabular-nums " +
                      (c.plusValueBrute >= 0 ? "text-success" : "text-danger")
                    }
                  >
                    {fmtCcy(c.plusValueBrute, 2)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtCcy(c.portfolioValueAtDate, 2)}
                  </TableCell>
                  <TableCell>
                    {c.missingPrices.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {c.missingPrices.map((s) => (
                          <Badge
                            key={s}
                            variant="outline"
                            className="border-warning/40 bg-warning/10"
                          >
                            {s}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="border-border bg-card flex flex-col gap-1 rounded-lg border p-4">
      <span className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </span>
      <span
        className={
          "font-mono tabular-nums " +
          (highlight ? "text-foreground text-lg font-semibold" : "text-base")
        }
      >
        {value}
      </span>
    </div>
  );
}

function InvalidYear({ value }: { value: string }) {
  return (
    <div className="border-border bg-muted/30 flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
      <h3 className="text-base font-medium">Année invalide : {value}</h3>
      <p className="text-muted-foreground text-sm">
        Utilise une URL de la forme <code>/fiscal/crypto/2025</code>.
      </p>
    </div>
  );
}
