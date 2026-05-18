"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef as TanstackColumnDef } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { bootstrapView } from "@/features/saved-views/actions";
import { ViewsSwitcher } from "@/features/saved-views/components/views-switcher";
import { useViewState } from "@/features/saved-views/use-view-state";

import type { CurrentPrice } from "../aggregate";
import { fmtCcy, fmtDateFR, fmtInt, fmtNum, fmtPct } from "../format";
import { ASSET_CLASS_FACETED_OPTIONS, labelAssetClass } from "../labels";
import type { PastRealization } from "../realize";
import { SUPPORTS } from "../types";
import { REALIZATION_TOOLTIPS } from "./column-tooltips";
import { ColumnsPicker } from "./columns/columns-picker";
import type { ColumnDef as PickerColumnDef } from "./columns/types";
import { useVisibleColumns } from "./columns/use-visible-columns";
import { DeltaPill } from "./delta-pill";
import { MoneyCell } from "./money-cell";
import { SupportTag } from "./support-tag";

type RealizationColKey =
  | "saleDate"
  | "instrument"
  | "support"
  | "type"
  | "operateur"
  | "qtySold"
  | "pruAtSale"
  | "salePrice"
  | "currentPrice"
  | "spread"
  | "saleNet"
  | "dividends"
  | "holdingFees"
  | "realizedTotal"
  | "xirr";

const REALIZATIONS_VISIBILITY_KEY = "gainvest:realizations:visible-columns";

const REALIZATION_COLUMNS: readonly PickerColumnDef<RealizationColKey>[] = [
  { key: "saleDate", label: "Date de vente", always: true },
  { key: "instrument", label: "Instrument", always: true },
  { key: "support", label: "Support", defaultVisible: true },
  { key: "type", label: "Type", defaultVisible: true },
  { key: "operateur", label: "Opérateur", defaultVisible: true },
  { key: "qtySold", label: "Quantité vendue", num: true, defaultVisible: true },
  { key: "pruAtSale", label: "Prix d'achat / action", num: true, defaultVisible: true },
  { key: "salePrice", label: "Prix de vente / action", num: true, defaultVisible: true },
  { key: "currentPrice", label: "Cours actuel", num: true, defaultVisible: true },
  { key: "spread", label: "Spread après vente", num: true, defaultVisible: false },
  { key: "saleNet", label: "Encaissé net", num: true, defaultVisible: true },
  { key: "dividends", label: "Dividendes attribués", num: true, defaultVisible: true },
  { key: "holdingFees", label: "Frais de détention attribués", num: true, defaultVisible: false },
  { key: "realizedTotal", label: "Réalisé total", num: true, defaultVisible: true },
  { key: "xirr", label: "XIRR", num: true, defaultVisible: true },
];

function salePricePerShare(r: PastRealization): number {
  return r.saleQty > 0 ? r.saleNet / r.saleQty : 0;
}

function migrateRealizationsVisibilityKey(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(REALIZATIONS_VISIBILITY_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return;
    const persisted = parsed as Record<string, unknown>;
    if (typeof persisted.operateur === "boolean") return;
    persisted.operateur = true;
    window.localStorage.setItem(REALIZATIONS_VISIBILITY_KEY, JSON.stringify(persisted));
  } catch {
    // ignore corrupted JSON, quota errors, private mode, etc.
  }
}

