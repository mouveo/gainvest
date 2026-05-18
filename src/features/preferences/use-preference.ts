"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getUserPreference, setUserPreference } from "./actions";
import type { PreferenceScope } from "./constants";
import {
  resolvePreferenceValue,
  safeReadLocalStorage,
  safeWriteLocalStorage,
} from "./resolve";

const DEFAULT_DEBOUNCE_MS = 500;

type Options = {
  /** Legacy localStorage key to read (cold-start cache + migration source). */
  localStorageKey?: string;
  /** Debounce window before the value is written to the DB. */
  debounceMs?: number;
};

/**
 * Two-tier preference store:
 *   1. Render with the static default → SSR-safe (no window access).
 *   2. On mount, read localStorage for a fast first paint.
 *   3. Fetch the DB row in the background — it primes if it exists, or we
 *      migrate the localStorage value into it on first sight.
 *   4. Writes update React state + localStorage immediately and flush to
 *      the DB on a 500 ms debounce.
 */
export function useUserPreference<T>(
  scope: PreferenceScope,
  key: string,
  defaultValue: T,
  options?: Options,
): [T, (value: T) => void] {
  const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const localStorageKey = options?.localStorageKey;

  const [value, setValue] = useState<T>(defaultValue);
  // Snapshot the "default" by ref so the cleanup paths can compare without
  // re-triggering the read effect when the parent passes a fresh reference.
  const defaultRef = useRef(defaultValue);
  const lastWrittenRef = useRef<T | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cold start: pull from localStorage (sync, blocking is OK), then DB
  // (async). Whichever comes back with a definite value wins, with DB > LS.
  useEffect(() => {
    let cancelled = false;

    const lsValue = localStorageKey
      ? safeReadLocalStorage<T>(localStorageKey)
      : null;
    if (lsValue !== null) {
      setValue(lsValue);
    }

    (async () => {
      try {
        const payload = await getUserPreference(scope);
        if (cancelled) return;
        const dbValue =
          payload && Object.prototype.hasOwnProperty.call(payload, key)
            ? (payload[key] as T)
            : null;
        const resolved = resolvePreferenceValue<T>({
          defaultValue: defaultRef.current,
          localStorageValue: lsValue,
          dbValue,
        });
        setValue(resolved.value);
        if (resolved.migrateToDb) {
          // Best-effort migration. We don't surface errors — the localStorage
          // value remains the source of truth until the next successful write.
          void setUserPreference(scope, { [key]: resolved.value });
          lastWrittenRef.current = resolved.value;
        } else if (dbValue !== null && dbValue !== undefined) {
          lastWrittenRef.current = dbValue;
        }
      } catch {
        // Network / RLS error — keep whatever we already showed (default or
        // localStorage). UI stays responsive.
      }
    })();

    return () => {
      cancelled = true;
    };
    // localStorageKey + scope + key are stable identifiers; defaultValue is
    // intentionally not in the dep array (it changes by reference on every
    // render in most call sites).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, key, localStorageKey]);

  // Flush any pending debounce on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      if (localStorageKey) safeWriteLocalStorage(localStorageKey, next);
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        if (lastWrittenRef.current === next) return;
        lastWrittenRef.current = next;
        void setUserPreference(scope, { [key]: next });
      }, debounceMs);
    },
    [scope, key, localStorageKey, debounceMs],
  );

  return [value, update];
}
