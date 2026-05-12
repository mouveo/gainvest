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
}: DataTableProps<TData, TValue>) {
  // SSR-safe: initialize with the props/defaults so the first server-rendered
  // HTML matches the first client render. Persisted state from localStorage
  // is only applied AFTER hydration via an effect — this avoids the
  // "Hydration failed: server vs client mismatch" on attributes like
  // aria-sort that depend on the initial sorting state.
  const [sorting, setSorting] = React.useState<SortingState>(initialState?.sorting ?? []);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    initialState?.columnFilters ?? [],
  );
  const [pagination, setPagination] = React.useState<PaginationState>(
    initialState?.pagination ?? { pageIndex: 0, pageSize: DEFAULT_PAGE_SIZE },
  );
  const [expanded, setExpanded] = React.useState<ExpandedState>({});
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    const persisted = readPersistedState(storageKey) ?? {};
    if (persisted.sorting) setSorting(persisted.sorting);
    if (persisted.columnFilters) setColumnFilters(persisted.columnFilters);
    if (persisted.pagination) setPagination(persisted.pagination);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  React.useEffect(() => {
    if (!hydrated) return;
    writePersistedState(storageKey, { sorting, columnFilters, pagination });
  }, [hydrated, storageKey, sorting, columnFilters, pagination]);

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
