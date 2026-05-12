"use client";

import { ChevronRight } from "lucide-react";
import { useMemo } from "react";
import type { ColumnDef as TanstackColumnDef } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { cn } from "@/lib/utils";

import type { Position } from "../aggregate";
import { fmtCcy, fmtDateFR, fmtInt, fmtNum } from "../format";
import { ASSET_CLASS_FACETED_OPTIONS, labelAssetClass } from "../labels";
import { SUPPORTS } from "../types";
import { ColumnsPicker } from "./columns/columns-picker";
import type { ColumnDef as PickerColumnDef } from "./columns/types";
import { useVisibleColumns } from "./columns/use-visible-columns";
import { DeltaPill } from "./delta-pill";
import { EditablePrice } from "./editable-price";
import { MoneyCell } from "./money-cell";
import { SupportTag } from "./support-tag";

type PositionColKey =
  | "instrument"
  | "support"
  | "type"
  | "qty"
  | "pru"
  | "currentPrice"
  | "invested"
  | "valuation"
  | "dividendsAttributed"
  | "holdingFees"
  | "pnl"
  | "pnlTotal"
  | "pnlPct"
  | "pnlAnnualized"
  | "held";

const POSITION_COLUMNS: readonly PickerColumnDef<PositionColKey>[] = [
  { key: "instrument", label: "Instrument", always: true },
  { key: "support", label: "Support", defaultVisible: true },
  { key: "type", label: "Type", defaultVisible: true },
  { key: "qty", label: "Quantité", num: true, defaultVisible: true },
  { key: "pru", label: "PRU", num: true, defaultVisible: true },
  { key: "currentPrice", label: "Cours actuel", num: true, defaultVisible: true },
  { key: "invested", label: "Investi", num: true, defaultVisible: true },
  { key: "valuation", label: "Valorisation", num: true, defaultVisible: true },
  { key: "dividendsAttributed", label: "Dividendes", num: true, defaultVisible: false },
  { key: "holdingFees", label: "Frais de détention", num: true, defaultVisible: false },
  { key: "pnl", label: "PnL", num: true, defaultVisible: true },
  { key: "pnlTotal", label: "PnL total", num: true, defaultVisible: false },
  { key: "pnlPct", label: "PnL %", num: true, defaultVisible: true },
  { key: "pnlAnnualized", label: "PnL annualisé", num: true, defaultVisible: true },
  { key: "held", label: "Durée de détention", num: true, defaultVisible: true },
];

