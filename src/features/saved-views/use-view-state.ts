"use client";

import { useCallback, useMemo, useState } from "react";
import type {
  ColumnFiltersState,
  PaginationState,
  SortingState,
} from "@tanstack/react-table";

import { normalizeViewPayload } from "./helpers";
import type { ViewPayload, ViewScope, ViewToggles } from "./types";

export type VisibleColumnsMap = Record<string, boolean>;

export type ToggleSetters = {
  setWithDividends: (value: boolean) => void;
  setNetOfFees: (value: boolean) => void;
  setInflationAdjusted: (value: boolean) => void;
};

/**
 * Client-side controller for the saved-views feature on a single table:
 *  - holds the table's sorting / filters / search / pagination as controlled
 *    state so a view application can replace them atomically,
 *  - tracks the currently-applied `activeViewId` so the UI can show "update
 *    the active view" affordances,
 *  - assembles a `currentPayload` for "save as new" / "update active",
 *  - exposes `applyPayload` to apply a view payload (also flips the global
 *    toggles via the provided setters).
 *
 * The hook is intentionally agnostic about *how* columns are persisted —
 * column visibility is owned by `useVisibleColumns` (DB-backed); we just
 * read the current `columns` map and call a setter when a view is applied.
 */
export function useViewState(args: {
  scope: ViewScope;
  initialActiveViewId?: string | null;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [search, setSearch] = useState<string>("");
  const [pagination, setPagination] = useState<PaginationState | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(
    args.initialActiveViewId ?? null,
  );

  const buildPayload = useCallback(
    (input: { columns: VisibleColumnsMap; toggles: ViewToggles }): ViewPayload => {
      const payload: ViewPayload = {
        version: 1,
        columns: input.columns,
        filters: filtersStateToRecord(columnFilters),
        search,
        toggles: input.toggles,
        sort: sorting.map((s) => ({ id: s.id, desc: s.desc })),
      };
      if (pagination) payload.pagination = pagination;
      return payload;
    },
    [sorting, columnFilters, search, pagination],
  );

  const applyPayload = useCallback(
    (
      raw: ViewPayload | unknown,
      options: {
        id?: string | null;
        toggleSetters?: ToggleSetters;
        setVisibleColumns?: (next: VisibleColumnsMap) => void;
      } = {},
    ) => {
      applyPayloadEffects(raw, {
        ...options,
        setSorting,
        setColumnFilters,
        setSearch,
        setPagination,
        setActiveViewId,
      });
    },
    [],
  );

  return useMemo(
    () => ({
      sorting,
      setSorting,
      columnFilters,
      setColumnFilters,
      search,
      setSearch,
      pagination,
      setPagination,
      activeViewId,
      setActiveViewId,
      buildPayload,
      applyPayload,
    }),
    [
      sorting,
      columnFilters,
      search,
      pagination,
      activeViewId,
      buildPayload,
      applyPayload,
    ],
  );
}

export function filtersStateToRecord(
  state: ColumnFiltersState,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of state) {
    out[f.id] = f.value;
  }
  return out;
}

export function recordToFiltersState(
  record: Record<string, unknown>,
): ColumnFiltersState {
  return Object.entries(record).map(([id, value]) => ({ id, value }));
}

/**
 * Pure version of the apply-payload routine, extracted so it can be unit
 * tested without a React renderer. The hook composes the normalisation +
 * setter dispatch around the same pipeline.
 */
export function applyPayloadEffects(
  raw: unknown,
  options: {
    setSorting: (next: SortingState) => void;
    setColumnFilters: (next: ColumnFiltersState) => void;
    setSearch: (next: string) => void;
    setPagination: (next: PaginationState | null) => void;
    setActiveViewId: (next: string | null) => void;
    setVisibleColumns?: (next: VisibleColumnsMap) => void;
    toggleSetters?: ToggleSetters;
    id?: string | null;
  },
): ViewPayload {
  const payload = normalizeViewPayload(raw);
  options.setSorting(payload.sort.map((s) => ({ id: s.id, desc: s.desc })));
  options.setColumnFilters(recordToFiltersState(payload.filters));
  options.setSearch(payload.search);
  options.setPagination(payload.pagination ?? null);
  options.setActiveViewId(options.id ?? null);
  if (options.setVisibleColumns) {
    options.setVisibleColumns(payload.columns);
  }
  if (options.toggleSetters) {
    if (typeof payload.toggles.withDividends === "boolean") {
      options.toggleSetters.setWithDividends(payload.toggles.withDividends);
    }
    if (typeof payload.toggles.netOfFees === "boolean") {
      options.toggleSetters.setNetOfFees(payload.toggles.netOfFees);
    }
    if (typeof payload.toggles.inflationAdjusted === "boolean") {
      options.toggleSetters.setInflationAdjusted(payload.toggles.inflationAdjusted);
    }
  }
  return payload;
}
