"use client";

import * as React from "react";
import type { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type DataTableColumnHeaderProps<TData, TValue> = React.HTMLAttributes<HTMLDivElement> & {
  column: Column<TData, TValue>;
  title: React.ReactNode;
  align?: "left" | "right";
  /**
   * Optional helper text shown in a tooltip when the user hovers an info icon
   * next to the title. Vulgarisation + formule de calcul si pertinente.
   */
  tooltip?: React.ReactNode;
};

function HelpIcon({ tooltip }: { tooltip: React.ReactNode }) {
  if (!tooltip) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Plus d'info"
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground hover:text-foreground inline-flex items-center"
          />
        }
      >
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
  align = "left",
  tooltip,
}: DataTableColumnHeaderProps<TData, TValue>) {
  const isRight = align === "right";

  if (!column.getCanSort()) {
    return (
      <div
        className={cn(
          "text-foreground inline-flex items-center gap-1.5 font-medium",
          isRight && "justify-end",
          className,
        )}
      >
        <span>{title}</span>
        <HelpIcon tooltip={tooltip} />
      </div>
    );
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

  const button = (
    <Button
      variant="ghost"
      size="xs"
      onClick={handleClick}
      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
      className={cn(
        "data-[icon=inline-end]:pr-1.5 flex items-center gap-1 px-1.5 font-medium",
        isRight ? "-mr-1.5" : "-ml-1.5",
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

  return (
    <div className={cn("flex items-center gap-1", isRight && "justify-end")}>
      {button}
      <HelpIcon tooltip={tooltip} />
    </div>
  );
}
