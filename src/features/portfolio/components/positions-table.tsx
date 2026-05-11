"use client";

import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import type { Position } from "../aggregate";
import { fmtCcy, fmtDateFR, fmtInt, fmtNum } from "../format";
import { DeltaPill } from "./delta-pill";
import { EditablePrice } from "./editable-price";
import { MoneyCell } from "./money-cell";
import { SupportTag } from "./support-tag";

type SortKey =
  | "instrumentName"
  | "qty"
  | "pru"
  | "currentPrice"
  | "invested"
  | "valuation"
  | "pnl"
  | "pnlPct"
  | "pnlAnnualized";

const NUMERIC: SortKey[] = [
  "qty",
  "pru",
  "currentPrice",
  "invested",
  "valuation",
  "pnl",
  "pnlPct",
  "pnlAnnualized",
];

export function PositionsTable({ positions }: { positions: Position[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "valuation",
    dir: "desc",
  });
  const [openPositions, setOpenPositions] = useState<Record<string, boolean>>({});

  const sorted = useMemo(() => {
    return positions.slice().sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === "string" && typeof bv === "string") {
        return sort.dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = Number(av);
      const bn = Number(bv);
      return sort.dir === "asc" ? an - bn : bn - an;
    });
  }, [positions, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));

  if (positions.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="border-border overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="w-10" />
            <SortHead k="instrumentName" sort={sort} onSort={toggleSort}>
              Instrument
            </SortHead>
            <TableHead>Support</TableHead>
            <TableHead>Type</TableHead>
            <SortHead k="qty" sort={sort} onSort={toggleSort} num>
              Quantité
            </SortHead>
            <SortHead k="pru" sort={sort} onSort={toggleSort} num>
              PRU
            </SortHead>
            <SortHead k="currentPrice" sort={sort} onSort={toggleSort} num>
              Cours actuel
            </SortHead>
            <SortHead k="invested" sort={sort} onSort={toggleSort} num>
              Investi
            </SortHead>
            <SortHead k="valuation" sort={sort} onSort={toggleSort} num>
              Valorisation
            </SortHead>
            <SortHead k="pnl" sort={sort} onSort={toggleSort} num>
              PnL
            </SortHead>
            <SortHead k="pnlPct" sort={sort} onSort={toggleSort} num>
              PnL %
            </SortHead>
            <SortHead k="pnlAnnualized" sort={sort} onSort={toggleSort} num>
              PnL / an
            </SortHead>
            <TableHead className="text-right">Détention</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((p) => {
            const isOpen = !!openPositions[p.key];
            return (
              <PositionRow
                key={p.key}
                p={p}
                isOpen={isOpen}
                onToggle={() => setOpenPositions((o) => ({ ...o, [p.key]: !o[p.key] }))}
              />
            );
          })}
        </TableBody>
      </Table>
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

function PositionRow({
  p,
  isOpen,
  onToggle,
}: {
  p: Position;
  isOpen: boolean;
  onToggle: () => void;
}) {
  void NUMERIC; // referenced for SortKey union — keeps the runtime constant alive for future filters.
  return (
    <>
      <TableRow
        onClick={onToggle}
        className="hover:bg-muted/30 cursor-pointer"
        data-state={isOpen ? "expanded" : undefined}
      >
        <TableCell>
          <ChevronRight
            className={cn("size-4 transition-transform", isOpen && "rotate-90")}
            aria-hidden
          />
        </TableCell>
        <TableCell>
          <div className="flex flex-col">
            <span className="font-medium">{p.instrumentName}</span>
            <span className="text-muted-foreground font-mono text-xs">
              {p.isin} · {p.currency}
            </span>
          </div>
        </TableCell>
        <TableCell>
          <SupportTag support={p.support} />
        </TableCell>
        <TableCell>
          <Badge variant="outline" className="uppercase">
            {p.assetClass}
          </Badge>
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">{fmtInt(p.qty)}</TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {fmtNum(p.pru, p.pru < 50 ? 3 : 2)} €
        </TableCell>
        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
          <EditablePrice isin={p.isin} value={p.currentPrice} />
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">{fmtCcy(p.invested, 0)}</TableCell>
        <TableCell className="text-right font-mono font-medium tabular-nums">
          {fmtCcy(p.valuation, 0)}
        </TableCell>
        <TableCell className="text-right">
          <MoneyCell value={p.pnl} signed />
        </TableCell>
        <TableCell className="text-right">
          <DeltaPill value={p.pnlPct} />
        </TableCell>
        <TableCell className="text-right">
          <DeltaPill value={p.pnlAnnualized} />
        </TableCell>
        <TableCell className="text-right">
          <div className="flex flex-col items-end">
            <span className="font-mono">{p.yearsHeld.toFixed(1)} a</span>
            <span className="text-muted-foreground text-xs">depuis {fmtDateFR(p.meanDate)}</span>
          </div>
        </TableCell>
      </TableRow>
      {isOpen ? <OrdersSubrow position={p} /> : null}
    </>
  );
}

function OrdersSubrow({ position }: { position: Position }) {
  return (
    <TableRow className="bg-muted/20 hover:bg-muted/20">
      <TableCell colSpan={13} className="px-4 py-3">
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
      </TableCell>
    </TableRow>
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
