"use client";

import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { ALL_ACCOUNTS, type ActiveAccount } from "@/features/accounts/constants";
import type { Account } from "@/features/accounts/queries";

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

import { addOrder, setCashBalance } from "../actions";
import { fmtCcy } from "../format";
import { SUPPORTS, type Support } from "../types";

import { OrderListingSelect, type SelectedListing } from "./order-listing-select";

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

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "JPY"] as const;

type Mode =
  | "buy"
  | "sell"
  | "deposit"
  | "withdrawal"
  | "interest"
  | "fee"
  | "calibrate";

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "buy", label: "Achat" },
  { value: "sell", label: "Vente" },
  { value: "deposit", label: "Dépôt" },
  { value: "withdrawal", label: "Retrait" },
  { value: "interest", label: "Intérêt" },
  { value: "fee", label: "Frais" },
  { value: "calibrate", label: "Définir le solde cash" },
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
  accounts: Account[];
  activeAccount: ActiveAccount;
};

export function AddOrderSheet({ knownIsins = [], accounts, activeAccount }: Props) {
  const needsTargetPick = activeAccount === ALL_ACCOUNTS;
  const [accountTarget, setAccountTarget] = useState<string>(
    needsTargetPick ? "" : (activeAccount as string),
  );
  const accountById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );
  const activeAccountName =
    activeAccount !== ALL_ACCOUNTS
      ? (accountById.get(activeAccount)?.name ?? activeAccount)
      : null;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("buy");
  const isTradable = mode === "buy" || mode === "sell";
  const isCalibrate = mode === "calibrate";

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
  const [notes, setNotes] = useState("");
  const [listing, setListing] = useState<SelectedListing>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
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
  const grossN = parseDec(gross);
  const derivedGross = qN * pN;
  const total = mode === "buy" ? derivedGross + fN : derivedGross - fN;

  useEffect(() => {
    if (!isTradable) return;
    if (!grossTouched && qN > 0 && pN > 0) {
      setGross(derivedGross.toFixed(2).replace(".", ","));
    }
  }, [qN, pN, grossTouched, derivedGross, isTradable]);

  // Auto-fill name from known ISIN
  useEffect(() => {
    if (!isTradable) return;
    const hit = knownIsins.find((k) => k.isin === isin);
    if (hit && !name) setName(hit.name);
  }, [isin, knownIsins, name, isTradable]);

  // Drop the chosen listing if the ISIN goes invalid or the mode flips to cash.
  useEffect(() => {
    if (!isTradable) {
      if (listing) setListing(null);
      return;
    }
    if (!ISIN_RE.test(isin.trim().toUpperCase()) && listing) {
      setListing(null);
    }
  }, [isin, isTradable, listing]);

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
    setMode("buy");
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
    setNotes("");
    setListing(null);
    setError(null);
    setInfo(null);
    setLookupError(null);
    setLookupPending(false);
    setAccountTarget(needsTargetPick ? "" : (activeAccount as string));
  };

  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    if (needsTargetPick && !accountTarget) {
      setError("Sélectionne un compte cible.");
      return;
    }
    if (isCalibrate) {
      startTransition(async () => {
        const result = await setCashBalance({
          support,
          broker,
          currency,
          amount: grossN,
          atDate: tradeDate,
          accountId: accountTarget || null,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (result.action === "noop") {
          setInfo("Solde déjà aligné — aucune transaction modifiée.");
        } else if (result.action === "updated") {
          setInfo(`Transaction initiale ajustée (gap ${formatGap(result.gap)}).`);
        } else {
          setInfo(`Dépôt initial créé (${formatGap(result.gap)}).`);
        }
        setTimeout(() => setOpen(false), 1200);
      });
      return;
    }
    const formData = new FormData(event.currentTarget);
    formData.set("kind", mode);
    formData.set("currency", currency);
    formData.set("support", support);
    formData.set("broker", broker);
    formData.set("account_id", accountTarget);
    if (!isTradable) formData.set("asset_class", "cash");
    startTransition(async () => {
      const result = await addOrder(formData);
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
          <SheetTitle>{isCalibrate ? "Définir le solde cash" : "Nouveau mouvement"}</SheetTitle>
          <SheetDescription>
            {isCalibrate
              ? "Aligne le solde cash d'un support sur un montant cible."
              : isTradable
                ? "Saisis les détails d'un achat ou d'une vente."
                : "Saisis un mouvement cash (dépôt, retrait, intérêt, frais)."}
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 px-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account_target">Compte cible</Label>
            {needsTargetPick ? (
              <Select
                value={accountTarget}
                onValueChange={(v) => v && setAccountTarget(v)}
              >
                <SelectTrigger id="account_target" aria-invalid={!accountTarget}>
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mode">Type de mouvement</Label>
            <Select value={mode} onValueChange={(v) => v && setMode(v as Mode)}>
              <SelectTrigger id="mode">
                <SelectValue>
                  {(value: string) =>
                    MODE_OPTIONS.find((m) => m.value === value)?.label ?? value
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MODE_OPTIONS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="bg-muted inline-flex w-fit rounded-md p-0.5 text-sm">
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

          {isTradable ? (
            <TradableFields
              isin={isin}
              setIsin={setIsin}
              isinDatalistId={isinDatalistId}
              knownIsins={knownIsins}
              runLookup={runLookup}
              lookupPending={lookupPending}
              lookupError={lookupError}
              name={name}
              setName={setName}
              quantity={quantity}
              setQuantity={(v) => {
                setQuantity(v);
                setGrossTouched(false);
              }}
              price={price}
              setPrice={(v) => {
                setPrice(v);
                setGrossTouched(false);
              }}
              gross={gross}
              setGross={setGross}
              setGrossTouched={setGrossTouched}
              fees={fees}
              setFees={setFees}
              kind={mode === "buy" ? "buy" : "sell"}
              qN={qN}
              pN={pN}
              derivedGross={derivedGross}
              total={total}
              tradeDate={tradeDate}
              setTradeDate={setTradeDate}
              tradeTime={tradeTime}
              setTradeTime={setTradeTime}
              executionVenue={executionVenue}
              setExecutionVenue={setExecutionVenue}
              broker={broker}
              setBroker={setBroker}
              assetClass={assetClass}
              setAssetClass={setAssetClass}
              currency={currency}
              setCurrency={setCurrency}
              listing={listing}
              setListing={setListing}
            />
          ) : (
            <CashFields
              mode={mode}
              gross={gross}
              setGross={setGross}
              tradeDate={tradeDate}
              setTradeDate={setTradeDate}
              broker={broker}
              setBroker={setBroker}
              currency={currency}
              setCurrency={setCurrency}
              notes={notes}
              setNotes={setNotes}
              isCalibrate={isCalibrate}
            />
          )}

          {error ? (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          ) : null}
          {info ? (
            <p role="status" className="text-success text-sm">
              {info}
            </p>
          ) : null}

          <SheetFooter>
            <SheetClose render={<Button type="button" variant="ghost" />}>Annuler</SheetClose>
            <Button
              type="submit"
              disabled={pending || (needsTargetPick && !accountTarget)}
            >
              <Plus className="size-4" />
              {pending ? "Enregistrement…" : isCalibrate ? "Calibrer" : "Enregistrer"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

type TradableProps = {
  isin: string;
  setIsin: (v: string) => void;
  isinDatalistId: string;
  knownIsins: { isin: string; name: string }[];
  runLookup: (v: string) => void;
  lookupPending: boolean;
  lookupError: string | null;
  name: string;
  setName: (v: string) => void;
  quantity: string;
  setQuantity: (v: string) => void;
  price: string;
  setPrice: (v: string) => void;
  gross: string;
  setGross: (v: string) => void;
  setGrossTouched: (v: boolean) => void;
  fees: string;
  setFees: (v: string) => void;
  kind: "buy" | "sell";
  qN: number;
  pN: number;
  derivedGross: number;
  total: number;
  tradeDate: string;
  setTradeDate: (v: string) => void;
  tradeTime: string;
  setTradeTime: (v: string) => void;
  executionVenue: string;
  setExecutionVenue: (v: string) => void;
  broker: string;
  setBroker: (v: string) => void;
  assetClass: string;
  setAssetClass: (v: string) => void;
  currency: string;
  setCurrency: (v: string) => void;
  listing: SelectedListing;
  setListing: (v: SelectedListing) => void;
};

function TradableFields(props: TradableProps) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="isin">ISIN</Label>
        <Input
          id="isin"
          name="isin"
          list={props.isinDatalistId}
          value={props.isin}
          onChange={(e) => props.setIsin(e.target.value.toUpperCase())}
          onBlur={(e) => props.runLookup(e.target.value)}
          placeholder="IE00BF4RFH31"
          className="font-mono"
          required
        />
        <datalist id={props.isinDatalistId}>
          {props.knownIsins.map((k) => (
            <option key={k.isin} value={k.isin}>
              {k.name}
            </option>
          ))}
        </datalist>
        {props.lookupPending ? (
          <p className="text-muted-foreground text-xs">Recherche des métadonnées…</p>
        ) : props.lookupError ? (
          <p className="text-muted-foreground text-xs">{props.lookupError}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Nom de l&apos;instrument</Label>
        <Input
          id="name"
          name="name"
          value={props.name}
          onChange={(e) => props.setName(e.target.value)}
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
            value={props.quantity}
            onChange={(e) => props.setQuantity(e.target.value)}
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
            value={props.price}
            onChange={(e) => props.setPrice(e.target.value)}
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
            value={props.gross}
            onFocus={() => props.setGrossTouched(true)}
            onChange={(e) => props.setGross(e.target.value)}
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
            value={props.fees}
            onChange={(e) => props.setFees(e.target.value)}
            placeholder="66,87"
          />
        </div>
      </div>

      {props.qN > 0 && props.pN > 0 ? (
        <div className="bg-muted text-muted-foreground flex flex-col gap-1 rounded-md p-3 text-sm">
          <div className="flex justify-between">
            <span>Montant brut</span>
            <span className="text-foreground font-mono">{fmtCcy(props.derivedGross, 2)}</span>
          </div>
          <div className="flex justify-between">
            <span>{props.kind === "buy" ? "Coût total" : "Net reçu"}</span>
            <span className="text-foreground font-mono">{fmtCcy(props.total, 2)}</span>
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
            value={props.tradeDate}
            onChange={(e) => props.setTradeDate(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="trade_time">Heure</Label>
          <Input
            id="trade_time"
            name="trade_time"
            value={props.tradeTime}
            onChange={(e) => props.setTradeTime(e.target.value)}
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
          value={props.executionVenue}
          onChange={(e) => props.setExecutionVenue(e.target.value)}
          placeholder="EURONEXT PARIS"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="broker">Opérateur</Label>
          <Select value={props.broker} onValueChange={(v) => v && props.setBroker(v)}>
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
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="asset_class">Classe d&apos;actif</Label>
          <Select value={props.assetClass} onValueChange={(v) => v && props.setAssetClass(v)}>
            <SelectTrigger id="asset_class">
              <SelectValue>
                {(value: string) =>
                  ASSET_CLASSES.find((a) => a.value === value)?.label ?? value
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ASSET_CLASSES.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input type="hidden" name="asset_class" value={props.assetClass} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="preferred_listing">Cotation</Label>
        <OrderListingSelect
          isin={props.isin}
          value={props.listing}
          onChange={props.setListing}
        />
        <p className="text-muted-foreground text-xs">
          Auto = on choisit la meilleure cotation pour toi au prochain refresh.
        </p>
      </div>

      <input type="hidden" name="currency" value={props.currency} />
      <input type="hidden" name="preferred_mic" value={props.listing?.mic ?? ""} />
      <input
        type="hidden"
        name="preferred_currency"
        value={props.listing?.currency ?? ""}
      />
    </>
  );
}

type CashProps = {
  mode: Mode;
  gross: string;
  setGross: (v: string) => void;
  tradeDate: string;
  setTradeDate: (v: string) => void;
  broker: string;
  setBroker: (v: string) => void;
  currency: string;
  setCurrency: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  isCalibrate: boolean;
};

function CashFields(props: CashProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cash-broker">Opérateur</Label>
          <Select value={props.broker} onValueChange={(v) => v && props.setBroker(v)}>
            <SelectTrigger id="cash-broker">
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
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cash-currency">Devise</Label>
          <Select value={props.currency} onValueChange={(v) => v && props.setCurrency(v)}>
            <SelectTrigger id="cash-currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cash-date">Date</Label>
          <Input
            id="cash-date"
            type="date"
            value={props.tradeDate}
            onChange={(e) => props.setTradeDate(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cash-amount">
            {props.isCalibrate ? "Solde cible" : "Montant"}
          </Label>
          <Input
            id="cash-amount"
            name="gross_amount"
            inputMode="decimal"
            value={props.gross}
            onChange={(e) => props.setGross(e.target.value)}
            placeholder="1 000,00"
            required
          />
        </div>
      </div>

      {!props.isCalibrate ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cash-notes">Notes (optionnel)</Label>
          <Input
            id="cash-notes"
            name="notes"
            value={props.notes}
            onChange={(e) => props.setNotes(e.target.value)}
            placeholder={
              props.mode === "interest"
                ? "Coupon Q3"
                : props.mode === "fee"
                  ? "Frais virement"
                  : "Provisionnement compte"
            }
          />
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          Aligne le solde sur la cible. Si une transaction « Solde initial — saisie manuelle »
          existe, elle est ajustée ; sinon une nouvelle est créée à la date du premier flux.
        </p>
      )}

      <input type="hidden" name="trade_date" value={props.tradeDate} />
    </>
  );
}

function parseDec(v: string): number {
  const n = parseFloat(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function formatGap(gap: number): string {
  const sign = gap >= 0 ? "+" : "−";
  return `${sign}${fmtCcy(Math.abs(gap), 2)}`;
}
