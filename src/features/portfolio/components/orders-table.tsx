"use client";

import { Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { OrderRow } from "../aggregate";
import { deleteOrder } from "../actions";
import { fmtCcy, fmtDateFR, fmtInt, fmtNum } from "../format";
import { SUPPORTS, type Support } from "../types";
import { ColumnsPicker } from "./columns/columns-picker";
import type { ColumnDef } from "./columns/types";
import { useVisibleColumns } from "./columns/use-visible-columns";
import { SupportTag } from "./support-tag";

type Filter = "all" | "buy" | "sell";

type OrderColKey =
  | "date"
  | "instrument"
  | "support"
  | "type"
  | "quantite"
  | "cours"
  | "valeur"
  | "courtage"
  | "lieu"
  | "operateur";

const ORDER_COLUMNS: readonly ColumnDef<OrderColKey>[] = [
  { key: "date", label: "Date", always: true },
  { key: "instrument", label: "Instrument", always: true },
  { key: "support", label: "Support", defaultVisible: true },
  { key: "type", label: "Type", defaultVisible: true },
  { key: "quantite", label: "Quantité", num: true, defaultVisible: true },
  { key: "cours", label: "Cours", num: true, defaultVisible: true },
  { key: "valeur", label: "Valeur", num: true, defaultVisible: true },
  { key: "courtage", label: "Courtage", num: true, defaultVisible: true },
  { key: "lieu", label: "Lieu", defaultVisible: false },
  { key: "operateur", label: "Opérateur", defaultVisible: true },
];

export function OrdersTable({ orders }: { orders: OrderRow[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [supportFilter, setSupportFilter] = useState<"all" | Support>("all");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const { shown, toggle, reset, showAll, visible, visibleCount } = useVisibleColumns(
    "gainvest:orders:visible-columns",
    ORDER_COLUMNS,
  );

  const tableColSpan = visibleCount + 1;

  const filtered = useMemo(() => {
    return orders
      .filter((o) => filter === "all" || o.kind === filter)
      .filter((o) => supportFilter === "all" || o.support === supportFilter)
      .filter((o) => {
        if (!q.trim()) return true;
        const s = q.toLowerCase();
        return `${o.isin} ${o.instrumentName} ${o.broker ?? ""} ${o.executionVenue ?? ""}`
          .toLowerCase()
          .includes(s);
      })
      .slice()
      .sort((a, b) =>
        (b.tradeDate + (b.tradeTime ?? "")).localeCompare(a.tradeDate + (a.tradeTime ?? "")),
      );
  }, [orders, q, filter, supportFilter]);

  const onDelete = (id: string) => {
    setPendingId(id);
    startTransition(async () => {
      await deleteOrder(id);
      setPendingId(null);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Rechercher ISIN, nom, opérateur…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-72"
        />
        {(["all", "buy", "sell"] as Filter[]).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "Tous" : f === "buy" ? "Achats" : "Ventes"}
          </Button>
        ))}

        <span className="bg-border h-4 w-px" />

        <Button
          variant={supportFilter === "all" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setSupportFilter("all")}
        >
          Tous supports
        </Button>

        {SUPPORTS.map((s) => (
          <Button
            key={s}
            variant={supportFilter === s ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setSupportFilter(s)}
          >
            {s}
          </Button>
        ))}

        <span className="text-muted-foreground ml-auto text-sm">
          {filtered.length} ordre{filtered.length > 1 ? "s" : ""}
        </span>

        <ColumnsPicker
          columns={ORDER_COLUMNS}
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
              <TableHead>Date</TableHead>
              <TableHead>Instrument</TableHead>
              {shown("support") ? <TableHead>Support</TableHead> : null}
              {shown("type") ? <TableHead>Type</TableHead> : null}
              {shown("quantite") ? <TableHead className="text-right">Quantité</TableHead> : null}
              {shown("cours") ? <TableHead className="text-right">Cours</TableHead> : null}
              {shown("valeur") ? <TableHead className="text-right">Valeur</TableHead> : null}
              {shown("courtage") ? <TableHead className="text-right">Courtage</TableHead> : null}
              {shown("lieu") ? <TableHead>Lieu</TableHead> : null}
              {shown("operateur") ? <TableHead>Opérateur</TableHead> : null}
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={tableColSpan}>
                  <div className="text-muted-foreground py-12 text-center text-sm">
                    Aucun ordre — ajoute-en un via <strong>+ Nouvel ordre</strong>.
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{fmtDateFR(o.tradeDate)}</span>
                      {o.tradeTime ? (
                        <span className="text-muted-foreground font-mono text-xs">
                          {o.tradeTime}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{o.instrumentName}</span>
                      <span className="text-muted-foreground font-mono text-xs">{o.isin}</span>
                    </div>
                  </TableCell>
                  {shown("support") ? (
                    <TableCell>
                      <SupportTag support={o.support} />
                    </TableCell>
                  ) : null}
                  {shown("type") ? (
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
                  ) : null}
                  {shown("quantite") ? (
                    <TableCell className="text-right font-mono tabular-nums">
                      {fmtInt(o.quantity)}
                    </TableCell>
                  ) : null}
                  {shown("cours") ? (
                    <TableCell className="text-right font-mono tabular-nums">
                      {fmtNum(o.price, o.price < 50 ? 3 : 2)} €
                    </TableCell>
                  ) : null}
                  {shown("valeur") ? (
                    <TableCell className="text-right font-mono tabular-nums">
                      {fmtCcy(o.grossAmount, 2)}
                    </TableCell>
                  ) : null}
                  {shown("courtage") ? (
                    <TableCell className="text-right font-mono tabular-nums">
                      {fmtCcy(o.fees, 2)}
                    </TableCell>
                  ) : null}
                  {shown("lieu") ? (
                    <TableCell className="text-muted-foreground text-sm">
                      {o.executionVenue ?? "—"}
                    </TableCell>
                  ) : null}
                  {shown("operateur") ? (
                    <TableCell className="text-sm">{o.broker ?? "—"}</TableCell>
                  ) : null}
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onDelete(o.id)}
                      disabled={pendingId === o.id}
                      aria-label="Supprimer l'ordre"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
