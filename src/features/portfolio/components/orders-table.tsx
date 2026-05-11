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

type Filter = "all" | "buy" | "sell";

export function OrdersTable({ orders }: { orders: OrderRow[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    return orders
      .filter((o) => filter === "all" || o.kind === filter)
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
  }, [orders, q, filter]);

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
        <span className="text-muted-foreground ml-auto text-sm">
          {filtered.length} ordre{filtered.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="border-border overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Date</TableHead>
              <TableHead>Instrument</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Quantité</TableHead>
              <TableHead className="text-right">Cours</TableHead>
              <TableHead className="text-right">Valeur</TableHead>
              <TableHead className="text-right">Courtage</TableHead>
              <TableHead>Lieu</TableHead>
              <TableHead>Opérateur</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10}>
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
                    {fmtCcy(o.grossAmount, 2)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtCcy(o.fees, 2)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {o.executionVenue ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">{o.broker ?? "—"}</TableCell>
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
