"use client";

import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { setBondMetadata } from "../actions";
import type { Position } from "../aggregate";
import { computeBondProjection, type BondProjection } from "../bonds/projection";
import { fmtCcy, fmtDateFR, fmtNum, fmtPct } from "../format";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: Position | null;
};

export function BondDetailsModal({ open, onOpenChange, position }: Props) {
  if (!position) return null;

  const complete =
    position.bondCouponRate != null &&
    position.bondMaturityDate != null &&
    position.bondCouponFrequency != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{position.instrumentName}</DialogTitle>
          <DialogDescription>
            {position.isin} · {position.currency} · nominal {fmtNum(position.qty, 0)}
          </DialogDescription>
        </DialogHeader>
        {complete ? (
          <BondProjectionView position={position} />
        ) : (
          <BondMetadataForm
            position={position}
            onSaved={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BondProjectionView({ position }: { position: Position }) {
  const projection = useMemo<BondProjection | null>(() => {
    if (
      position.bondCouponRate == null ||
      position.bondMaturityDate == null ||
      position.bondCouponFrequency == null ||
      position.pruPctPar == null ||
      position.currentPctPar == null
    ) {
      return null;
    }
    return computeBondProjection({
      today: new Date(),
      maturity: new Date(`${position.bondMaturityDate}T00:00:00Z`),
      couponRatePct: position.bondCouponRate,
      frequency: position.bondCouponFrequency,
      faceValue: position.qty,
      purchasePricePctPar: position.pruPctPar,
      currentPricePctPar: position.currentPctPar,
      fxToEur: position.fxToEur,
    });
  }, [position]);

  if (!projection) {
    return (
      <p className="text-muted-foreground text-sm">
        Cours actuel ou prix d&apos;achat indisponibles — impossible de calculer la projection.
      </p>
    );
  }

  const ytmDelta = projection.ytmCurrent - projection.ytmAtPurchase;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi
          label="Coupons restants"
          value={`${projection.remainingCoupons}`}
          hint={`${fmtNum(projection.totalCouponsNative, 0)} ${position.currency}`}
        />
        <Kpi
          label="Plus-value à maturité"
          value={fmtCcy(projection.capitalGainAtMaturityEur, 0)}
          hint={`${fmtNum(projection.capitalGainAtMaturityNative, 0)} ${position.currency}`}
        />
        <Kpi
          label="Gain total attendu"
          value={fmtCcy(projection.totalReturnEur, 0)}
          hint={`${fmtCcy(projection.totalCouponsEur, 0)} de coupons`}
        />
        <Kpi
          label="YTM"
          value={fmtPct(projection.ytmCurrent, 2)}
          hint={`achat ${fmtPct(projection.ytmAtPurchase, 2)} · Δ ${fmtPct(ytmDelta, 2)}`}
        />
      </div>
      <div className="max-h-[40vh] overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Montant ({position.currency})</TableHead>
              <TableHead className="text-right">Montant (EUR)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projection.cashflows.map((cf) => (
              <TableRow key={cf.date}>
                <TableCell className="font-mono tabular-nums">{fmtDateFR(cf.date)}</TableCell>
                <TableCell>{cf.kind === "maturity" ? "Maturité" : "Coupon"}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {fmtNum(cf.amount, 2)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {fmtCcy(cf.amount * position.fxToEur, 2)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-muted/40 flex flex-col gap-1 rounded-md p-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-heading font-medium">{value}</span>
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
    </div>
  );
}

function BondMetadataForm({
  position,
  onSaved,
}: {
  position: Position;
  onSaved: () => void;
}) {
  const [couponRate, setCouponRate] = useState(
    position.bondCouponRate != null ? String(position.bondCouponRate) : "",
  );
  const [maturityDate, setMaturityDate] = useState(position.bondMaturityDate ?? "");
  const [frequency, setFrequency] = useState<"1" | "2" | "4">(
    position.bondCouponFrequency != null
      ? (String(position.bondCouponFrequency) as "1" | "2" | "4")
      : "2",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!position.instrumentId) {
      setError("Instrument inconnu — impossible de sauvegarder.");
      return;
    }
    const parsedCoupon = parseFloat(couponRate.replace(",", "."));
    startTransition(async () => {
      const res = await setBondMetadata({
        instrumentId: position.instrumentId!,
        couponRate: parsedCoupon,
        maturityDate,
        frequency: Number(frequency) as 1 | 2 | 4,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="text-muted-foreground text-sm">
        Métadonnées manquantes pour cette obligation. Renseigne-les pour calculer
        la projection.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="bond-coupon-rate">Coupon (%)</Label>
          <Input
            id="bond-coupon-rate"
            inputMode="decimal"
            value={couponRate}
            onChange={(e) => setCouponRate(e.target.value)}
            placeholder="4,65"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="bond-maturity-date">Maturité</Label>
          <Input
            id="bond-maturity-date"
            type="date"
            value={maturityDate}
            onChange={(e) => setMaturityDate(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="bond-frequency">Fréquence</Label>
          <Select
            value={frequency}
            onValueChange={(v) => setFrequency(v as "1" | "2" | "4")}
          >
            <SelectTrigger id="bond-frequency">
              <SelectValue>
                {(value: string) =>
                  value === "1"
                    ? "Annuel"
                    : value === "2"
                      ? "Semi-annuel"
                      : value === "4"
                        ? "Trimestriel"
                        : value
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Annuel</SelectItem>
              <SelectItem value="2">Semi-annuel</SelectItem>
              <SelectItem value="4">Trimestriel</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {error ? <p className="text-danger text-sm">{error}</p> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}
