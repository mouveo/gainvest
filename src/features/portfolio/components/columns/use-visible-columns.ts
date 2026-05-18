"use client";

import { useCallback, useMemo } from "react";

import { useUserPreference } from "@/features/preferences/use-preference";
import type { PreferenceScope } from "@/features/preferences/actions";

import { computeDefaults, type ColumnDef, type VisibleMap } from "./types";

// Legacy storageKey → DB scope. Keep the key parameter so callers stay on the
// same call signature; the scope is derived from the legacy storage key.
const SCOPE_BY_STORAGE_KEY: Record<string, PreferenceScope> = {
  "gainvest:positions:visible-columns": "positions",
  "gainvest:realizations:visible-columns": "realizations",
  "gainvest:movements:visible-columns": "movements",
};

const PAYLOAD_KEY = "columns";

export function enforceAlways<K extends string>(
  visible: VisibleMap<K>,
  columns: readonly ColumnDef<K>[],
): VisibleMap<K> {
  const next = { ...visible };
  for (const c of columns) {
    if (c.always) next[c.key] = true;
  }
  return next;
}

export function useVisibleColumns<K extends string>(
  storageKey: string,
  columns: readonly ColumnDef<K>[],
) {
  const defaults = useMemo(() => computeDefaults(columns), [columns]);
  const scope = SCOPE_BY_STORAGE_KEY[storageKey] ?? "global";

  const [stored, setStored] = useUserPreference<VisibleMap<K>>(
    scope,
    PAYLOAD_KEY,
    defaults,
    { localStorageKey: storageKey },
  );

  // Always-true columns must remain visible regardless of what the user (or
  // the persisted payload) says. Apply the rule on read and on write so the
  // stored payload never disagrees with the live state.
  const visible = useMemo(
    () => enforceAlways(stored, columns),
    [stored, columns],
  );

  const persist = useCallback(
    (next: VisibleMap<K>) => {
      setStored(enforceAlways(next, columns));
    },
    [setStored, columns],
  );

  const toggle = useCallback(
    (key: K) => {
      const col = columns.find((c) => c.key === key);
      if (col?.always) return;
      persist({ ...visible, [key]: !visible[key] });
    },
    [columns, visible, persist],
  );

  const reset = useCallback(() => {
    persist(computeDefaults(columns));
  }, [columns, persist]);

  const showAll = useCallback(() => {
    const next = {} as VisibleMap<K>;
    for (const c of columns) {
      next[c.key] = true;
    }
    persist(next);
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
