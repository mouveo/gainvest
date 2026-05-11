import { cn } from "@/lib/utils";

import { fmtPct, fmtSignedCcy } from "../format";

type Props = {
  value: number;
  kind?: "pct" | "ccy";
  dp?: number;
  className?: string;
};

export function DeltaPill({ value, kind = "pct", dp = 1, className }: Props) {
  const tone =
    value > 0.0005
      ? "bg-success/10 text-success border-success/20"
      : value < -0.0005
        ? "bg-danger/10 text-danger border-danger/20"
        : "bg-muted text-muted-foreground border-border";
  const text = kind === "pct" ? fmtPct(value, dp) : fmtSignedCcy(value, dp);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-xs",
        tone,
        className,
      )}
    >
      {text}
    </span>
  );
}
