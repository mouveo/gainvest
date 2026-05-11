"use client";

import { FileUp, Upload } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { cn } from "@/lib/utils";

import { getBroker, listBrokers } from "../brokers/registry";
import type { ParsedRow } from "../brokers/types";
import { fmtCcy } from "../format";
import { importBrokerOrders, type ImportResult } from "../import/actions";
import { SUPPORTS, type Support } from "../types";

function parseFr(v: string): number {
  const n = parseFloat(v.replace(/[\s  ]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

const KIND_LABEL: Record<ParsedRow["kind"], string> = {
  buy: "Achat",
  sell: "Vente",
  dividend: "Coupon",
  fee: "Frais",
};

const KIND_CLASS: Record<ParsedRow["kind"], string> = {
  buy: "border-success/30 bg-success/10 text-success",
  sell: "border-danger/30 bg-danger/10 text-danger",
  dividend:
    "border-blue-300/40 bg-blue-50 text-blue-700 dark:border-blue-700/40 dark:bg-blue-950/30 dark:text-blue-300",
  fee: "border-warning/30 bg-warning/10 text-warning",
};

export function ImportSheet() {
  const [open, setOpen] = useState(false);
  const [brokerId, setBrokerId] = useState<string>("bourse-direct");
  const [support, setSupport] = useState<Support>("CTO");
  const [csvText, setCsvText] = useState<string>("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [filename, setFilename] = useState<string>("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const broker = getBroker(brokerId);
  const brokers = listBrokers();

  const incomplete = useMemo(() => rows.filter((r) => r.needsAttention), [rows]);
  const importable = useMemo(() => rows.filter((r) => !r.needsAttention), [rows]);

  const reparse = (text: string, bId: string, sup: Support) => {
    const b = getBroker(bId);
    if (!b || !text) {
      setRows([]);
      return;
    }
    try {
      setRows(b.csvParser(text, { support: sup }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de parsing");
      setRows([]);
    }
  };

  const onFile = async (file: File) => {
    setResult(null);
    setError(null);
    setFilename(file.name);
    const text = await file.text();
    setCsvText(text);
    reparse(text, brokerId, support);
  };

  const onBrokerChange = (id: string) => {
    setBrokerId(id);
    if (csvText) reparse(csvText, id, support);
  };

  const onSupportChange = (s: Support) => {
    setSupport(s);
    if (csvText) reparse(csvText, brokerId, s);
  };

  const updateQuantity = (rawLine: number, value: string) => {
    const qty = parseFr(value);
    setRows((prev) =>
      prev.map((r) => {
        if (r.rawLine !== rawLine) return r;
        if (Number.isFinite(qty) && qty > 0 && r.grossAmount != null) {
          return {
            ...r,
            quantity: qty,
            price: r.grossAmount / qty,
            needsAttention: false,
            attentionReason: undefined,
          };
        }
        return { ...r, quantity: null, needsAttention: true };
      }),
    );
  };

  const submit = () => {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await importBrokerOrders(brokerId, support, importable);
      setResult(res);
      if (!res.ok) setError(res.error);
    });
  };

  const reset = () => {
    setCsvText("");
    setRows([]);
    setFilename("");
    setResult(null);
    setError(null);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <SheetTrigger render={<Button size="sm" variant="outline" />}>
        <FileUp className="size-4" />
        Importer un CSV
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-3xl md:max-w-3xl"
      >
        <SheetHeader>
          <SheetTitle>Importer un CSV de courtier</SheetTitle>
          <SheetDescription>
            Charge un export CSV, vérifie le calcul automatique des frais, puis importe.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 px-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="broker">Courtier</Label>
              <Select value={brokerId} onValueChange={(v) => v && onBrokerChange(v)}>
                <SelectTrigger id="broker">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {brokers.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="support">Support</Label>
              <Select value={support} onValueChange={(v) => v && onSupportChange(v as Support)}>
                <SelectTrigger id="support">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="csv-file">Fichier CSV</Label>
            <Input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
            {filename ? (
              <p className="text-muted-foreground text-xs">{filename}</p>
            ) : (
              <p className="text-muted-foreground text-xs">
                Bourse Direct : colonnes Date, Quoi, ISIN, Description, Quantite, Montant.
              </p>
            )}
          </div>

          {rows.length > 0 ? (
            <>
              <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                <span>
                  {rows.length} ligne{rows.length > 1 ? "s" : ""} parsée
                  {rows.length > 1 ? "s" : ""}
                </span>
                <span>·</span>
                <span>{importable.length} importable{importable.length > 1 ? "s" : ""}</span>
                {incomplete.length > 0 ? (
                  <>
                    <span>·</span>
                    <span className="text-warning">
                      {incomplete.length} à corriger (non importée
                      {incomplete.length > 1 ? "s" : ""})
                    </span>
                  </>
                ) : null}
              </div>

              <div className="border-border overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>ISIN</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Qté</TableHead>
                      <TableHead className="text-right">Montant</TableHead>
                      <TableHead className="text-right">Frais</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow
                        key={r.rawLine}
                        className={cn(
                          r.needsAttention &&
                            "bg-amber-50 hover:bg-amber-50 dark:bg-amber-950/30 dark:hover:bg-amber-950/30",
                        )}
                      >
                        <TableCell className="whitespace-nowrap text-xs">
                          {r.date || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={KIND_CLASS[r.kind]}>
                            {KIND_LABEL[r.kind]}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.isin ?? "—"}</TableCell>
                        <TableCell className="max-w-[18rem] truncate text-xs" title={r.description}>
                          {r.description || "—"}
                          {r.needsAttention && r.attentionReason ? (
                            <div className="text-warning mt-0.5 text-[10px]">
                              {r.attentionReason}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {r.needsAttention && (r.kind === "buy" || r.kind === "sell") ? (
                            <Input
                              inputMode="decimal"
                              placeholder="Qté"
                              className="h-7 w-20 text-right text-xs"
                              defaultValue=""
                              onBlur={(e) => updateQuantity(r.rawLine, e.target.value)}
                            />
                          ) : r.quantity != null ? (
                            r.quantity
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {fmtCcy(r.totalAmount, 2)}
                        </TableCell>
                        <TableCell
                          className="text-right font-mono tabular-nums text-xs"
                          title={r.computedFees?.rationale ?? ""}
                        >
                          {r.computedFees ? fmtCcy(r.computedFees.total, 2) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {!broker ? (
                <p className="text-danger text-sm" role="alert">
                  Courtier inconnu.
                </p>
              ) : null}
            </>
          ) : csvText ? (
            <p className="text-muted-foreground text-sm">Aucune ligne valide détectée.</p>
          ) : null}

          {result && result.ok ? (
            <div className="border-border bg-muted/40 flex flex-col gap-1 rounded-md border p-3 text-sm">
              <div className="flex justify-between">
                <span>Importées</span>
                <span className="font-mono">{result.inserted}</span>
              </div>
              <div className="flex justify-between">
                <span>Doublons ignorés</span>
                <span className="font-mono">{result.skipped}</span>
              </div>
              <div className="flex justify-between">
                <span>Échecs</span>
                <span className="font-mono">{result.failed.length}</span>
              </div>
              {result.failed.length > 0 ? (
                <ul className="text-muted-foreground mt-2 list-inside list-disc text-xs">
                  {result.failed.map((f) => (
                    <li key={f.row}>
                      Ligne {f.row} — {f.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          ) : null}
        </div>

        <SheetFooter>
          <SheetClose render={<Button type="button" variant="ghost" />}>Fermer</SheetClose>
          <Button
            type="button"
            disabled={pending || importable.length === 0}
            onClick={submit}
          >
            <Upload className="size-4" />
            {pending
              ? "Import en cours…"
              : `Importer ${importable.length} ligne${importable.length > 1 ? "s" : ""}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
