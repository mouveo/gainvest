"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type ExpandedState,
  type OnChangeFn,
  type PaginationState,
  type SortingState,
  type Table,
  type VisibilityState,
} from "@tanstack/react-table";

import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { dateRangeFilterFn, multiSelectFilterFn } from "./filter-fns";
import { DataTablePagination } from "./data-table-pagination";
import { readPersistedState, writePersistedState } from "./storage";

export type DataTableInitialState = {
  sorting?: SortingState;
  columnFilters?: ColumnFiltersState;
  pagination?: PaginationState;
};

export type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  storageKey: string;
  emptyState?: React.ReactNode;
  toolbar?: (table: Table<TData>) => React.ReactNode;
  expandedRowRender?: (row: TData) => React.ReactNode;
  initialState?: DataTableInitialState;
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>;
  pageSizeOptions?: number[];
  className?: string;
  onVisibleRowsChange?: (rows: TData[]) => void;
  /**
   * Controlled-state props: when any of these is provided the table treats
   * that slice as controlled (no internal state, no localStorage fallback for
   * that slice). Useful when the table state is driven by a higher-level
   * source like a saved view. Unprovided slices keep the legacy behaviour:
   * internal state + localStorage hydration via `storageKey`.
   */
  sorting?: SortingState;
  onSortingChange?: (next: SortingState) => void;
  columnFilters?: ColumnFiltersState;
  onColumnFiltersChange?: (next: ColumnFiltersState) => void;
  pagination?: PaginationState;
  onPaginationChange?: (next: PaginationState) => void;
};

const DEFAULT_PAGE_SIZE = 100;

export function DataTable<TData, TValue>({
  columns,
  data,
  storageKey,
  emptyState,
  toolbar,
  expandedRowRender,
  initialState,
  columnVisibility,
  onColumnVisibilityChange,
  pageSizeOptions,
  className,
  onVisibleRowsChange,
  sorting: sortingProp,
  onSortingChange,
  columnFilters: columnFiltersProp,
  onColumnFiltersChange,
  pagination: paginationProp,
  onPaginationChange,
}: DataTableProps<TData, TValue>) {
  const sortingControlled = sortingProp !== undefined;
  const filtersControlled = columnFiltersProp !== undefined;
  const paginationControlled = paginationProp !== undefined;

  // SSR-safe: initialize with the props/defaults so the first server-rendered
  // HTML matches the first client render. Persisted state from localStorage
  // is only applied AFTER hydration via an effect — this avoids the
  // "Hydration failed: server vs client mismatch" on attributes like
  // aria-sort that depend on the initial sorting state.
  const [internalSorting, setInternalSorting] = React.useState<SortingState>(
    initialState?.sorting ?? [],
  );
  const [internalColumnFilters, setInternalColumnFilters] = React.useState<ColumnFiltersState>(
    initialState?.columnFilters ?? [],
  );
  const [internalPagination, setInternalPagination] = React.useState<PaginationState>(
    initialState?.pagination ?? { pageIndex: 0, pageSize: DEFAULT_PAGE_SIZE },
  );
  const [expanded, setExpanded] = React.useState<ExpandedState>({});
  const [hydrated, setHydrated] = React.useState(false);

  const sorting = sortingControlled ? sortingProp : internalSorting;
  const columnFilters = filtersControlled ? columnFiltersProp : internalColumnFilters;
  const pagination = paginationControlled ? paginationProp : internalPagination;

  const setSorting: OnChangeFn<SortingState> = (updater) => {
    const next =
      typeof updater === "function" ? updater(sorting) : updater;
    if (sortingControlled) onSortingChange?.(next);
    else setInternalSorting(next);
  };
  const setColumnFilters: OnChangeFn<ColumnFiltersState> = (updater) => {
    const next =
      typeof updater === "function" ? updater(columnFilters) : updater;
    if (filtersControlled) onColumnFiltersChange?.(next);
    else setInternalColumnFilters(next);
  };
  const setPagination: OnChangeFn<PaginationState> = (updater) => {
    const next =
      typeof updater === "function" ? updater(pagination) : updater;
    if (paginationControlled) onPaginationChange?.(next);
    else setInternalPagination(next);
  };

  // localStorage hydration only runs for *uncontrolled* slices — the parent
  // owns persistence when a slice is controlled.
  React.useEffect(() => {
    const persisted = readPersistedState(storageKey) ?? {};
    if (!sortingControlled && persisted.sorting) setInternalSorting(persisted.sorting);
    if (!filtersControlled && persisted.columnFilters) {
      setInternalColumnFilters(persisted.columnFilters);
    }
    if (!paginationControlled && persisted.pagination) {
      setInternalPagination(persisted.pagination);
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  React.useEffect(() => {
    if (!hydrated) return;
    if (sortingControlled && filtersControlled && paginationControlled) return;
    writePersistedState(storageKey, {
      ...(sortingControlled ? {} : { sorting: internalSorting }),
      ...(filtersControlled ? {} : { columnFilters: internalColumnFilters }),
      ...(paginationControlled ? {} : { pagination: internalPagination }),
    });
  }, [
    hydrated,
    storageKey,
    sortingControlled,
    filtersControlled,
    paginationControlled,
    internalSorting,
    internalColumnFilters,
    internalPagination,
  ]);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      pagination,
      expanded,
      ...(columnVisibility !== undefined ? { columnVisibility } : null),
    },
    enableSortingRemoval: true,
    enableExpanding: Boolean(expandedRowRender),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    onExpandedChange: setExpanded,
    onColumnVisibilityChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getExpandedRowModel: getExpandedRowModel(),
    filterFns: {
      multiSelect: multiSelectFilterFn,
      dateRange: dateRangeFilterFn,
    },
  });

  const headerGroups = table.getHeaderGroups();
  const rows = table.getRowModel().rows;
  const filteredRows = table.getFilteredRowModel().rows;
  const totalLeafColumns = table.getAllLeafColumns().filter((c) => c.getIsVisible()).length;

  const lastVisibleSignatureRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!onVisibleRowsChange) return;
    const signature = filteredRows.map((row) => row.id).join("");
    if (signature === lastVisibleSignatureRef.current) return;
    lastVisibleSignatureRef.current = signature;
    onVisibleRowsChange(filteredRows.map((row) => row.original));
  }, [filteredRows, onVisibleRowsChange]);

  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      {toolbar ? toolbar(table) : null}
      <div className="border-border overflow-hidden rounded-lg border">
        <UITable>
          <TableHeader>
            {headerGroups.map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead key={header.id} colSpan={header.colSpan}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={totalLeafColumns} className="h-24 text-center">
                  {emptyState ?? (
                    <span className="text-muted-foreground text-sm">Aucune donnée.</span>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const isExpanded = expandedRowRender ? row.getIsExpanded() : false;
                return (
                  <React.Fragment key={row.id}>
                    <TableRow
                      aria-expanded={expandedRowRender ? isExpanded : undefined}
                      onClick={
                        expandedRowRender ? () => row.toggleExpanded() : undefined
                      }
                      className={expandedRowRender ? "cursor-pointer" : undefined}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                    {expandedRowRender && isExpanded ? (
                      <TableRow data-slot="expanded-row">
                        <TableCell colSpan={totalLeafColumns} className="bg-muted/30 p-3">
                          {expandedRowRender(row.original)}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </React.Fragment>
                );
              })
            )}
          </TableBody>
        </UITable>
      </div>
      <DataTablePagination table={table} pageSizeOptions={pageSizeOptions} />
    </div>
  );
}
