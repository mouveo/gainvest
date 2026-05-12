import type { ColumnFiltersState, PaginationState, SortingState } from "@tanstack/react-table";

export type PersistedTableState = {
  sorting?: SortingState;
  columnFilters?: ColumnFiltersState;
  pagination?: PaginationState;
};

export function readPersistedState(storageKey: string): PersistedTableState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as PersistedTableState;
  } catch {
    return null;
  }
}

export function writePersistedState(storageKey: string, state: PersistedTableState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // ignore quota / private mode errors
  }
}
