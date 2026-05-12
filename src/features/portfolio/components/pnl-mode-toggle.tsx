"use client";

import { useCallback, useEffect, useState } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const STORAGE_KEY = "gainvest:pnl-with-dividends";

export function usePnlMode(): [boolean, (value: boolean) => void] {
  const [withDividends, setWithDividends] = useState<boolean>(true);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === null) return;
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "boolean") setWithDividends(parsed);
    } catch {
      // ignore corrupted JSON, quota errors, private mode, etc.
    }
  }, []);

  const update = useCallback((value: boolean) => {
    setWithDividends(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // ignore quota / private mode errors
    }
  }, []);

  return [withDividends, update];
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
