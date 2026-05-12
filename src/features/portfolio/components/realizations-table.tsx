"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { fmtCcy, fmtDateFR, fmtInt, fmtNum } from "../format";
import type { PastRealization } from "../realize";
import { ColumnsPicker } from "./columns/columns-picker";
import type { ColumnDef } from "./columns/types";
import { useVisibleColumns } from "./columns/use-visible-columns";
import { DeltaPill } from "./delta-pill";
import { MoneyCell } from "./money-cell";
import { SupportTag } from "./support-tag";

type SortKey =
  | "saleDate"
  | "instrument"
  | "qtySold"
  | "pruAtSale"
  | "saleNet"
  | "dividends"
  | "realizedTotal"
  | "xirr";

type RealizationColKey =
  | "saleDate"
  | "instrument"
  | "support"
  | "qtySold"
  | "pruAtSale"
  | "saleNet"
  | "dividends"
  | "realizedTotal"
  | "xirr";

const REALIZATION_COLUMNS: readonly ColumnDef<RealizationColKey>[] = [
  { key: "saleDate", label: "Date vente", always: true },
  { key: "instrument", label: "Instrument", always: true },
  { key: "support", label: "Support", defaultVisible: true },
  { key: "qtySold", label: "Qté vendue", num: true, defaultVisible: true },
  { key: "pruAtSale", label: "PRU à la vente", num: true, defaultVisible: true },
  { key: "saleNet", label: "Encaissé net", num: true, defaultVisible: true },
  { key: "dividends", label: "Div attribués", num: true, defaultVisible: true },
  { key: "realizedTotal", label: "Plus-value", num: true, defaultVisible: true },
  { key: "xirr", label: "XIRR", num: true, defaultVisible: true },
];

