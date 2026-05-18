import { describe, expect, it } from "vitest";

import { resolvePreferenceValue } from "./resolve";

describe("resolvePreferenceValue", () => {
  it("falls back to the default when neither source is set", () => {
    const out = resolvePreferenceValue<boolean>({
      defaultValue: true,
      localStorageValue: null,
      dbValue: null,
    });
    expect(out).toEqual({ value: true, migrateToDb: false });
  });

  it("uses localStorage when the DB has nothing and flags migration", () => {
    const out = resolvePreferenceValue<boolean>({
      defaultValue: true,
      localStorageValue: false,
      dbValue: null,
    });
    expect(out).toEqual({ value: false, migrateToDb: true });
  });

  it("DB primes over localStorage", () => {
    const out = resolvePreferenceValue<boolean>({
      defaultValue: true,
      localStorageValue: false,
      dbValue: true,
    });
    expect(out).toEqual({ value: true, migrateToDb: false });
  });

  it("DB primes even when its value matches the default", () => {
    const out = resolvePreferenceValue<boolean>({
      defaultValue: true,
      localStorageValue: false,
      dbValue: true,
    });
    // `migrateToDb` must be false — DB row already exists.
    expect(out.migrateToDb).toBe(false);
  });

  it("handles complex object values", () => {
    const out = resolvePreferenceValue<Record<string, boolean>>({
      defaultValue: { a: true, b: false },
      localStorageValue: { a: false, b: false },
      dbValue: { a: true, b: true, c: false },
    });
    expect(out.value).toEqual({ a: true, b: true, c: false });
    expect(out.migrateToDb).toBe(false);
  });

  it("treats undefined like null", () => {
    const out = resolvePreferenceValue<boolean>({
      defaultValue: true,
      localStorageValue: undefined,
      dbValue: undefined,
    });
    expect(out).toEqual({ value: true, migrateToDb: false });
  });
});
