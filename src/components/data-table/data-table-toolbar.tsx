"use client";

import * as React from "react";
import type { Table } from "@tanstack/react-table";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  DataTableFacetedFilter,
  type FacetedFilterOption,
} from "./data-table-faceted-filter";
import { DataTableDateRangeFilter } from "./data-table-date-range-filter";

type FacetedFilterConfig = {
  columnId: string;
  title: string;
  options: FacetedFilterOption[];
};

type DateRangeFilterConfig = {
  columnId: string;
  title: string;
};

type SearchConfig = {
  columnId?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
};

type DataTableToolbarProps<TData> = {
  table: Table<TData>;
  search?: SearchConfig;
  facetedFilters?: FacetedFilterConfig[];
  dateRangeFilters?: DateRangeFilterConfig[];
  trailing?: React.ReactNode;
};

export function DataTableToolbar<TData>({
  table,
  search,
  facetedFilters,
  dateRangeFilters,
  trailing,
}: DataTableToolbarProps<TData>) {
  const isFiltered =
    table.getState().columnFilters.length > 0 || (search?.value ?? "").length > 0;

  const handleReset = () => {
    table.resetColumnFilters();
    search?.onChange("");
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {search ? (
          <Input
            value={search.value}
            placeholder={search.placeholder ?? "Rechercher…"}
            onChange={(event) => search.onChange(event.target.value)}
            className="h-7 w-48"
          />
        ) : null}
        {facetedFilters?.map((config) => (
          <DataTableFacetedFilter
            key={config.columnId}
            column={table.getColumn(config.columnId)}
            title={config.title}
            options={config.options}
          />
        ))}
        {dateRangeFilters?.map((config) => (
          <DataTableDateRangeFilter
            key={config.columnId}
            column={table.getColumn(config.columnId)}
            title={config.title}
          />
        ))}
        {isFiltered ? (
          <Button variant="ghost" size="sm" onClick={handleReset}>
            Réinitialiser
            <XIcon data-icon="inline-end" />
          </Button>
        ) : null}
      </div>
      {trailing ? <div className="flex items-center gap-2">{trailing}</div> : null}
    </div>
  );
}
