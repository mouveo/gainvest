"use client";

import { useCallback, useEffect, useState } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const STORAGE_KEY = "gainvest:pnl-net-of-fees";

export function useNetOfFeesMode(): [boolean, (value: boolean) => void] {
  const [netOfFees, setNetOfFees] = useState<boolean>(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === null) return;
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "boolean") setNetOfFees(parsed);
    } catch {
      // ignore corrupted JSON, quota errors, private mode, etc.
    }
  }, []);

  const update = useCallback((value: boolean) => {
    setNetOfFees(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // ignore quota / private mode errors
    }
  }, []);

  return [netOfFees, update];
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
