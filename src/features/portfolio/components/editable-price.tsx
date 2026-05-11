"use client";

import { useEffect, useState, useTransition } from "react";

import { cn } from "@/lib/utils";

import { updateInstrumentPrice } from "../actions";
import { fmtNum } from "../format";

type Props = {
  isin: string;
  value: number;
  className?: string;
};

export function EditablePrice({ isin, value, className }: Props) {
  const [text, setText] = useState(formatLocal(value));
  const [, startTransition] = useTransition();

  useEffect(() => {
    setText(formatLocal(value));
  }, [value]);

  const commit = () => {
    const n = parseFloat(text.replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(n) && n >= 0 && Math.abs(n - value) > 0.0001) {
      startTransition(() => {
        void updateInstrumentPrice(isin, n);
      });
    } else {
      setText(formatLocal(value));
    }
  };

  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      title="Modifier le cours actuel"
    >
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText(formatLocal(value));
            e.currentTarget.blur();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className="border-border focus:border-ring focus:ring-ring/30 w-24 rounded-md border bg-transparent px-1.5 py-0.5 text-right font-mono text-sm tabular-nums outline-none focus:ring-2"
      />
      <span className="text-muted-foreground text-xs">€</span>
    </span>
  );
}

function formatLocal(n: number): string {
  return fmtNum(n, n < 50 ? 3 : 2);
}
