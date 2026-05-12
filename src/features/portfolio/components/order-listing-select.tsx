"use client";

import { useEffect, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Listing } from "@/lib/quotes";

import { fetchAvailableListings } from "../actions";

import {
  formatOrderListingLabel,
  orderListingKey,
  parseOrderListingKey,
} from "./order-listing-select.helpers";

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const AUTO_KEY = "__auto__";
const DEBOUNCE_MS = 400;

export type SelectedListing = { mic: string; currency: string } | null;

type Props = {
  isin: string;
  value: SelectedListing;
  onChange: (value: SelectedListing) => void;
};

export function OrderListingSelect({ isin, value, onChange }: Props) {
  const cleaned = isin.trim().toUpperCase();
  const isValid = ISIN_RE.test(cleaned);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isValid) {
      setListings(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setError(null);
    const handle = setTimeout(() => {
      setLoading(true);
      fetchAvailableListings(cleaned)
        .then((rows) => {
          if (cancelled) return;
          setListings(rows);
        })
        .catch(() => {
          if (cancelled) return;
          setError("Cotations indisponibles.");
        })
        .finally(() => {
          if (cancelled) return;
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [cleaned, isValid]);

  const currentKey = value ? orderListingKey(value.mic, value.currency) : AUTO_KEY;

  const handleChange = (next: string | null) => {
    if (!next || next === AUTO_KEY) {
      onChange(null);
      return;
    }
    const parsed = parseOrderListingKey(next);
    onChange(parsed);
  };

  return (
    <div className="flex flex-col gap-1">
      <Select value={currentKey} onValueChange={handleChange} disabled={!isValid}>
        <SelectTrigger id="preferred_listing" className="w-full">
          <SelectValue>
            {(val: string) => {
              if (!val || val === AUTO_KEY) return "Auto";
              const parsed = parseOrderListingKey(val);
              const match = parsed
                ? listings?.find(
                    (l) => l.mic === parsed.mic && l.currency === parsed.currency,
                  )
                : null;
              if (match) return formatOrderListingLabel(match);
              if (parsed) return `${parsed.mic} · ${parsed.currency}`;
              return "Auto";
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO_KEY}>Auto</SelectItem>
          {(listings ?? []).map((l) => {
            const key = orderListingKey(l.mic, l.currency);
            return (
              <SelectItem key={`${l.providerSymbol}-${key}`} value={key}>
                {formatOrderListingLabel(l)}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {loading ? (
        <p className="text-muted-foreground text-xs">Chargement des cotations…</p>
      ) : error ? (
        <p className="text-muted-foreground text-xs">{error}</p>
      ) : null}
    </div>
  );
}
