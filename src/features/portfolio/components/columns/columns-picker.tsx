"use client";

import { Columns3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import type { ColumnDef, VisibleMap } from "./types";

type Props<K extends string> = {
  columns: readonly ColumnDef<K>[];
  visible: VisibleMap<K>;
  visibleCount: number;
  onToggle: (k: K) => void;
  onReset: () => void;
  onShowAll: () => void;
};

export function ColumnsPicker<K extends string>({
  columns,
  visible,
  visibleCount,
  onToggle,
  onReset,
  onShowAll,
}: Props<K>) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm">
            <Columns3 />
            Colonnes
            <span className="text-muted-foreground ml-1 font-mono text-xs">
              {visibleCount}/{columns.length}
            </span>
          </Button>
        }
      />
      <PopoverContent align="end" className="w-64">
        <div className="flex flex-col gap-1">
          {columns.map((c) => {
            const checked = visible[c.key] === true;
            const disabled = !!c.always;
            return (
              <label
                key={c.key}
                className={`hover:bg-muted/60 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                  disabled ? "cursor-not-allowed opacity-70" : ""
                }`}
              >
                <input
                  type="checkbox"
                  className="accent-primary size-3.5"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onToggle(c.key)}
                />
                <span className="flex-1">{c.label}</span>
                {disabled ? <span className="text-muted-foreground text-xs">requis</span> : null}
              </label>
            );
          })}
        </div>
        <div className="border-border mt-1 flex items-center justify-between gap-2 border-t pt-2">
          <Button variant="ghost" size="xs" onClick={onShowAll}>
            Tout afficher
          </Button>
          <Button variant="ghost" size="xs" onClick={onReset}>
            Réinitialiser
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
