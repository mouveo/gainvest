import { cn } from "@/lib/utils";

import { fmtCcy, fmtSignedCcy } from "../format";

type Props = {
  value: number;
  dp?: number;
  signed?: boolean;
  className?: string;
};

export function MoneyCell({ value, dp = 0, signed = false, className }: Props) {
  const tone =
    value > 0.5 ? "text-success" : value < -0.5 ? "text-danger" : "text-muted-foreground";
  return (
    <span className={cn("font-mono", tone, className)}>
      {signed ? fmtSignedCcy(value, dp) : fmtCcy(value, dp)}
    </span>
  );
}
