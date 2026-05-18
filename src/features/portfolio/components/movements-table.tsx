"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { ColumnDef as TanstackColumnDef } from "@tanstack/react-table";
import { MOVEMENT_TOOLTIPS } from "./column-tooltips";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { bootstrapView } from "@/features/saved-views/actions";
import { ViewsSwitcher } from "@/features/saved-views/components/views-switcher";
import { useViewState } from "@/features/saved-views/use-view-state";

import type { OrderRow } from "../aggregate";
import { deleteOrder } from "../actions";
import { fmtCcy, fmtDateFR, fmtInt, fmtNum } from "../format";
import { SUPPORTS } from "../types";
import { ColumnsPicker } from "./columns/columns-picker";
import type { ColumnDef as PickerColumnDef } from "./columns/types";
import { useVisibleColumns } from "./columns/use-visible-columns";
import { SupportTag } from "./support-tag";

const KIND_BADGE: Record<OrderRow["kind"], { label: string; cls: string }> = {
  buy: { label: "Achat", cls: "border-success/30 bg-success/10 text-success" },
  sell: { label: "Vente", cls: "border-danger/30 bg-danger/10 text-danger" },
  dividend: {
    label: "Coupon",
    cls: "border-blue-300/40 bg-blue-50 text-blue-700 dark:border-blue-700/40 dark:bg-blue-950/30 dark:text-blue-300",
  },
  interest: {
    label: "Intérêt",
    cls: "border-blue-300/40 bg-blue-50 text-blue-700 dark:border-blue-700/40 dark:bg-blue-950/30 dark:text-blue-300",
  },
  fee: { label: "Frais", cls: "border-warning/30 bg-warning/10 text-warning" },
  tax: { label: "Taxe", cls: "border-warning/30 bg-warning/10 text-warning" },
  deposit: {
    label: "Dépôt",
    cls: "border-success/30 bg-success/10 text-success",
  },
  withdrawal: {
    label: "Retrait",
    cls: "border-danger/30 bg-danger/10 text-danger",
  },
};

const MOVEMENT_KINDS = [
  "buy",
  "sell",
  "dividend",
  "interest",
  "fee",
  "tax",
  "deposit",
  "withdrawal",
] as const;

type MovementColKey =
  | "date"
  | "instrument"
  | "support"
  | "type"
  | "quantite"
  | "prix"
  | "valeur"
  | "frais"
  | "pays"
  | "operateur";

const MOVEMENT_COLUMNS: readonly PickerColumnDef<MovementColKey>[] = [
  { key: "date", label: "Date", always: true },
  { key: "instrument", label: "Instrument", always: true },
  { key: "support", label: "Support", defaultVisible: true },
  { key: "type", label: "Type de mouvement", defaultVisible: true },
  { key: "quantite", label: "Quantité", num: true, defaultVisible: true },
  { key: "prix", label: "Prix", num: true, defaultVisible: true },
  { key: "valeur", label: "Montant brut", num: true, defaultVisible: true },
  { key: "frais", label: "Frais", num: true, defaultVisible: true },
  { key: "pays", label: "Pays", defaultVisible: true },
  { key: "operateur", label: "Opérateur", defaultVisible: true },
];

function countryFromIsin(isin: string | null | undefined): string {
  return isin && isin.length >= 2 ? isin.slice(0, 2).toUpperCase() : "—";
}

function migrateOrdersVisibilityKey(): void {
  if (typeof window === "undefined") return;
  try {
    const OLD = "gainvest:orders:visible-columns";
    const NEW = "gainvest:movements:visible-columns";
    const existing = window.localStorage.getItem(NEW);
    const legacy = window.localStorage.getItem(OLD);
    if (legacy && !existing) {
      window.localStorage.setItem(NEW, legacy);
    }
    if (legacy) {
      window.localStorage.removeItem(OLD);
    }
  } catch {
    // ignore
  }
}