export function RealizationsTable({
  realizations,
  withDividends,
}: {
  realizations: PastRealization[];
  withDividends: boolean;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "saleDate",
    dir: "desc",
  });

  const { shown, toggle, reset, showAll, visible, visibleCount } = useVisibleColumns(
    "gainvest:realizations:visible-columns",
    REALIZATION_COLUMNS,
  );

  const sorted = useMemo(() => {
    return realizations.slice().sort((a, b) => {
      const av = readSortValue(a, sort.key, withDividends);
      const bv = readSortValue(b, sort.key, withDividends);
      if (typeof av === "string" && typeof bv === "string") {
        return sort.dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = Number(av);
      const bn = Number(bv);
      if (!Number.isFinite(an) && !Number.isFinite(bn)) return 0;
      if (!Number.isFinite(an)) return 1;
      if (!Number.isFinite(bn)) return -1;
      return sort.dir === "asc" ? an - bn : bn - an;
    });
  }, [realizations, sort, withDividends]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));

  if (realizations.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-sm">
          {realizations.length} vente{realizations.length > 1 ? "s" : ""} passée
          {realizations.length > 1 ? "s" : ""}
        </span>
        <ColumnsPicker
          columns={REALIZATION_COLUMNS}
          visible={visible}
          visibleCount={visibleCount}
          onToggle={toggle}
          onReset={reset}
          onShowAll={showAll}
        />
      </div>
      <div className="border-border overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <SortHead k="saleDate" sort={sort} onSort={toggleSort}>
                Date vente
              </SortHead>
              <SortHead k="instrument" sort={sort} onSort={toggleSort}>
                Instrument
              </SortHead>
              {shown("support") ? <TableHead>Support</TableHead> : null}
              {shown("qtySold") ? (
                <SortHead k="qtySold" sort={sort} onSort={toggleSort} num>
                  Qté vendue
                </SortHead>
              ) : null}
              {shown("pruAtSale") ? (
                <SortHead k="pruAtSale" sort={sort} onSort={toggleSort} num>
                  PRU à la vente
                </SortHead>
              ) : null}
              {shown("saleNet") ? (
                <SortHead k="saleNet" sort={sort} onSort={toggleSort} num>
                  Encaissé net
                </SortHead>
              ) : null}
              {shown("dividends") ? (
                <SortHead k="dividends" sort={sort} onSort={toggleSort} num>
                  Div attribués
                </SortHead>
              ) : null}
              {shown("realizedTotal") ? (
                <SortHead k="realizedTotal" sort={sort} onSort={toggleSort} num>
                  Plus-value
                </SortHead>
              ) : null}
              {shown("xirr") ? (
                <SortHead k="xirr" sort={sort} onSort={toggleSort} num>
                  XIRR
                </SortHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => {
              const realized = withDividends ? r.pnlTotal : r.pnlCapital;
              const xirrValue = withDividends ? r.xirrTotal : r.xirrCapital;
              return (
                <TableRow key={`${r.key}::${r.saleDate}::${r.saleQty}::${r.saleNet}`}>
                  <TableCell>{fmtDateFR(r.saleDate)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{r.instrumentName}</span>
                      <span className="text-muted-foreground font-mono text-xs">
                        {r.isin} · {r.currency}
                      </span>
                    </div>
                  </TableCell>
                  {shown("support") ? (
                    <TableCell>
                      <SupportTag support={r.support} />
                    </TableCell>
                  ) : null}
                  {shown("qtySold") ? (
                    <TableCell className="text-right font-mono tabular-nums">
                      {fmtInt(r.saleQty)}
                    </TableCell>
                  ) : null}
                  {shown("pruAtSale") ? (
                    <TableCell className="text-right font-mono tabular-nums">
                      {fmtNum(r.pruAtSale, r.pruAtSale < 50 ? 3 : 2)} €
                    </TableCell>
                  ) : null}
                  {shown("saleNet") ? (
                    <TableCell className="text-right font-mono tabular-nums">
                      {fmtCcy(r.saleNet, 2)}
                    </TableCell>
                  ) : null}
                  {shown("dividends") ? (
                    <TableCell className="text-right font-mono tabular-nums">
                      {r.dividendsAttributed > 0.005 ? fmtCcy(r.dividendsAttributed, 2) : "—"}
                    </TableCell>
                  ) : null}
                  {shown("realizedTotal") ? (
                    <TableCell className="text-right">
                      <MoneyCell value={realized} dp={2} signed />
                    </TableCell>
                  ) : null}
                  {shown("xirr") ? (
                    <TableCell className="text-right">
                      {Number.isFinite(xirrValue) ? (
                        <DeltaPill value={xirrValue} />
                      ) : (
                        <span className="text-muted-foreground font-mono text-xs">—</span>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  function SortHead({
    k,
    sort,
    onSort,
    num,
    children,
  }: {
    k: SortKey;
    sort: { key: SortKey; dir: "asc" | "desc" };
    onSort: (k: SortKey) => void;
    num?: boolean;
    children: React.ReactNode;
  }) {
    const active = sort.key === k;
    const Icon = active ? (sort.dir === "desc" ? ChevronDown : ChevronUp) : null;
    return (
      <TableHead
        onClick={() => onSort(k)}
        className={cn("cursor-pointer select-none", num ? "text-right" : undefined)}
      >
        <span className={cn("inline-flex items-center gap-1", num && "justify-end")}>
          {children}
          {Icon ? <Icon className="size-3" /> : null}
        </span>
      </TableHead>
    );
  }
}

function readSortValue(r: PastRealization, key: SortKey, withDividends: boolean): string | number {
  switch (key) {
    case "saleDate":
      return r.saleDate;
    case "instrument":
      return r.instrumentName;
    case "qtySold":
      return r.saleQty;
    case "pruAtSale":
      return r.pruAtSale;
    case "saleNet":
      return r.saleNet;
    case "dividends":
      return r.dividendsAttributed;
    case "realizedTotal":
      return withDividends ? r.pnlTotal : r.pnlCapital;
    case "xirr":
      return withDividends ? r.xirrTotal : r.xirrCapital;
  }
}

function EmptyState() {
  return (
    <div className="border-border bg-muted/30 flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
      <h3 className="text-base font-medium">Aucune vente passée</h3>
      <p className="text-muted-foreground max-w-sm text-sm">
        Quand tu vendras une partie d&apos;une position, l&apos;historique apparaîtra ici.
      </p>
    </div>
  );
}
