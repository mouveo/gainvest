"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useUserPreference } from "@/features/preferences/use-preference";

const STORAGE_KEY = "gainvest:pnl-net-of-fees";

export function useNetOfFeesMode(): [boolean, (value: boolean) => void] {
  return useUserPreference<boolean>("global", "netOfFees", false, {
    localStorageKey: STORAGE_KEY,
  });
}

export function HoldingFeesToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = "pnl-net-of-fees";
  return (
    <Label htmlFor={id} className="text-muted-foreground flex items-center gap-2 text-xs">
      <Switch id={id} checked={value} onCheckedChange={onChange} />
      <span>Net des frais</span>
    </Label>
  );
}
