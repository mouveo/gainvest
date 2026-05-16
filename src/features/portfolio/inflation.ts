import cpiFrance from "@/data/cpi-france.json";

import type { Flow } from "./xirr";

type CpiDataset = {
  base_year: number;
  values: Record<string, number>;
};

const dataset = cpiFrance as CpiDataset;

const SORTED_MONTHS: readonly string[] = Object.keys(dataset.values).sort();
const FIRST_MONTH = SORTED_MONTHS[0] ?? "";
const LAST_MONTH = SORTED_MONTHS[SORTED_MONTHS.length - 1] ?? "";

export const CPI_BASE_YEAR: number = dataset.base_year;

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function indexForMonth(month: string): number {
  if (SORTED_MONTHS.length === 0) return 1;
  if (month >= LAST_MONTH) return dataset.values[LAST_MONTH]!;
  if (month <= FIRST_MONTH) return dataset.values[FIRST_MONTH]!;

  const direct = dataset.values[month];
  if (direct !== undefined) return direct;

  // Largest month key <= `month`.
  let lo = 0;
  let hi = SORTED_MONTHS.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (SORTED_MONTHS[mid]! <= month) lo = mid;
    else hi = mid - 1;
  }
  return dataset.values[SORTED_MONTHS[lo]!]!;
}

export function getCpiIndex(date: string): number {
  return indexForMonth(monthKey(date));
}

export function adjustForInflation(
  amount: number,
  fromDate: string,
  toDate: string,
): number {
  const from = getCpiIndex(fromDate);
  if (from === 0) return amount;
  const to = getCpiIndex(toDate);
  return amount * (to / from);
}

export function adjustFlowsForInflation(
  flows: Flow[],
  referenceDate: string,
): Flow[] {
  return flows.map((f) => ({
    date: f.date,
    amount: adjustForInflation(f.amount, f.date, referenceDate),
  }));
}
