import { describe, expect, it, vi } from "vitest";

import {
  applyPayloadEffects,
  filtersStateToRecord,
  recordToFiltersState,
} from "./use-view-state";
import type { ViewPayload } from "./types";

describe("filtersStateToRecord / recordToFiltersState", () => {
  it("round-trips a filter state through a record", () => {
    const original = [
      { id: "support", value: ["PEA"] },
      { id: "date", value: { from: "2024-01-01" } },
    ];
    const record = filtersStateToRecord(original);
    expect(record).toEqual({
      support: ["PEA"],
      date: { from: "2024-01-01" },
    });
    expect(recordToFiltersState(record)).toEqual(original);
  });
});

describe("applyPayloadEffects", () => {
  function makeSetters() {
    return {
      setSorting: vi.fn(),
      setColumnFilters: vi.fn(),
      setSearch: vi.fn(),
      setPagination: vi.fn(),
      setActiveViewId: vi.fn(),
    };
  }

  it("dispatches all state setters from a normalised payload", () => {
    const setters = makeSetters();
    const payload: ViewPayload = {
      version: 1,
      columns: { name: true, qty: false },
      filters: { support: ["CTO"] },
      search: "AAPL",
      toggles: { withDividends: false, netOfFees: true },
      sort: [{ id: "valuation", desc: true }],
      pagination: { pageIndex: 1, pageSize: 50 },
    };

    applyPayloadEffects(payload, { ...setters, id: "v-9" });

    expect(setters.setSorting).toHaveBeenCalledWith([{ id: "valuation", desc: true }]);
    expect(setters.setColumnFilters).toHaveBeenCalledWith([
      { id: "support", value: ["CTO"] },
    ]);
    expect(setters.setSearch).toHaveBeenCalledWith("AAPL");
    expect(setters.setPagination).toHaveBeenCalledWith({ pageIndex: 1, pageSize: 50 });
    expect(setters.setActiveViewId).toHaveBeenCalledWith("v-9");
  });

  it("normalises a malformed payload before dispatching", () => {
    const setters = makeSetters();
    applyPayloadEffects(
      { columns: { a: true, b: "no" }, sort: [{ id: "x", desc: 1 }] },
      setters,
    );
    expect(setters.setSorting).toHaveBeenCalledWith([{ id: "x", desc: false }]);
    expect(setters.setSearch).toHaveBeenCalledWith("");
    expect(setters.setPagination).toHaveBeenCalledWith(null);
    expect(setters.setActiveViewId).toHaveBeenCalledWith(null);
  });

  it("calls toggle setters only for toggles present on the payload", () => {
    const setters = makeSetters();
    const setWithDividends = vi.fn();
    const setNetOfFees = vi.fn();
    const setInflationAdjusted = vi.fn();

    applyPayloadEffects(
      {
        version: 1,
        columns: {},
        filters: {},
        search: "",
        sort: [],
        toggles: { withDividends: true },
      },
      {
        ...setters,
        toggleSetters: { setWithDividends, setNetOfFees, setInflationAdjusted },
      },
    );

    expect(setWithDividends).toHaveBeenCalledWith(true);
    expect(setNetOfFees).not.toHaveBeenCalled();
    expect(setInflationAdjusted).not.toHaveBeenCalled();
  });

  it("forwards the normalised columns to setVisibleColumns", () => {
    const setters = makeSetters();
    const setVisibleColumns = vi.fn();
    applyPayloadEffects(
      {
        version: 1,
        columns: { a: true, b: false, garbage: "no" },
        filters: {},
        search: "",
        sort: [],
        toggles: {},
      },
      { ...setters, setVisibleColumns },
    );
    expect(setVisibleColumns).toHaveBeenCalledWith({ a: true, b: false });
  });
});
