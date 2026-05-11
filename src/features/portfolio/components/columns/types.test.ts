import { describe, expect, it } from "vitest";

import { computeDefaults, type ColumnDef } from "./types";

describe("computeDefaults", () => {
  it("returns true for always columns", () => {
    const cols: readonly ColumnDef<"a">[] = [{ key: "a", label: "A", always: true }];
    expect(computeDefaults(cols)).toEqual({ a: true });
  });

  it("returns false when defaultVisible is false", () => {
    const cols: readonly ColumnDef<"a">[] = [{ key: "a", label: "A", defaultVisible: false }];
    expect(computeDefaults(cols)).toEqual({ a: false });
  });

  it("returns true when defaultVisible is omitted", () => {
    const cols: readonly ColumnDef<"a">[] = [{ key: "a", label: "A" }];
    expect(computeDefaults(cols)).toEqual({ a: true });
  });

  it("returns true when defaultVisible is true", () => {
    const cols: readonly ColumnDef<"a">[] = [{ key: "a", label: "A", defaultVisible: true }];
    expect(computeDefaults(cols)).toEqual({ a: true });
  });

  it("always wins over defaultVisible: false", () => {
    const cols: readonly ColumnDef<"a">[] = [
      { key: "a", label: "A", always: true, defaultVisible: false },
    ];
    expect(computeDefaults(cols)).toEqual({ a: true });
  });
});
