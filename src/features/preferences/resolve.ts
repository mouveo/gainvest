/**
 * Pick the effective preference value given the three sources we observe:
 *   - `dbValue`: source of truth, persists across browsers and sessions.
 *   - `localStorageValue`: legacy cache; primes on cold start while the DB
 *     fetch is still in flight.
 *   - `defaultValue`: hardcoded default.
 *
 * Rules:
 *   - DB wins if it's defined (anything not `null`/`undefined`).
 *   - Otherwise, localStorage wins if defined — we flag `migrateToDb` so the
 *     caller knows it should upsert the value into the DB on first sight.
 *   - Otherwise, defaults.
 */
export function resolvePreferenceValue<T>(input: {
  defaultValue: T;
  localStorageValue: T | null | undefined;
  dbValue: T | null | undefined;
}): { value: T; migrateToDb: boolean } {
  if (input.dbValue !== null && input.dbValue !== undefined) {
    return { value: input.dbValue, migrateToDb: false };
  }
  if (input.localStorageValue !== null && input.localStorageValue !== undefined) {
    return { value: input.localStorageValue, migrateToDb: true };
  }
  return { value: input.defaultValue, migrateToDb: false };
}

export function safeReadLocalStorage<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function safeWriteLocalStorage(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / private mode errors
  }
}
