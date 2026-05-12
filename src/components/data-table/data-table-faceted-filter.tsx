"use client";

import * as React from "react";
import type { Column } from "@tanstack/react-table";
import { CheckIcon, PlusCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type FacetedSimpleOption = {
  label: string;
  value: string;
};

export type FacetedGroupedOption = {
  label: string;
  values: string[];
};

export type FacetedFilterOption = FacetedSimpleOption | FacetedGroupedOption;

type DataTableFacetedFilterProps<TData, TValue> = {
  column?: Column<TData, TValue>;
  title: string;
  options: FacetedFilterOption[];
};

function isGrouped(option: FacetedFilterOption): option is FacetedGroupedOption {
  return Array.isArray((option as FacetedGroupedOption).values);
}

function optionValues(option: FacetedFilterOption): string[] {
  return isGrouped(option) ? option.values : [option.value];
}

function optionKey(option: FacetedFilterOption): string {
  return isGrouped(option) ? `group:${option.label}` : option.value;
}

export function DataTableFacetedFilter<TData, TValue>({
  column,
  title,
  options,
}: DataTableFacetedFilterProps<TData, TValue>) {
  const facets = column?.getFacetedUniqueValues();
  const filterRaw = column?.getFilterValue();
  const selected = React.useMemo<string[]>(
    () => (Array.isArray(filterRaw) ? (filterRaw as string[]) : []),
    [filterRaw],
  );

  const isOptionActive = React.useCallback(
    (option: FacetedFilterOption) => {
      const values = optionValues(option);
      return values.every((v) => selected.includes(v));
    },
    [selected],
  );

  const countFor = React.useCallback(
    (option: FacetedFilterOption) => {
      if (!facets) return 0;
      return optionValues(option).reduce((sum, v) => sum + (facets.get(v) ?? 0), 0);
    },
    [facets],
  );

  const toggleOption = (option: FacetedFilterOption) => {
    const values = optionValues(option);
    const active = isOptionActive(option);
    const next = new Set(selected);
    if (active) {
      for (const v of values) next.delete(v);
    } else {
      for (const v of values) next.add(v);
    }
    const arr = Array.from(next);
    column?.setFilterValue(arr.length === 0 ? undefined : arr);
  };

  const clearAll = () => column?.setFilterValue(undefined);

  const activeCount = selected.length;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm">
            <PlusCircleIcon />
            {title}
            {activeCount > 0 ? (
              <>
                <span className="bg-border mx-1 h-4 w-px" aria-hidden />
                <Badge variant="secondary" className="rounded-md px-1 font-normal lg:hidden">
                  {activeCount}
                </Badge>
                <div className="hidden gap-1 lg:flex">
                  {activeCount > 2 ? (
                    <Badge variant="secondary" className="rounded-md px-1 font-normal">
                      {activeCount} sélectionnés
                    </Badge>
                  ) : (
                    options
                      .filter((option) => isOptionActive(option))
                      .map((option) => (
                        <Badge
                          key={optionKey(option)}
                          variant="secondary"
                          className="rounded-md px-1 font-normal"
                        >
                          {option.label}
                        </Badge>
                      ))
                  )}
                </div>
              </>
            ) : null}
          </Button>
        }
      />
      <PopoverContent align="start" className="w-56 p-0">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>Aucun résultat.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const active = isOptionActive(option);
                const count = countFor(option);
                return (
                  <CommandItem
                    key={optionKey(option)}
                    onSelect={() => toggleOption(option)}
                  >
                    <div
                      className={cn(
                        "border-input flex size-4 items-center justify-center rounded-sm border",
                        active ? "bg-primary text-primary-foreground border-primary" : "opacity-70",
                      )}
                    >
                      <CheckIcon className={cn("size-3", active ? "opacity-100" : "opacity-0")} />
                    </div>
                    <span className="flex-1">{option.label}</span>
                    {count > 0 ? (
                      <span className="text-muted-foreground ml-2 font-mono text-xs tabular-nums">
                        {count}
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {activeCount > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={clearAll} className="justify-center text-center">
                    Tout effacer
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
