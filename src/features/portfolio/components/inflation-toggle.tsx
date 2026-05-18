"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useUserPreference } from "@/features/preferences/use-preference";

const STORAGE_KEY = "gainvest:inflation-adjusted";

export function useInflationMode(): [boolean, (value: boolean) => void] {
  return useUserPreference<boolean>("global", "inflationAdjusted", false, {
    localStorageKey: STORAGE_KEY,
  });
}

export function InflationToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = "inflation-adjusted";
  return (
    <Label htmlFor={id} className="text-muted-foreground flex items-center gap-2 text-xs">
      <Switch id={id} checked={value} onCheckedChange={onChange} />
      <span>Inflation</span>
    </Label>
  );
}
