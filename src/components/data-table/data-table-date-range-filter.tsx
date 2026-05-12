"use client";

import * as React from "react";
import type { Column } from "@tanstack/react-table";
import type { DateRange } from "react-day-picker";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import type { DateRangeFilterValue } from "./filter-fns";

type DataTableDateRangeFilterProps<TData, TValue> = {
  column?: Column<TData, TValue>;
  title: string;
};

function toIsoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromIsoDay(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function shiftDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toIsoDay(d);
}

function shiftYears(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return toIsoDay(d);
}

function formatDisplay(iso: string): string {
  const d = fromIsoDay(iso);
  if (!d) return iso;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

export function DataTableDateRangeFilter<TData, TValue>({
  column,
  title,
}: DataTableDateRangeFilterProps<TData, TValue>) {
  const raw = column?.getFilterValue() as DateRangeFilterValue | undefined;
  const value: DateRangeFilterValue = raw ?? {};

  const selected: DateRange | undefined = React.useMemo(() => {
    const from = fromIsoDay(value.from);
    const to = fromIsoDay(value.to);
    if (!from && !to) return undefined;
    return { from, to };
  }, [value.from, value.to]);

  const setRange = (next: DateRangeFilterValue | undefined) => {
    if (!next || (!next.from && !next.to)) {
      column?.setFilterValue(undefined);
    } else {
      column?.setFilterValue(next);
    }
  };

  const handleSelect = (range: DateRange | undefined) => {
    if (!range) {
      setRange(undefined);
      return;
    }
    setRange({
      from: range.from ? toIsoDay(range.from) : undefined,
      to: range.to ? toIsoDay(range.to) : undefined,
    });
  };

  const label = (() => {
    if (value.from && value.to) return `${formatDisplay(value.from)} → ${formatDisplay(value.to)}`;
    if (value.from) return `Depuis ${formatDisplay(value.from)}`;
    if (value.to) return `Jusqu'au ${formatDisplay(value.to)}`;
    return title;
  })();

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm">
            <CalendarIcon />
            {label}
          </Button>
        }
      />
      <PopoverContent align="start" className="w-auto p-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setRange({ from: shiftDays(7), to: toIsoDay(new Date()) })}
          >
            7 jours
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setRange({ from: shiftDays(30), to: toIsoDay(new Date()) })}
          >
            30 jours
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setRange({ from: shiftYears(1), to: toIsoDay(new Date()) })}
          >
            1 an
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setRange(undefined)}>
            Tout
          </Button>
        </div>
        <Calendar
          mode="range"
          selected={selected}
          onSelect={handleSelect}
          numberOfMonths={2}
          className="mt-2"
        />
      </PopoverContent>
    </Popover>
  );
}
