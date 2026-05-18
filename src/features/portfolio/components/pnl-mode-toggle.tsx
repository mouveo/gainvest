"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useUserPreference } from "@/features/preferences/use-preference";

const STORAGE_KEY = "gainvest:pnl-with-dividends";

export function usePnlMode(): [boolean, (value: boolean) => void] {
  return useUserPreference<boolean>("global", "pnlWithDividends", true, {
    localStorageKey: STORAGE_KEY,
  });
}

export function PnlModeToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = "pnl-with-dividends";
  return (
    <Label htmlFor={id} className="text-muted-foreground flex items-center gap-2 text-xs">
      <Switch id={id} checked={value} onCheckedChange={onChange} />
      <span>Inclure les dividendes</span>
    </Label>
  );
}
