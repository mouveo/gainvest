"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { computeDefaults, type ColumnDef, type VisibleMap } from "./types";

export function useVisibleColumns<K extends string>(
  storageKey: string,
  columns: readonly ColumnDef<K>[],
) {
  const defaults = useMemo(() => computeDefaults(columns), [columns]);
  const [visible, setVisible] = useState<VisibleMap<K>>(() => defaults);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") return;
      const persisted = parsed as Record<string, unknown>;
      const merged = { ...defaults };
      for (const c of columns) {
        if (c.always) {
          merged[c.key] = true;
          continue;
        }
        const v = persisted[c.key];
        if (typeof v === "boolean") {
          merged[c.key] = v;
        }
      }
      setVisible(merged);
    } catch {
      // ignore corrupted JSON, quota errors, private mode, etc.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const persist = useCallback(
    (next: VisibleMap<K>) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // ignore quota / private mode errors
      }
    },
    [storageKey],
  );

  const toggle = useCallback(
    (key: K) => {
      const col = columns.find((c) => c.key === key);
      if (col?.always) return;
      setVisible((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        persist(next);
        return next;
      });
    },
    [columns, persist],
  );

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    setVisible(computeDefaults(columns));
  }, [columns, storageKey]);

  const showAll = useCallback(() => {
    const next = {} as VisibleMap<K>;
    for (const c of columns) {
      next[c.key] = true;
    }
    persist(next);
    setVisible(next);
  }, [columns, persist]);

  const shown = useCallback((key: K) => visible[key] === true, [visible]);

  const visibleCount = useMemo(
    () => columns.reduce((acc, c) => (visible[c.key] ? acc + 1 : acc), 0),
    [columns, visible],
  );

  return {
    visible,
    shown,
    toggle,
    reset,
    showAll,
    visibleCount,
  };
}
