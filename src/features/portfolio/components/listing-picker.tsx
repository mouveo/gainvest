"use client";

import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { fetchAvailableListings, setInstrumentListing } from "../actions";
import { fmtNum } from "../format";

import { formatPreferredLabel, listingKey } from "./listing-picker.helpers";

type ListingItem = {
  mic: string;
  currency: string;
  exchangeName: string;
  providerSymbol: string;
  country: string;
  previousClose: number | null;
};

type Props = {
  instrumentId: string;
  isin: string | null;
  currentMic: string | null;
  currentCurrency: string | null;
  onChange?: () => void;
};

export function ListingPicker({
  instrumentId,
  isin,
  currentMic,
  currentCurrency,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [listings, setListings] = useState<ListingItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(
    currentMic ? listingKey(currentMic, currentCurrency ?? "") : null,
  );
  const [submitting, startSubmit] = useTransition();

  const disabled = !isin;
  const label = formatPreferredLabel(currentMic, currentCurrency);

  useEffect(() => {
    if (!open) return;
    if (!isin) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setListings(null);
    fetchAvailableListings(isin)
      .then((rows) => {
        if (cancelled) return;
        setListings(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Impossible de charger les cotations.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isin]);

  const submit = () => {
    if (!selected || !listings) return;
    const [mic, currency] = selected.split("\x01");
    if (!mic || !currency) return;
    startSubmit(async () => {
      const result = await setInstrumentListing(instrumentId, mic, currency);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      onChange?.();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={disabled}
            onClick={(e) => e.stopPropagation()}
            className={cn("font-mono", !currentMic && "text-muted-foreground")}
            aria-label="Choisir la cotation"
          />
        }
      >
        {label}
      </DialogTrigger>
      <DialogContent
        className="max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>Choisir la cotation</DialogTitle>
          <DialogDescription>
            Sélectionne la place et la devise utilisées pour rafraîchir le cours de cet
            instrument. Le symbole provider sera recalculé au prochain refresh.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-muted-foreground py-6 text-center text-sm">Chargement…</p>
        ) : error ? (
          <p className="text-danger py-6 text-center text-sm">{error}</p>
        ) : !listings || listings.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            Aucune cotation disponible pour cet ISIN.
          </p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>MIC</TableHead>
                  <TableHead>Place</TableHead>
                  <TableHead>Devise</TableHead>
                  <TableHead className="text-right">Dernier cours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listings.map((l) => {
                  const key = listingKey(l.mic, l.currency);
                  const isSelected = selected === key;
                  return (
                    <TableRow
                      key={`${l.providerSymbol}-${l.mic}-${l.currency}`}
                      data-selected={isSelected || undefined}
                      onClick={() => setSelected(key)}
                      className="cursor-pointer"
                    >
                      <TableCell>
                        <input
                          type="radio"
                          name="listing"
                          checked={isSelected}
                          onChange={() => setSelected(key)}
                          aria-label={`${l.mic} ${l.currency}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono">{l.mic}</TableCell>
                      <TableCell>{l.exchangeName}</TableCell>
                      <TableCell className="font-mono">{l.currency}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {l.previousClose != null ? fmtNum(l.previousClose, 2) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            onClick={submit}
            disabled={!selected || submitting || loading}
          >
            {submitting ? "Enregistrement…" : "Verrouiller cette cotation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