export function MovementsTable({
  orders,
  withDividends = false,
  setWithDividends,
  netOfFees = false,
  setNetOfFees,
  inflationAdjusted = false,
  setInflationAdjusted,
  onVisibleRowsChange,
}: {
  orders: OrderRow[];
  withDividends?: boolean;
  setWithDividends?: (value: boolean) => void;
  netOfFees?: boolean;
  setNetOfFees?: (value: boolean) => void;
  inflationAdjusted?: boolean;
  setInflationAdjusted?: (value: boolean) => void;
  onVisibleRowsChange?: (rows: OrderRow[]) => void;
}) {
  useState(() => {
    migrateOrdersVisibilityKey();
    return null;
  });

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const { toggle, reset, showAll, visible, visibleCount, setVisible } = useVisibleColumns(
    "gainvest:movements:visible-columns",
    MOVEMENT_COLUMNS,
  );

  const viewState = useViewState({ scope: "movements" });
  const { search, setSearch } = viewState;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await bootstrapView("movements");
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

  const onDelete = (id: string) => {
    setPendingId(id);
    startTransition(async () => {
      await deleteOrder(id);
      setPendingId(null);
    });
  };

  const filteredBySearch = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) =>
      `${o.isin} ${o.instrumentName} ${o.broker ?? ""} ${o.executionVenue ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [orders, search]);

  const operatorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) set.add(o.broker ?? "—");
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, "fr"))
      .map((v) => ({ label: v, value: v }));
  }, [orders]);

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) set.add(countryFromIsin(o.isin));
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((v) => ({ label: v, value: v }));
  }, [orders]);

  const columns = useMemo<TanstackColumnDef<OrderRow>[]>(
    () => [
      {
        id: "date",
        accessorFn: (o) => o.tradeDate,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" tooltip={MOVEMENT_TOOLTIPS.date} />,
        cell: ({ row }) => {
          const o = row.original;
          return (
            <div className="flex flex-col">
              <span>{fmtDateFR(o.tradeDate)}</span>
              {o.tradeTime ? (
                <span className="text-muted-foreground font-mono text-xs">{o.tradeTime}</span>
              ) : null}
            </div>
          );
        },
        filterFn: "dateRange",
        sortingFn: (a, b) => {
          const at = `${a.original.tradeDate}${a.original.tradeTime ?? ""}`;
          const bt = `${b.original.tradeDate}${b.original.tradeTime ?? ""}`;
          return at.localeCompare(bt);
        },
      },
      {
        id: "instrument",
        accessorFn: (o) => o.instrumentName,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Instrument" tooltip={MOVEMENT_TOOLTIPS.instrument} />,
        cell: ({ row }) => {
          const o = row.original;
          return (
            <div className="flex flex-col">
              <span className="font-medium">{o.instrumentName}</span>
              <span className="text-muted-foreground font-mono text-xs">{o.isin || "—"}</span>
            </div>
          );
        },
      },
      {
        id: "support",
        accessorFn: (o) => o.support,
        header: "Support",
        cell: ({ row }) => <SupportTag support={row.original.support} />,
        enableSorting: false,
        filterFn: "multiSelect",
      },
      {
        id: "type",
        accessorFn: (o) => o.kind,
        header: "Type de mouvement",
        cell: ({ row }) => (
          <Badge variant="outline" className={KIND_BADGE[row.original.kind].cls}>
            {KIND_BADGE[row.original.kind].label}
          </Badge>
        ),
        enableSorting: false,
        filterFn: "multiSelect",
      },
      {
        id: "quantite",
        accessorFn: (o) => o.quantity ?? Number.NaN,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Quantité" tooltip={MOVEMENT_TOOLTIPS.quantite} align="right" />
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono tabular-nums">
            {row.original.quantity == null ? "—" : fmtInt(row.original.quantity)}
          </div>
        ),
      },
      {
        id: "prix",
        accessorFn: (o) => o.price ?? Number.NaN,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Prix" tooltip={MOVEMENT_TOOLTIPS.prix} align="right" />
        ),
        cell: ({ row }) => {
          const p = row.original.price;
          return (
            <div className="text-right font-mono tabular-nums">
              {p == null ? "—" : `${fmtNum(p, p < 50 ? 3 : 2)} €`}
            </div>
          );
        },
      },
      {
        id: "valeur",
        accessorFn: (o) => o.grossAmount,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Montant brut" tooltip={MOVEMENT_TOOLTIPS.valeur} align="right" />
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono tabular-nums">
            {fmtCcy(row.original.grossAmount, 2)}
          </div>
        ),
      },
      {
        id: "frais",
        accessorFn: (o) => o.fees,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Frais" tooltip={MOVEMENT_TOOLTIPS.frais} align="right" />
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono tabular-nums">{fmtCcy(row.original.fees, 2)}</div>
        ),
      },
      {
        id: "pays",
        accessorFn: (o) => countryFromIsin(o.isin),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Pays" tooltip={MOVEMENT_TOOLTIPS.pays} />,
        cell: ({ getValue }) => (
          <span className="font-mono text-sm tracking-wide">{getValue<string>()}</span>
        ),
        filterFn: "multiSelect",
      },
      {
        id: "operateur",
        accessorFn: (o) => o.broker ?? "—",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Opérateur" tooltip={MOVEMENT_TOOLTIPS.operateur} />,
        cell: ({ row }) => <span className="text-sm">{row.original.broker ?? "—"}</span>,
        enableSorting: false,
        filterFn: "multiSelect",
      },
      {
        id: "actions",
        enableHiding: false,
        enableSorting: false,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="text-right" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onDelete(row.original.id)}
              disabled={pendingId === row.original.id}
              aria-label="Supprimer le mouvement"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ),
      },
    ],
    [pendingId],
  );

  const currentPayload = viewState.buildPayload({
    columns: visible as Record<string, boolean>,
    toggles: { withDividends, netOfFees, inflationAdjusted },
  });

  return (
    <DataTable
      columns={columns}
      data={filteredBySearch}
      storageKey="gainvest:datatable:movements:state"
      columnVisibility={visible}
      initialState={{ sorting: [{ id: "date", desc: true }] }}
      sorting={viewState.sorting}
      onSortingChange={viewState.setSorting}
      columnFilters={viewState.columnFilters}
      onColumnFiltersChange={viewState.setColumnFilters}
      onVisibleRowsChange={onVisibleRowsChange}
      emptyState={
        <div className="text-muted-foreground py-12 text-center text-sm">
          Aucun mouvement — ajoute-en un via <strong>+ Nouvel ordre</strong>.
        </div>
      }
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
              columnId: "type",
              title: "Type de mouvement",
              options: MOVEMENT_KINDS.map((k) => ({
                label: KIND_BADGE[k].label,
                value: k,
              })),
            },
            {
              columnId: "support",
              title: "Support",
              options: SUPPORTS.map((s) => ({ label: s, value: s })),
            },
            { columnId: "pays", title: "Pays", options: countryOptions },
            { columnId: "operateur", title: "Opérateur", options: operatorOptions },
          ]}
          dateRangeFilters={[{ columnId: "date", title: "Date" }]}
          trailing={
            <>
              <ViewsSwitcher
                scope="movements"
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
                columns={MOVEMENT_COLUMNS}
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
