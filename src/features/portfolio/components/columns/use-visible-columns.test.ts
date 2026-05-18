import { describe, expect, it } from "vitest";

import { enforceAlways } from "./use-visible-columns";
import type { ColumnDef } from "./types";

type K = "instrument" | "broker" | "qty" | "pnl";

const COLUMNS: readonly ColumnDef<K>[] = [
  { key: "instrument", label: "Instrument", always: true },
  { key: "broker", label: "Broker", defaultVisible: true },
  { key: "qty", label: "Qty", defaultVisible: true },
  { key: "pnl", label: "PnL", defaultVisible: false },
];

describe("enforceAlways", () => {
  it("flips an always=true column back to true even when the persisted value says false", () => {
    const result = enforceAlways(
      { instrument: false, broker: true, qty: false, pnl: false },
      COLUMNS,
    );
    expect(result.instrument).toBe(true);
  });

  it("leaves user choices alone for non-always columns", () => {
    const result = enforceAlways(
      { instrument: false, broker: false, qty: true, pnl: true },
      COLUMNS,
    );
    expect(result).toEqual({
      instrument: true,
      broker: false,
      qty: true,
      pnl: true,
    });
  });

  it("returns a new object — does not mutate input", () => {
    const input = { instrument: false, broker: true, qty: true, pnl: false };
    const result = enforceAlways(input, COLUMNS);
    expect(result).not.toBe(input);
    expect(input.instrument).toBe(false);
  });
});
