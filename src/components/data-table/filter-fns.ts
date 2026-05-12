import type { FilterFn, Row } from "@tanstack/react-table";

export type MultiSelectFilterValue = string[];

export const multiSelectFilterFn: FilterFn<unknown> = <TData>(
  row: Row<TData>,
  columnId: string,
  filterValue: MultiSelectFilterValue,
) => {
  if (!filterValue || filterValue.length === 0) return true;
  const cellValue = row.getValue(columnId);
  if (cellValue == null) return false;
  return filterValue.includes(String(cellValue));
};

multiSelectFilterFn.autoRemove = (val: unknown) =>
  !Array.isArray(val) || (val as unknown[]).length === 0;

export type DateRangeFilterValue = { from?: string; to?: string };

export const dateRangeFilterFn: FilterFn<unknown> = <TData>(
  row: Row<TData>,
  columnId: string,
  filterValue: DateRangeFilterValue,
) => {
  if (!filterValue || (!filterValue.from && !filterValue.to)) return true;
  const raw = row.getValue(columnId);
  if (raw == null) return false;
  const iso = String(raw).slice(0, 10);
  if (filterValue.from && iso < filterValue.from) return false;
  if (filterValue.to && iso > filterValue.to) return false;
  return true;
};

dateRangeFilterFn.autoRemove = (val: unknown) => {
  if (!val || typeof val !== "object") return true;
  const v = val as DateRangeFilterValue;
  return !v.from && !v.to;
};