export function PositionsTable({
  positions,
  withDividends = false,
  netOfFees = false,
}: {
  positions: Position[];
  withDividends?: boolean;
  netOfFees?: boolean;
}) {
  const { toggle, reset, showAll, visible, visibleCount } = useVisibleColumns(
    "gainvest:positions:visible-columns",
    POSITION_COLUMNS,
  );

  const columns = useMemo<TanstackColumnDef<Position>[]>(
    () => [
      {
        id: "instrument",
        accessorFn: (p) => p.instrumentName,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Instrument" />,
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="flex items-center gap-2">
              <ChevronRight
                aria-hidden
                className={cn(
                  "text-muted-foreground size-4 shrink-0 transition-transform",
                  row.getIsExpanded() && "rotate-90",
                )}
              />
              <div className="flex flex-col">
                <span className="font-medium">{p.instrumentName}</span>
                <span className="text-muted-foreground font-mono text-xs">
                  {p.isin} · {p.currency}
                </span>
              </div>
            </div>
          );
        },
      },
      {
        id: "support",
        accessorFn: (p) => p.support,
        header: "Support",
        cell: ({ row }) => <SupportTag support={row.original.support} />,
        enableSorting: false,
        filterFn: "multiSelect",
      },
      {
        id: "type",
        accessorFn: (p) => p.assetClass,
        header: "Type",
        cell: ({ row }) => (
          <Badge variant="outline">{labelAssetClass(row.original.assetClass)}</Badge>
        ),
        enableSorting: false,
        filterFn: "multiSelect",
      },
      {
        id: "qty",
        accessorFn: (p) => p.qty,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Quantité" />,
        cell: ({ row }) => (
          <div className="text-right font-mono tabular-nums">{fmtInt(row.original.qty)}</div>
        ),
      },
      {
        id: "pru",
        accessorFn: (p) => p.pru,
        header: ({ column }) => <DataTableColumnHeader column={column} title="PRU" />,
        cell: ({ row }) => (
          <div className="text-right font-mono tabular-nums">
            {fmtNum(row.original.pru, row.original.pru < 50 ? 3 : 2)} €
          </div>
        ),
      },
      {
        id: "currentPrice",
        accessorFn: (p) => p.currentPrice,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cours actuel" />,
        cell: ({ row }) => (
          <div className="text-right" onClick={(e) => e.stopPropagation()}>
            <EditablePrice isin={row.original.isin} value={row.original.currentPrice} />
          </div>
        ),
      },
      {
        id: "invested",
        accessorFn: (p) => p.invested,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Investi" />,
        cell: ({ row }) => (
          <div className="text-right font-mono tabular-nums">{fmtCcy(row.original.invested, 0)}</div>
        ),
      },
      {
        id: "valuation",
        accessorFn: (p) => p.valuation,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Valorisation" />,
        cell: ({ row }) => (
          <div className="text-right font-mono font-medium tabular-nums">
            {fmtCcy(row.original.valuation, 0)}
          </div>
        ),
      },
      {
        id: "dividendsAttributed",
        accessorFn: (p) => p.dividendsAttributed,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Dividendes" />,
        cell: ({ row }) => {
          const v = row.original.dividendsAttributed;
          return (
            <div className="text-right font-mono tabular-nums">
              {v > 0.005 ? fmtCcy(v, 0) : "—"}
            </div>
          );
        },
      },
      {
        id: "holdingFees",
        accessorFn: (p) => p.holdingFees,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Frais de détention" />
        ),
        cell: ({ row }) => {
          const v = row.original.holdingFees;
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
        id: "pnl",
        accessorFn: (p) => {
          const base = withDividends ? p.pnlTotal : p.pnlCapital;
          return base - (netOfFees ? p.holdingFees : 0);
        },
        header: ({ column }) => <DataTableColumnHeader column={column} title="PnL" />,
        cell: ({ getValue }) => (
          <div className="text-right">
            <MoneyCell value={getValue<number>()} signed />
          </div>
        ),
      },
      {
        id: "pnlTotal",
        accessorFn: (p) => p.pnlTotal - (netOfFees ? p.holdingFees : 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="PnL total" />,
        cell: ({ getValue }) => (
          <div className="text-right">
            <MoneyCell value={getValue<number>()} signed />
          </div>
        ),
      },
      {
        id: "pnlPct",
        accessorFn: (p) => {
          const base = withDividends ? p.pnlTotal : p.pnlCapital;
          const adj = base - (netOfFees ? p.holdingFees : 0);
          return p.invested > 0 ? adj / p.invested : 0;
        },
        header: ({ column }) => <DataTableColumnHeader column={column} title="PnL %" />,
        cell: ({ getValue }) => (
          <div className="text-right">
            <DeltaPill value={getValue<number>()} />
          </div>
        ),
      },
      {
        id: "pnlAnnualized",
        accessorFn: (p) => {
          const v = netOfFees
            ? withDividends
              ? p.xirrTotalNetFees
              : p.xirrCapitalNetFees
            : withDividends
              ? p.xirrTotal
              : p.xirrCapital;
          return Number.isFinite(v) ? v : Number.NaN;
        },
        sortingFn: (a, b, columnId) => {
          const av = a.getValue<number>(columnId);
          const bv = b.getValue<number>(columnId);
          const afinite = Number.isFinite(av);
          const bfinite = Number.isFinite(bv);
          if (!afinite && !bfinite) return 0;
          if (!afinite) return 1;
          if (!bfinite) return -1;
          return av - bv;
        },
        header: ({ column }) => <DataTableColumnHeader column={column} title="PnL annualisé" />,
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
      },
      {
        id: "held",
        accessorFn: (p) => p.yearsHeld,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Durée de détention" />
        ),
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="flex flex-col items-end">
              <span className="font-mono">{p.yearsHeld.toFixed(1)} a</span>
              <span className="text-muted-foreground text-xs">depuis {fmtDateFR(p.meanDate)}</span>
            </div>
          );
        },
      },
    ],
    [withDividends, netOfFees],
  );

  if (positions.length === 0) {
    return <EmptyState />;
  }

  return (
    <DataTable
      columns={columns}
      data={positions}
      storageKey="gainvest:datatable:positions:state"
      columnVisibility={visible}
      initialState={{ sorting: [{ id: "valuation", desc: true }] }}
      toolbar={(table) => (
        <DataTableToolbar
          table={table}
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
          ]}
          trailing={
            <ColumnsPicker
              columns={POSITION_COLUMNS}
              visible={visible}
              visibleCount={visibleCount}
              onToggle={toggle}
              onReset={reset}
              onShowAll={showAll}
            />
          }
        />
      )}
      expandedRowRender={(p) => <OrdersSubrow position={p} />}
    />
  );
}

function OrdersSubrow({ position }: { position: Position }) {
  return (
    <div>
      <div className="text-muted-foreground mb-2 text-xs">
        Ordres contributeurs · {position.ordersCount} ({position.buyCount} achat
        {position.buyCount > 1 ? "s" : ""}
        {position.sellCount > 0
          ? `, ${position.sellCount} vente${position.sellCount > 1 ? "s" : ""}`
          : ""}
        ) · Frais cumulés {fmtCcy(position.totalFees, 2)}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Qté</TableHead>
            <TableHead className="text-right">Cours</TableHead>
            <TableHead className="text-right">Montant</TableHead>
            <TableHead className="text-right">Courtage</TableHead>
            <TableHead>Lieu / Opérateur</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {position.orders.map((o) => (
            <TableRow key={o.id}>
              <TableCell>
                <div className="flex flex-col">
                  <span>{fmtDateFR(o.tradeDate)}</span>
                  {o.tradeTime ? (
                    <span className="text-muted-foreground font-mono text-xs">{o.tradeTime}</span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={
                    o.kind === "buy"
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-danger/30 bg-danger/10 text-danger"
                  }
                >
                  {o.kind === "buy" ? "Achat" : "Vente"}
                </Badge>
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {fmtInt(o.quantity)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {fmtNum(o.price, o.price < 50 ? 3 : 2)} €
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {fmtCcy(o.quantity * o.price, 2)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {fmtCcy(o.fees, 2)}
              </TableCell>
              <TableCell>
                <div className="flex flex-col">
                  <span className="text-sm">{o.broker ?? "—"}</span>
                  <span className="text-muted-foreground text-xs">{o.executionVenue ?? "—"}</span>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border-border bg-muted/30 flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center">
      <h3 className="text-base font-medium">Aucune position</h3>
      <p className="text-muted-foreground max-w-sm text-sm">
        Ajoute ton premier ordre via le bouton <strong>+ Nouvel ordre</strong> en haut à droite — la
        ligne apparaîtra ici dès que l&apos;ordre sera enregistré.
      </p>
    </div>
  );
}
