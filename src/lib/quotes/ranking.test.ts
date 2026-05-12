import { describe, expect, it } from "vitest";

import { pickPreferredListing } from "./ranking";
import type { Listing } from "./types";

function listing(partial: Partial<Listing> & { mic: string; currency: string }): Listing {
  return {
    exchangeName: partial.mic,
    providerSymbol: `X.${partial.mic}`,
    country: "",
    previousClose: null,
    ...partial,
  };
}

describe("pickPreferredListing", () => {
  it("returns null for an empty list", () => {
    expect(pickPreferredListing([])).toBeNull();
  });

  it("prefers an EUR listing over GBP/USD/GBX", () => {
    const picked = pickPreferredListing([
      listing({ mic: "XLON", currency: "GBP" }),
      listing({ mic: "XPAR", currency: "EUR" }),
      listing({ mic: "XNAS", currency: "USD", country: "US" }),
      listing({ mic: "XLON", currency: "GBX" }),
    ]);
    expect(picked?.mic).toBe("XPAR");
  });

  it("breaks EUR ties by MIC priority (XETR over XPAR)", () => {
    const picked = pickPreferredListing([
      listing({ mic: "XPAR", currency: "EUR" }),
      listing({ mic: "XETR", currency: "EUR" }),
      listing({ mic: "XAMS", currency: "EUR" }),
    ]);
    expect(picked?.mic).toBe("XETR");
  });

  it("picks XNAS when the listings universe is US-only (no real EU primary)", () => {
    const picked = pickPreferredListing([
      listing({ mic: "XNAS", currency: "USD", country: "US" }),
      listing({ mic: "XFRA", currency: "EUR", country: "DE" }),
    ]);
    expect(picked?.mic).toBe("XNAS");
  });

  it("keeps the EU EUR listing when a primary EU venue is present", () => {
    const picked = pickPreferredListing([
      listing({ mic: "XNAS", currency: "USD", country: "US" }),
      listing({ mic: "XETR", currency: "EUR", country: "DE" }),
      listing({ mic: "XAMS", currency: "EUR", country: "NL" }),
    ]);
    expect(picked?.mic).toBe("XETR");
  });
});
