import { describe, expect, it } from "vitest";

import { formatPreferredLabel, listingKey } from "./listing-picker.helpers";

describe("formatPreferredLabel", () => {
  it('renders "Auto" when no MIC is set', () => {
    expect(formatPreferredLabel(null, null)).toBe("Auto");
    expect(formatPreferredLabel(undefined, undefined)).toBe("Auto");
    expect(formatPreferredLabel("", "EUR")).toBe("Auto");
  });

  it('renders "MIC / currency" when both are set', () => {
    expect(formatPreferredLabel("XETR", "EUR")).toBe("XETR / EUR");
    expect(formatPreferredLabel("XPAR", "EUR")).toBe("XPAR / EUR");
  });

  it("falls back to MIC alone when currency is missing", () => {
    expect(formatPreferredLabel("XETR", null)).toBe("XETR");
    expect(formatPreferredLabel("XETR", "")).toBe("XETR");
  });
});

describe("listingKey", () => {
  it("produces a unique key per (mic, currency) tuple", () => {
    expect(listingKey("XETR", "EUR")).not.toBe(listingKey("XETR", "GBX"));
    expect(listingKey("XETR", "EUR")).not.toBe(listingKey("XPAR", "EUR"));
  });
});
