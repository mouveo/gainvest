"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
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
}: DataTableProps<TData, TValue>) {
  const initialFromStorageRef = React.useRef<ReturnType<typeof readPersistedState>>(null);
  if (initialFromStorageRef.current === null) {
    initialFromStorageRef.current = readPersistedState(storageKey) ?? {};
  }
  const persisted = initialFromStorageRef.current;

  const [sorting, setSorting] = React.useState<SortingState>(
    () => persisted.sorting ?? initialState?.sorting ?? [],
  );
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    () => persisted.columnFilters ?? initialState?.columnFilters ?? [],
  );
  const [pagination, setPagination] = React.useState<PaginationState>(
    () =>
      persisted.pagination ??
      initialState?.pagination ?? { pageIndex: 0, pageSize: DEFAULT_PAGE_SIZE },
  );
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    writePersistedState(storageKey, { sorting, columnFilters, pagination });
  }, [storageKey, sorting, columnFilters, pagination]);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      pagination,
      ...(columnVisibility !== undefined ? { columnVisibility } : null),
    },
    enableSortingRemoval: true,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    onColumnVisibilityChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    filterFns: {
      multiSelect: multiSelectFilterFn,
      dateRange: dateRangeFilterFn,
    },
  });

  const headerGroups = table.getHeaderGroups();
  const rows = table.getRowModel().rows;
  const totalLeafColumns = table.getAllLeafColumns().filter((c) => c.getIsVisible()).length;

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
                const isExpanded = expandedRowRender ? expanded[row.id] === true : false;
                return (
                  <React.Fragment key={row.id}>
                    <TableRow
                      aria-expanded={expandedRowRender ? isExpanded : undefined}
                      onClick={
                        expandedRowRender
                          ? () =>
                              setExpanded((prev) => ({
                                ...prev,
                                [row.id]: !prev[row.id],
                              }))
                          : undefined
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
