"use client";

import * as React from "react";
import type { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DataTableColumnHeaderProps<TData, TValue> = React.HTMLAttributes<HTMLDivElement> & {
  column: Column<TData, TValue>;
  title: React.ReactNode;
};

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <div className={cn("text-foreground font-medium", className)}>{title}</div>;
  }

  const sorted = column.getIsSorted();

  const handleClick = () => {
    if (sorted === false) {
      column.toggleSorting(false);
    } else if (sorted === "asc") {
      column.toggleSorting(true);
    } else {
      column.clearSorting();
    }
  };

  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={handleClick}
      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
      className={cn(
        "data-[icon=inline-end]:pr-1.5 -ml-1.5 flex items-center gap-1 px-1.5 font-medium",
        className,
      )}
    >
      {title}
      {sorted === "asc" ? (
        <ArrowUp data-icon="inline-end" className="text-foreground size-3.5" />
      ) : sorted === "desc" ? (
        <ArrowDown data-icon="inline-end" className="text-foreground size-3.5" />
      ) : (
        <ArrowUpDown data-icon="inline-end" className="text-muted-foreground size-3.5" />
      )}
    </Button>
  );
}