export function RealizationsTable({
  realizations,
  withDividends,
  setWithDividends,
  netOfFees,
  setNetOfFees,
  inflationAdjusted = false,
  setInflationAdjusted,
  priceByIsin,
  onVisibleRowsChange,
}: {
  realizations: PastRealization[];
  withDividends: boolean;
  setWithDividends?: (value: boolean) => void;
  netOfFees: boolean;
  setNetOfFees?: (value: boolean) => void;
  inflationAdjusted?: boolean;
  setInflationAdjusted?: (value: boolean) => void;
  priceByIsin: Record<string, CurrentPrice>;
  onVisibleRowsChange?: (rows: PastRealization[]) => void;
}) {
  const realSuffix = inflationAdjusted ? " (€ réels)" : "";
  useState(() => {
    migrateRealizationsVisibilityKey();
    return null;
  });

  const { toggle, reset, showAll, visible, visibleCount, setVisible } = useVisibleColumns(
    REALIZATIONS_VISIBILITY_KEY,
    REALIZATION_COLUMNS,
  );

  const viewState = useViewState({ scope: "realizations" });
  const { search, setSearch } = viewState;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await bootstrapView("realizations");
      if (cancelled || !res.ok || !res.result) return;
      if (res.result.activeOnly) {
        viewState.setActiveViewId(res.result.id);
        return;
      }
      viewState.applyPayload(res.result.payload, {
        id: res.result.id,
        setVisibleColumns: setVisible,
        toggleSetters:
          setWithDividends && setNetOfFees && setInflationAdjusted
            ? { setWithDividends, setNetOfFees, setInflationAdjusted }
            : undefined,
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredBySearch = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return realizations;
    return realizations.filter((r) =>
      `${r.isin} ${r.instrumentName} ${r.broker ?? ""}`.toLowerCase().includes(q),
    );
  }, [realizations, search]);

  const operatorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of realizations) set.add(r.broker ?? "—");
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, "fr"))
      .map((v) => ({ label: v, value: v }));
  }, [realizations]);

  const columns = useMemo<TanstackColumnDef<PastRealization>[]>(
    () => [
      {
        id: "saleDate",
        accessorFn: (r) => r.saleDate,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date de vente" tooltip={REALIZATION_TOOLTIPS.saleDate} />,
        cell: ({ row }) => fmtDateFR(row.original.saleDate),
        filterFn: "dateRange",
      },
      {
        id: "instrument",
        accessorFn: (r) => r.instrumentName,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Instrument" tooltip={REALIZATION_TOOLTIPS.instrument} />,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex flex-col">
              <span className="font-medium">{r.instrumentName}</span>
              <span className="text-muted-foreground font-mono text-xs">
                {r.isin} · {r.currency}
              </span>
            </div>
          );
        },
      },
      {
        id: "support",
        accessorFn: (r) => r.support,
        header: "Support",
        cell: ({ row }) => <SupportTag support={row.original.support} />,
        enableSorting: false,
        filterFn: "multiSelect",
      },
      {
        id: "type",
        accessorFn: (r) => r.assetClass,
        header: "Type",
        cell: ({ row }) => (
          <Badge variant="outline">{labelAssetClass(row.original.assetClass)}</Badge>
        ),
        enableSorting: false,
        filterFn: "multiSelect",
      },
      {
        id: "operateur",
        accessorFn: (r) => r.broker ?? "—",
        header: "Opérateur",
        cell: ({ row }) => <span className="text-sm">{row.original.broker ?? "—"}</span>,
        enableSorting: false,
        filterFn: "multiSelect",
      },
      {
        id: "qtySold",
        accessorFn: (r) => r.saleQty,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Quantité vendue" tooltip={REALIZATION_TOOLTIPS.qtySold} align="right" />
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono tabular-nums">{fmtInt(row.original.saleQty)}</div>
        ),
      },
      {
        id: "pruAtSale",
        accessorFn: (r) => r.pruAtSale,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Prix d'achat / action" tooltip={REALIZATION_TOOLTIPS.pruAtSale} align="right" />
        ),
        cell: ({ row }) => {
          const v = row.original.pruAtSale;
          return (
            <div className="text-right font-mono tabular-nums">
              {fmtNum(v, v < 50 ? 3 : 2)} €
            </div>
          );
        },
      },
      {
        id: "salePrice",
        accessorFn: (r) => salePricePerShare(r),
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Prix de vente / action" tooltip={REALIZATION_TOOLTIPS.salePrice} align="right" />
        ),
        cell: ({ getValue }) => {
          const v = getValue<number>();
          return (
            <div className="text-right font-mono tabular-nums">
              {fmtNum(v, v < 50 ? 3 : 2)} €
            </div>
          );
        },
      },
      {
        id: "currentPrice",
        accessorFn: (r) => priceByIsin[r.isin]?.eur ?? Number.NaN,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Cours actuel" tooltip={REALIZATION_TOOLTIPS.currentPrice} align="right" />
        ),
        cell: ({ getValue }) => {
          const v = getValue<number>();
          if (!Number.isFinite(v)) {
            return <div className="text-muted-foreground text-right font-mono text-xs">—</div>;
          }
          return (
            <div className="text-right font-mono tabular-nums">
              {fmtNum(v, v < 50 ? 3 : 2)} €
            </div>
          );
        },
        sortingFn: (a, b, columnId) => {
          const av = a.getValue<number>(columnId);
          const bv = b.getValue<number>(columnId);
          const af = Number.isFinite(av);
          const bf = Number.isFinite(bv);
          if (!af && !bf) return 0;
          if (!af) return 1;
          if (!bf) return -1;
          return av - bv;
        },
      },
      {
        id: "spread",
        accessorFn: (r) => {
          const cp = priceByIsin[r.isin]?.eur;
          if (cp == null || !Number.isFinite(cp)) return Number.NaN;
          const sp = salePricePerShare(r);
          if (sp <= 0) return Number.NaN;
          return (cp - sp) / sp;
        },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Spread après vente" tooltip={REALIZATION_TOOLTIPS.spread} align="right" />
        ),
        cell: ({ getValue }) => {
          const v = getValue<number>();
          if (!Number.isFinite(v)) {
            return <div className="text-muted-foreground text-right font-mono text-xs">—</div>;
          }
          return (
            <div className="text-right font-mono tabular-nums">
              {fmtPct(v, 1)}
            </div>
          );
        },
        sortingFn: (a, b, columnId) => {
          const av = a.getValue<number>(columnId);
          const bv = b.getValue<number>(columnId);
          const af = Number.isFinite(av);
          const bf = Number.isFinite(bv);
          if (!af && !bf) return 0;
          if (!af) return 1;
          if (!bf) return -1;
          return av - bv;
        },
      },
      {
        id: "saleNet",
        accessorFn: (r) => (inflationAdjusted ? r.saleNetReal : r.saleNet),
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={`Encaissé net${realSuffix}`} tooltip={REALIZATION_TOOLTIPS.saleNet} align="right" />
        ),
        cell: ({ row }) => {
          const v = inflationAdjusted ? row.original.saleNetReal : row.original.saleNet;
          return (
            <div className="text-right font-mono tabular-nums">{fmtCcy(v, 2)}</div>
          );
        },
      },
      {
        id: "dividends",
        accessorFn: (r) =>
          inflationAdjusted ? r.dividendsAttributedReal : r.dividendsAttributed,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={`Dividendes attribués${realSuffix}`} tooltip={REALIZATION_TOOLTIPS.dividends} align="right" />
        ),
        cell: ({ row }) => {
          const v = inflationAdjusted
            ? row.original.dividendsAttributedReal
            : row.original.dividendsAttributed;
          return (
            <div className="text-right font-mono tabular-nums">
              {v > 0.005 ? fmtCcy(v, 2) : "—"}
            </div>
          );
        },
      },
      {
        id: "holdingFees",
        accessorFn: (r) =>
          inflationAdjusted ? r.holdingFeesAttributedReal : r.holdingFeesAttributed,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={`Frais de détention attribués${realSuffix}`} tooltip={REALIZATION_TOOLTIPS.holdingFees}
            align="right"
          />
        ),
        cell: ({ row }) => {
          const v = inflationAdjusted
            ? row.original.holdingFeesAttributedReal
            : row.original.holdingFeesAttributed;
          return v > 0.005 ? (
            <div className="text-right">
              <MoneyCell value={v} dp={2} />
            </div>
          ) : (
            <div className="text-muted-foreground text-right font-mono tabular-nums">—</div>
          );
        },
      },
      {
        id: "realizedTotal",
        accessorFn: (r) => {
          if (inflationAdjusted) {
            return netOfFees
              ? withDividends
                ? r.pnlTotalNetFeesReal
                : r.pnlCapitalNetFeesReal
              : withDividends
                ? r.pnlTotalReal
                : r.pnlCapitalReal;
          }
          return withDividends ? r.pnlTotal : r.pnlCapital;
        },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={`Réalisé total${realSuffix}`} tooltip={REALIZATION_TOOLTIPS.realizedTotal} align="right" />
        ),
        cell: ({ getValue }) => (
          <div className="text-right">
            <MoneyCell value={getValue<number>()} dp={2} signed />
          </div>
        ),
      },
      {
        id: "xirr",
        accessorFn: (r) => {
          const v = netOfFees
            ? withDividends
              ? inflationAdjusted
                ? r.xirrTotalNetFeesReal
                : r.xirrTotalNetFees
              : inflationAdjusted
                ? r.xirrCapitalNetFeesReal
                : r.xirrCapitalNetFees
            : withDividends
              ? inflationAdjusted
                ? r.xirrTotalReal
                : r.xirrTotal
              : inflationAdjusted
                ? r.xirrCapitalReal
                : r.xirrCapital;
          return Number.isFinite(v) ? v : Number.NaN;
        },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={`XIRR${realSuffix}`} tooltip={REALIZATION_TOOLTIPS.xirr} align="right" />
        ),
        cell: ({ getValue }) => {
          const v = getValue<number>();
          return Number.isFinite(v) ? (
            <div className="text-right">
              <DeltaPill value={v} />
            </div>
          ) : (
            <div className="text-muted-foreground text-right font-mono text-xs">—</div>
          );
        },
        sortingFn: (a, b, columnId) => {
          const av = a.getValue<number>(columnId);
          const bv = b.getValue<number>(columnId);
          const af = Number.isFinite(av);
          const bf = Number.isFinite(bv);
          if (!af && !bf) return 0;
          if (!af) return 1;
          if (!bf) return -1;
          return av - bv;
        },
      },
    ],
    [withDividends, netOfFees, inflationAdjusted, realSuffix, priceByIsin],
  );

  if (realizations.length === 0) {
    return <EmptyState />;
  }

  const currentPayload = viewState.buildPayload({
    columns: visible as Record<string, boolean>,
    toggles: { withDividends, netOfFees, inflationAdjusted },
  });

  return (
    <DataTable
      columns={columns}
      data={filteredBySearch}
      storageKey="gainvest:datatable:realizations:state"
      columnVisibility={visible}
      initialState={{ sorting: [{ id: "saleDate", desc: true }] }}
      sorting={viewState.sorting}
      onSortingChange={viewState.setSorting}
      columnFilters={viewState.columnFilters}
      onColumnFiltersChange={viewState.setColumnFilters}
      onVisibleRowsChange={onVisibleRowsChange}
      toolbar={(table) => (
        <DataTableToolbar
          table={table}
          search={{
            placeholder: "Rechercher ISIN, nom, opérateur…",
            value: search,
            onChange: setSearch,
          }}
          facetedFilters={[
            {
              columnId: "support",
              title: "Support",
              options: SUPPORTS.map((s) => ({ label: s, value: s })),
            },
            {
              columnId: "type",
              title: "Type",
              options: [...ASSET_CLASS_FACETED_OPTIONS],
            },
            { columnId: "operateur", title: "Opérateur", options: operatorOptions },
          ]}
          dateRangeFilters={[{ columnId: "saleDate", title: "Date de vente" }]}
          trailing={
            <>
              <ViewsSwitcher
                scope="realizations"
                currentPayload={currentPayload}
                activeViewId={viewState.activeViewId}
                onApply={(id, payload) =>
                  viewState.applyPayload(payload, {
                    id: id || null,
                    setVisibleColumns: setVisible,
                    toggleSetters:
                      setWithDividends && setNetOfFees && setInflationAdjusted
                        ? { setWithDividends, setNetOfFees, setInflationAdjusted }
                        : undefined,
                  })
                }
              />
              <ColumnsPicker
                columns={REALIZATION_COLUMNS}
                visible={visible}
                visibleCount={visibleCount}
                onToggle={toggle}
                onReset={reset}
                onShowAll={showAll}
              />
            </>
          }
        />
      )}
    />
  );
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
