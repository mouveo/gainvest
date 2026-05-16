import { describe, expect, it, vi } from "vitest";

import cpiFrance from "@/data/cpi-france.json";

import {
  CPI_BASE_YEAR,
  adjustFlowsForInflation,
  adjustForInflation,
  getCpiIndex,
} from "./inflation";

const values = (cpiFrance as { values: Record<string, number> }).values;
const months = Object.keys(values).sort();
const FIRST = months[0]!;
const LAST = months[months.length - 1]!;

describe("inflation helpers", () => {
  it("exposes the dataset's CPI base year", () => {
    expect(CPI_BASE_YEAR).toBe(2025);
  });

  it("returns the exact CPI for a known month", () => {
    const m = "2020-06";
    expect(getCpiIndex(`${m}-15`)).toBe(values[m]);
  });

  it("falls back to the last known value for a future date", () => {
    expect(getCpiIndex("2999-12-01")).toBe(values[LAST]);
  });

  it("falls back to the first known value for a pre-series date", () => {
    expect(getCpiIndex("1800-01-15")).toBe(values[FIRST]);
  });

  it("falls back to the last known value when a month is missing", () => {
    expect(getCpiIndex(`${LAST}-15`)).toBe(values[LAST]);
  });

  it("adjusts amounts by the CPI ratio between two months", () => {
    const fromMonth = "2000-01";
    const toMonth = "2020-01";
    const ratio = values[toMonth]! / values[fromMonth]!;
    const got = adjustForInflation(100, `${fromMonth}-10`, `${toMonth}-10`);
    expect(got).toBeCloseTo(100 * ratio, 8);
  });

  it("leaves a flow at the reference date unchanged", () => {
    const ref = `${LAST}-10`;
    const result = adjustFlowsForInflation([{ date: ref, amount: 500 }], ref);
    expect(result[0]!.amount).toBeCloseTo(500, 8);
  });

  it("applies the ratio across an array of flows", () => {
    const ref = "2024-06-30";
    const flows = [
      { date: "2010-01-15", amount: 100 },
      { date: "2015-07-15", amount: 200 },
    ];
    const adjusted = adjustFlowsForInflation(flows, ref);
    for (let i = 0; i < flows.length; i++) {
      const expected = adjustForInflation(
        flows[i]!.amount,
        flows[i]!.date,
        ref,
      );
      expect(adjusted[i]!.amount).toBeCloseTo(expected, 10);
      expect(adjusted[i]!.date).toBe(flows[i]!.date);
    }
  });

  it("does not re-sort the month list on each lookup", () => {
    const keysSpy = vi.spyOn(Object, "keys");
    for (let i = 0; i < 100; i++) {
      getCpiIndex("2018-04-12");
      getCpiIndex("1995-11-30");
      getCpiIndex(`${LAST}-15`);
    }
    expect(keysSpy).not.toHaveBeenCalled();
    keysSpy.mockRestore();
  });
});
