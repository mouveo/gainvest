import { describe, expect, it } from "vitest";

import {
  isViewScope,
  mergeViewPayloadWithDefaults,
  normalizeViewPayload,
  validateViewName,
} from "./helpers";
import { DEFAULT_VIEW_PAYLOAD, VIEW_PAYLOAD_VERSION, type ViewPayload } from "./types";

describe("isViewScope", () => {
  it("accepts the three known scopes", () => {
    expect(isViewScope("positions")).toBe(true);
    expect(isViewScope("realizations")).toBe(true);
    expect(isViewScope("movements")).toBe(true);
  });

  it("rejects unknown or malformed scopes", () => {
    expect(isViewScope("global")).toBe(false);
    expect(isViewScope("")).toBe(false);
    expect(isViewScope(null)).toBe(false);
    expect(isViewScope(42)).toBe(false);
    expect(isViewScope({ scope: "positions" })).toBe(false);
  });
});

describe("normalizeViewPayload", () => {
  it("returns full defaults when input is empty / wrong shape", () => {
    expect(normalizeViewPayload(null)).toEqual(DEFAULT_VIEW_PAYLOAD);
    expect(normalizeViewPayload(undefined)).toEqual(DEFAULT_VIEW_PAYLOAD);
    expect(normalizeViewPayload("oops")).toEqual(DEFAULT_VIEW_PAYLOAD);
    expect(normalizeViewPayload([])).toEqual(DEFAULT_VIEW_PAYLOAD);
  });

  it("stamps the current version when missing or invalid", () => {
    expect(normalizeViewPayload({}).version).toBe(VIEW_PAYLOAD_VERSION);
    expect(normalizeViewPayload({ version: "1" }).version).toBe(VIEW_PAYLOAD_VERSION);
    expect(normalizeViewPayload({ version: 99 }).version).toBe(VIEW_PAYLOAD_VERSION);
  });

  it("filters out non-boolean column entries", () => {
    const out = normalizeViewPayload({ columns: { a: true, b: "no", c: false, d: 1 } });
    expect(out.columns).toEqual({ a: true, c: false });
  });

  it("normalizes sort entries and drops invalid ones", () => {
    const out = normalizeViewPayload({
      sort: [
        { id: "name", desc: true },
        { id: "qty" },
        { id: "" },
        { desc: false },
        "bad",
        null,
      ],
    });
    expect(out.sort).toEqual([
      { id: "name", desc: true },
      { id: "qty", desc: false },
    ]);
  });

  it("only keeps known toggle booleans", () => {
    const out = normalizeViewPayload({
      toggles: { withDividends: true, netOfFees: "yes", inflationAdjusted: false, junk: 1 },
    });
    expect(out.toggles).toEqual({ withDividends: true, inflationAdjusted: false });
  });

  it("ignores invalid pagination payloads", () => {
    expect(normalizeViewPayload({ pagination: { pageIndex: -1, pageSize: 10 } }).pagination).toBeUndefined();
    expect(normalizeViewPayload({ pagination: { pageIndex: 0, pageSize: 0 } }).pagination).toBeUndefined();
    expect(normalizeViewPayload({ pagination: "nope" }).pagination).toBeUndefined();
    const ok = normalizeViewPayload({ pagination: { pageIndex: 2, pageSize: 25 } });
    expect(ok.pagination).toEqual({ pageIndex: 2, pageSize: 25 });
  });

  it("preserves filter objects opaquely", () => {
    const filters = { tag: ["a", "b"], range: { from: "2024-01-01" } };
    const out = normalizeViewPayload({ filters });
    expect(out.filters).toEqual(filters);
    expect(out.filters).not.toBe(filters);
  });

  it("treats incomplete legacy payloads as valid (missing keys → defaults)", () => {
    const legacy = { columns: { foo: true } };
    const out = normalizeViewPayload(legacy);
    expect(out).toEqual({
      version: VIEW_PAYLOAD_VERSION,
      columns: { foo: true },
      filters: {},
      search: "",
      toggles: {},
      sort: [],
    });
  });
});

describe("mergeViewPayloadWithDefaults", () => {
  const defaults: ViewPayload = {
    version: VIEW_PAYLOAD_VERSION,
    columns: { name: true, qty: true, price: false },
    filters: { side: "buy" },
    search: "",
    toggles: { withDividends: true },
    sort: [{ id: "name", desc: false }],
  };

  it("fills missing columns from defaults without overriding user choices", () => {
    const saved = normalizeViewPayload({ columns: { qty: false } });
    const merged = mergeViewPayloadWithDefaults(saved, defaults);
    expect(merged.columns).toEqual({ name: true, qty: false, price: false });
  });

  it("falls back to default sort when the saved payload has none", () => {
    const saved = normalizeViewPayload({});
    const merged = mergeViewPayloadWithDefaults(saved, defaults);
    expect(merged.sort).toEqual([{ id: "name", desc: false }]);
  });

  it("keeps saved sort when present", () => {
    const saved = normalizeViewPayload({ sort: [{ id: "price", desc: true }] });
    const merged = mergeViewPayloadWithDefaults(saved, defaults);
    expect(merged.sort).toEqual([{ id: "price", desc: true }]);
  });

  it("merges toggles and filters, saved wins on conflict", () => {
    const saved = normalizeViewPayload({
      toggles: { withDividends: false, netOfFees: true },
      filters: { side: "sell", broker: "ibkr" },
    });
    const merged = mergeViewPayloadWithDefaults(saved, defaults);
    expect(merged.toggles).toEqual({ withDividends: false, netOfFees: true });
    expect(merged.filters).toEqual({ side: "sell", broker: "ibkr" });
  });
});

describe("validateViewName", () => {
  it("trims whitespace and accepts a non-empty name", () => {
    expect(validateViewName("  My View  ")).toEqual({ ok: true, name: "My View" });
  });

  it("rejects empty / whitespace-only names", () => {
    expect(validateViewName("")).toEqual({ ok: false, error: "name_empty" });
    expect(validateViewName("   ")).toEqual({ ok: false, error: "name_empty" });
    expect(validateViewName(null)).toEqual({ ok: false, error: "name_empty" });
    expect(validateViewName(42)).toEqual({ ok: false, error: "name_empty" });
  });

  it("rejects names over 80 characters", () => {
    const long = "x".repeat(81);
    expect(validateViewName(long)).toEqual({ ok: false, error: "name_too_long" });
  });

  it("accepts a name exactly 80 chars long", () => {
    const max = "x".repeat(80);
    expect(validateViewName(max)).toEqual({ ok: true, name: max });
  });
});
