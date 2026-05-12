import { describe, expect, it } from "vitest";

import type { Listing } from "@/lib/quotes";

import {
  formatOrderListingLabel,
  orderListingKey,
  parseOrderListingKey,
} from "./order-listing-select.helpers";

function listing(overrides: Partial<Listing> & { mic: string; currency: string }): Listing {
  return {
    exchangeName: overrides.mic,
    providerSymbol: `X.${overrides.mic}`,
    country: "",
    previousClose: null,
    ...overrides,
  };
}

describe("orderListingKey", () => {
  it("produces a unique key per (mic, currency) tuple", () => {
    expect(orderListingKey("XETR", "EUR")).not.toBe(orderListingKey("XETR", "GBX"));
    expect(orderListingKey("XETR", "EUR")).not.toBe(orderListingKey("XPAR", "EUR"));
  });
});

describe("parseOrderListingKey", () => {
  it("round-trips a valid key", () => {
    const key = orderListingKey("XAMS", "EUR");
    expect(parseOrderListingKey(key)).toEqual({ mic: "XAMS", currency: "EUR" });
  });

  it("returns null for an invalid key", () => {
    expect(parseOrderListingKey("")).toBeNull();
    expect(parseOrderListingKey("XAMS")).toBeNull();
    expect(parseOrderListingKey("\x01EUR")).toBeNull();
    expect(parseOrderListingKey("XAMS\x01")).toBeNull();
  });
});

describe("formatOrderListingLabel", () => {
  it("includes MIC, label, currency and last close when available", () => {
    const label = formatOrderListingLabel(
      listing({ mic: "XETR", currency: "EUR", previousClose: 1234.5 }),
    );
    expect(label).toContain("XETR");
    expect(label).toContain("Xetra");
    expect(label).toContain("EUR");
    expect(label).toContain("1 234,50");
  });

  it("omits the price segment when previousClose is null", () => {
    const label = formatOrderListingLabel(
      listing({ mic: "XPAR", currency: "EUR", previousClose: null }),
    );
    expect(label).toContain("XPAR");
    expect(label).toContain("Paris");
    expect(label).toContain("EUR");
    expect(label).not.toMatch(/\d/);
  });
});
