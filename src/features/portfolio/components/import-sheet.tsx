"use client";

import { AlertTriangle, FileUp, Upload } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";

import { ALL_ACCOUNTS, type ActiveAccount } from "@/features/accounts/constants";
import type { Account } from "@/features/accounts/queries";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

import { deleteTransactionsByBroker } from "../actions";
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
  interest: "Intérêts",
  fee: "Frais",
  tax: "Taxe",
  deposit: "Dépôt",
  withdrawal: "Retrait",
};

const KIND_CLASS: Record<ParsedRow["kind"], string> = {
  buy: "border-success/30 bg-success/10 text-success",
  sell: "border-danger/30 bg-danger/10 text-danger",
  dividend:
    "border-blue-300/40 bg-blue-50 text-blue-700 dark:border-blue-700/40 dark:bg-blue-950/30 dark:text-blue-300",
  interest:
    "border-sky-300/40 bg-sky-50 text-sky-700 dark:border-sky-700/40 dark:bg-sky-950/30 dark:text-sky-300",
  fee: "border-warning/30 bg-warning/10 text-warning",
  tax: "border-amber-300/40 bg-amber-50 text-amber-700 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-300",
  deposit:
    "border-emerald-300/40 bg-emerald-50 text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-950/30 dark:text-emerald-300",
  withdrawal:
    "border-rose-300/40 bg-rose-50 text-rose-700 dark:border-rose-700/40 dark:bg-rose-950/30 dark:text-rose-300",
};

type Props = {
  accounts: Account[];
  activeAccount: ActiveAccount;
};

