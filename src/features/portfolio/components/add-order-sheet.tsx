"use client";

import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

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

import { cn } from "@/lib/utils";

import { addOrder } from "../actions";
import { fmtCcy } from "../format";
import { SUPPORTS, type Support } from "../types";

const BROKERS = [
  "Bourse Direct",
  "Saxo Banque",
  "Trade Republic",
  "Boursorama",
  "Degiro",
  "Interactive Brokers",
];

const ASSET_CLASSES: { value: string; label: string }[] = [
  { value: "etf", label: "ETF" },
  { value: "equity", label: "Action" },
  { value: "fund", label: "Fonds" },
  { value: "bond", label: "Obligation" },
  { value: "crypto", label: "Crypto" },
];

const today = () => new Date().toISOString().slice(0, 10);

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

type IsinLookupResponse =
  | {
      ok: true;
      data: {
        isin: string;
        name: string;
        assetClass: string;
        currency: string;
        country: string | null;
        ticker: string | null;
        source: "openfigi" | "cache";
      };
    }
  | { ok: false; error: string };

const ASSET_CLASS_VALUES = new Set(["etf", "equity", "fund", "bond", "crypto"]);

type Props = {
  knownIsins?: { isin: string; name: string }[];
};

export function AddOrderSheet({ knownIsins = [] }: Props) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"buy" | "sell">("buy");
  const [isin, setIsin] = useState("");
  const [name, setName] = useState("");
  const [assetClass, setAssetClass] = useState<string>("etf");
  const [currency, setCurrency] = useState<string>("EUR");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [gross, setGross] = useState("");
  const [grossTouched, setGrossTouched] = useState(false);
  const [fees, setFees] = useState("");
  const [tradeDate, setTradeDate] = useState(today());
  const [tradeTime, setTradeTime] = useState("16:30:00");
  const [executionVenue, setExecutionVenue] = useState("");
  const [broker, setBroker] = useState("Bourse Direct");
  const [support, setSupport] = useState<Support>("CTO");
  const [error, setError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupPending, setLookupPending] = useState(false);
  const [pending, startTransition] = useTransition();

  const isinRef = useRef(isin);
  const nameRef = useRef(name);
  useEffect(() => {
    isinRef.current = isin;
  }, [isin]);
  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  const qN = parseDec(quantity);
  const pN = parseDec(price);
  const fN = parseDec(fees);
  const derivedGross = qN * pN;
  const total = kind === "buy" ? derivedGross + fN : derivedGross - fN;

  useEffect(() => {
    if (!grossTouched && qN > 0 && pN > 0) {
      setGross(derivedGross.toFixed(2).replace(".", ","));
    }
  }, [qN, pN, grossTouched, derivedGross]);

  // Auto-fill name from known ISIN
  useEffect(() => {
    const hit = knownIsins.find((k) => k.isin === isin);
    if (hit && !name) setName(hit.name);
  }, [isin, knownIsins, name]);

  const runLookup = useCallback(
    async (raw: string) => {
      const upper = raw.trim().toUpperCase();
      if (!ISIN_RE.test(upper)) return;
      if (knownIsins.some((k) => k.isin === upper)) return;

      setLookupError(null);
      setLookupPending(true);
      try {
        const res = await fetch(`/api/isin/${upper}`);
        const json = (await res.json()) as IsinLookupResponse;

        if (isinRef.current.trim().toUpperCase() !== upper) return;

        if (!json.ok) {
          setLookupError(json.error);
          return;
        }

        if (!nameRef.current) setName(json.data.name);
        if (ASSET_CLASS_VALUES.has(json.data.assetClass)) {
          setAssetClass(json.data.assetClass);
        }
        if (json.data.currency) setCurrency(json.data.currency);
      } catch {
        if (isinRef.current.trim().toUpperCase() === upper) {
          setLookupError("Lookup indisponible.");
        }
      } finally {
        if (isinRef.current.trim().toUpperCase() === upper) {
          setLookupPending(false);
        }
      }
    },
    [knownIsins],
  );

  const reset = () => {
    setKind("buy");
    setIsin("");
    setName("");
    setAssetClass("etf");
    setCurrency("EUR");
    setQuantity("");
    setPrice("");
    setGross("");
    setGrossTouched(false);
    setFees("");
    setTradeDate(today());
    setTradeTime("16:30:00");
    setExecutionVenue("");
    setBroker("Bourse Direct");
    setSupport("CTO");
    setError(null);
    setLookupError(null);
    setLookupPending(false);
  };

  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (form: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await addOrder(form);
      if (result.ok) setOpen(false);
      else setError(result.error);
    });
  };

  const isinDatalistId = useMemo(() => `isin-list-${Math.random().toString(36).slice(2, 8)}`, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        Nouvel ordre
      </SheetTrigger>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Nouvel ordre</SheetTitle>
          <SheetDescription>
            Saisis les détails d&apos;un achat ou d&apos;une vente.
          </SheetDescription>
        </SheetHeader>
        <form action={submit} className="flex flex-1 flex-col gap-4 px-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-muted inline-flex w-fit rounded-md p-0.5 text-sm">
              <button
                type="button"
                onClick={() => setKind("buy")}
                className={`rounded-sm px-3 py-1 ${kind === "buy" ? "bg-success/10 text-success" : "text-muted-foreground"}`}
              >
                Achat
              </button>
              <button
                type="button"
                onClick={() => setKind("sell")}
                className={`rounded-sm px-3 py-1 ${kind === "sell" ? "bg-danger/10 text-danger" : "text-muted-foreground"}`}
              >
                Vente
              </button>
            </div>

            <div className="bg-muted inline-flex rounded-md p-0.5 text-sm">
              {SUPPORTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSupport(s)}
                  className={cn(
                    "rounded-sm px-2.5 py-1 font-medium",
                    support === s
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="support" value={support} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="isin">ISIN</Label>
            <Input
              id="isin"
              name="isin"
              list={isinDatalistId}
              value={isin}
              onChange={(e) => setIsin(e.target.value.toUpperCase())}
              onBlur={(e) => runLookup(e.target.value)}
              placeholder="IE00BF4RFH31"
              className="font-mono"
              required
            />
            <datalist id={isinDatalistId}>
              {knownIsins.map((k) => (
                <option key={k.isin} value={k.isin}>
                  {k.name}
                </option>
              ))}
            </datalist>
            {lookupPending ? (
              <p className="text-muted-foreground text-xs">Recherche des métadonnées…</p>
            ) : lookupError ? (
              <p className="text-muted-foreground text-xs">{lookupError}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Nom de l&apos;instrument</Label>
            <Input
              id="name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="iShares Core MSCI World"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quantity">Quantité</Label>
              <Input
                id="quantity"
                name="quantity"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  setGrossTouched(false);
                }}
                placeholder="7000"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="price">Cours</Label>
              <Input
                id="price"
                name="price"
                inputMode="decimal"
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                  setGrossTouched(false);
                }}
                placeholder="6,369"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gross_amount">Valeur</Label>
              <Input
                id="gross_amount"
                name="gross_amount"
                inputMode="decimal"
                value={gross}
                onFocus={() => setGrossTouched(true)}
                onChange={(e) => setGross(e.target.value)}
                placeholder="44 583,00"
              />
              <p className="text-muted-foreground text-xs">auto = quantité × cours</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fees">Courtage</Label>
              <Input
                id="fees"
                name="fees"
                inputMode="decimal"
                value={fees}
                onChange={(e) => setFees(e.target.value)}
                placeholder="66,87"
              />
            </div>
          </div>

          {qN > 0 && pN > 0 ? (
            <div className="bg-muted text-muted-foreground flex flex-col gap-1 rounded-md p-3 text-sm">
              <div className="flex justify-between">
                <span>Montant brut</span>
                <span className="text-foreground font-mono">{fmtCcy(derivedGross, 2)}</span>
              </div>
              <div className="flex justify-between">
                <span>{kind === "buy" ? "Coût total" : "Net reçu"}</span>
                <span className="text-foreground font-mono">{fmtCcy(total, 2)}</span>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="trade_date">Date</Label>
              <Input
                id="trade_date"
                name="trade_date"
                type="date"
                value={tradeDate}
                onChange={(e) => setTradeDate(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="trade_time">Heure</Label>
              <Input
                id="trade_time"
                name="trade_time"
                value={tradeTime}
                onChange={(e) => setTradeTime(e.target.value)}
                placeholder="16:30:00"
                className="font-mono"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="execution_venue">Lieu d&apos;exécution</Label>
            <Input
              id="execution_venue"
              name="execution_venue"
              value={executionVenue}
              onChange={(e) => setExecutionVenue(e.target.value)}
              placeholder="EURONEXT PARIS"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="broker">Opérateur</Label>
              <Select value={broker} onValueChange={(v) => v && setBroker(v)}>
                <SelectTrigger id="broker">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BROKERS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name="broker" value={broker} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="asset_class">Classe d&apos;actif</Label>
              <Select value={assetClass} onValueChange={(v) => v && setAssetClass(v)}>
                <SelectTrigger id="asset_class">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_CLASSES.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name="asset_class" value={assetClass} />
            </div>
          </div>

          <input type="hidden" name="currency" value={currency} />

          {error ? (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          ) : null}

          <SheetFooter>
            <SheetClose render={<Button type="button" variant="ghost" />}>Annuler</SheetClose>
            <Button type="submit" disabled={pending}>
              <Plus className="size-4" />
              {pending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function parseDec(v: string): number {
  const n = parseFloat(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
