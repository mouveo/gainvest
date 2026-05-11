import { cn } from "@/lib/utils";

import type { Support } from "../types";

const CLASS: Record<Support, string> = {
  CTO: "bg-muted text-muted-foreground border-border",
  PEA: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900",
  "PEA-PME":
    "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900",
  AV: "bg-success/10 text-success border-success/30",
};

export function SupportTag({
  support,
  className,
}: {
  support: Support;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-medium tracking-wide",
        CLASS[support],
        className,
      )}
    >
      {support}
    </span>
  );
}