export function ImportSheet({ accounts, activeAccount }: Props) {
  const needsTargetPick = activeAccount === ALL_ACCOUNTS;
  const [open, setOpen] = useState(false);
  const [brokerId, setBrokerId] = useState<string>("bourse-direct");
  const [support, setSupport] = useState<Support>("CTO");
  const [csvText, setCsvText] = useState<string>("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [filename, setFilename] = useState<string>("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPending, startResetTransition] = useTransition();
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [accountTarget, setAccountTarget] = useState<string>(
    needsTargetPick ? "" : (activeAccount as string),
  );

  // Resync target quand l'utilisateur change de compte actif via le switcher
  // pendant que le drawer est monté (useState ne re-init que sur premier
  // mount — sans ce useEffect, accountTarget reste bloqué sur l'ancien
  // compte et l'import atterrit au mauvais endroit).
  useEffect(() => {
    if (needsTargetPick) {
      setAccountTarget("");
    } else {
      setAccountTarget(activeAccount as string);
    }
  }, [activeAccount, needsTargetPick]);

  const accountById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );
  const activeAccountName =
    activeAccount !== ALL_ACCOUNTS
      ? (accountById.get(activeAccount)?.name ?? activeAccount)
      : null;

  const broker = getBroker(brokerId);
  const brokers = listBrokers();

  const incomplete = useMemo(() => rows.filter((r) => r.needsAttention), [rows]);
  const importable = useMemo(() => rows.filter((r) => !r.needsAttention), [rows]);

  const reparse = (text: string, bId: string, sup: Support) => {
    const b = getBroker(bId);
    if (!b || !text) {
      setRows([]);
      setWarnings([]);
      return;
    }
    try {
      const parsed = b.fileParser(text, { support: sup });
      const nextRows = Array.isArray(parsed) ? parsed : parsed.rows;
      const nextWarnings = Array.isArray(parsed) ? [] : parsed.warnings;
      setRows(nextRows);
      setWarnings(nextWarnings);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de parsing");
      setRows([]);
      setWarnings([]);
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
    if (needsTargetPick && !accountTarget) {
      setError("Sélectionne un compte cible.");
      return;
    }
    startTransition(async () => {
      const res = await importBrokerOrders(brokerId, support, importable, warnings, {
        accountId: accountTarget || null,
      });
      setResult(res);
      if (!res.ok) setError(res.error);
    });
  };

  const reset = () => {
    setCsvText("");
    setRows([]);
    setWarnings([]);
    setFilename("");
    setResult(null);
    setError(null);
    setResetMessage(null);
  };

  const onConfirmReset = () => {
    if (!broker) return;
    if (needsTargetPick && !accountTarget) {
      setResetMessage("Sélectionne un compte cible.");
      return;
    }
    const name = broker.name;
    setResetMessage(null);
    startResetTransition(async () => {
      const res = await deleteTransactionsByBroker(name, accountTarget || undefined);
      if ("deleted" in res) {
        setResetMessage(
          `${res.deleted} transaction${res.deleted > 1 ? "s" : ""} ${name} supprimée${res.deleted > 1 ? "s" : ""}.`,
        );
      } else {
        setResetMessage(`Erreur : ${res.error}`);
      }
      setResetOpen(false);
    });
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
        Importer un fichier
      </SheetTrigger>
      <SheetContent side="right" className="!w-[min(80vw,1400px)] !max-w-none overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Importer un fichier de courtier</SheetTitle>
          <SheetDescription>
            Charge un export (CSV pour Bourse Direct, XML Activity Flex Query pour Interactive
            Brokers), vérifie les lignes, puis importe.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 px-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-account-target">Compte cible</Label>
            {needsTargetPick ? (
              <Select
                value={accountTarget}
                onValueChange={(v) => v && setAccountTarget(v)}
              >
                <SelectTrigger
                  id="import-account-target"
                  aria-invalid={!accountTarget}
                >
                  <SelectValue placeholder="Choisis un compte…">
                    {(v: string) => accountById.get(v)?.name ?? v}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="border-input bg-muted/30 text-muted-foreground rounded-lg border px-2.5 py-2 text-sm">
                {activeAccountName}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="broker">Courtier</Label>
              <Select value={brokerId} onValueChange={(v) => v && onBrokerChange(v)}>
                <SelectTrigger id="broker">
                  <SelectValue>
                    {(value: string) => brokers.find((b) => b.id === value)?.name ?? value}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {brokers.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {broker ? (
                <button
                  type="button"
                  onClick={() => setResetOpen(true)}
                  disabled={needsTargetPick && !accountTarget}
                  className="text-muted-foreground hover:text-destructive self-start text-xs underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Réinitialiser tous les imports {broker.name}
                </button>
              ) : null}
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
            <Label htmlFor="import-file">Fichier</Label>
            <Input
              id="import-file"
              type="file"
              accept=".csv,.xml,text/csv,application/xml,text/xml"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
            {filename ? (
              <p className="text-muted-foreground text-xs">{filename}</p>
            ) : brokerId === "interactive-brokers" ? (
              <p className="text-muted-foreground text-xs">
                Interactive Brokers : Activity Flex Query au format XML (Trades + CashTransactions).
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                Bourse Direct : colonnes Date, Quoi, ISIN, Description, Quantite, Montant.
              </p>
            )}
          </div>

          {resetMessage ? (
            <div className="border-border bg-muted/40 rounded-md border px-3 py-2 text-xs">
              {resetMessage}
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <div className="border-warning/30 bg-warning/10 text-warning flex items-start gap-2 rounded-md border p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div className="flex flex-col gap-0.5">
                {warnings.map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </div>
            </div>
          ) : null}

          {rows.length > 0 ? (
            <>
              <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                <span>
                  {rows.length} ligne{rows.length > 1 ? "s" : ""} parsée
                  {rows.length > 1 ? "s" : ""}
                </span>
                <span>·</span>
                <span>
                  {importable.length} importable{importable.length > 1 ? "s" : ""}
                </span>
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
                        <TableCell className="text-xs whitespace-nowrap">{r.date || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={KIND_CLASS[r.kind]}>
                            {KIND_LABEL[r.kind]}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs whitespace-nowrap">
                          {r.isin ?? "—"}
                        </TableCell>
                        <TableCell className="max-w-[24rem] truncate text-xs" title={r.description}>
                          {r.description || "—"}
                          {r.needsAttention && r.attentionReason ? (
                            <div className="text-warning mt-0.5 text-[10px]">
                              {r.attentionReason}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-mono whitespace-nowrap tabular-nums">
                          {r.needsAttention && (r.kind === "buy" || r.kind === "sell") ? (
                            <Input
                              inputMode="decimal"
                              placeholder="Qté"
                              className="h-7 w-24 text-right text-xs"
                              defaultValue=""
                              onBlur={(e) => updateQuantity(r.rawLine, e.target.value)}
                            />
                          ) : r.quantity != null ? (
                            r.quantity
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono whitespace-nowrap tabular-nums">
                          {fmtCcy(r.totalAmount, 2)}
                        </TableCell>
                        <TableCell
                          className="text-right font-mono text-xs whitespace-nowrap tabular-nums"
                          title={r.computedFees?.rationale ?? ""}
                        >
                          {r.computedFees
                            ? fmtCcy(r.computedFees.total, 2)
                            : r.fees != null && r.fees > 0
                              ? fmtCcy(r.fees, 2)
                              : "—"}
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
            disabled={
              pending ||
              importable.length === 0 ||
              (needsTargetPick && !accountTarget)
            }
            onClick={submit}
          >
            <Upload className="size-4" />
            {pending
              ? "Import en cours…"
              : `Importer ${importable.length} ligne${importable.length > 1 ? "s" : ""}`}
          </Button>
        </SheetFooter>

        <Dialog open={resetOpen} onOpenChange={setResetOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Réinitialiser les imports {broker?.name ?? ""} ?</DialogTitle>
              <DialogDescription>
                Cette action supprime définitivement toutes les transactions liées à ce courtier
                (achats, ventes, coupons, frais, retenues à la source) pour ton compte. Tu pourras
                réimporter ton CSV ensuite.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setResetOpen(false)}
                disabled={resetPending}
              >
                Annuler
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={onConfirmReset}
                disabled={resetPending}
              >
                {resetPending ? "Suppression…" : "Supprimer"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
