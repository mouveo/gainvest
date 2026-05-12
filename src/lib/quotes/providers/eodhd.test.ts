import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { eodhdProvider } from "./eodhd";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env["EODHD_API_KEY"];

beforeEach(() => {
  process.env["EODHD_API_KEY"] = "test-key";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_KEY === undefined) delete process.env["EODHD_API_KEY"];
  else process.env["EODHD_API_KEY"] = ORIGINAL_KEY;
  vi.restoreAllMocks();
});

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("eodhdProvider.searchListings", () => {
  it("maps hits to Listing with correct MICs and provider symbols", async () => {
    mockFetch(async () =>
      json([
        {
          Code: "CG1G",
          Exchange: "XETRA",
          Name: "Carmignac Long-Short",
          Country: "Germany",
          Currency: "EUR",
          ISIN: "FR0010655712",
          previousClose: 12.34,
        },
        {
          Code: "CG1G",
          Exchange: "PA",
          Name: "Carmignac Long-Short",
          Country: "France",
          Currency: "EUR",
          ISIN: "FR0010655712",
          previousClose: "12.30",
        },
        {
          Code: "JUNK",
          Exchange: "UNKNOWN_VENUE",
          Currency: "EUR",
        },
      ]),
    );

    const listings = await eodhdProvider.searchListings("FR0010655712");

    expect(listings).toHaveLength(2);
    expect(listings[0]).toMatchObject({
      mic: "XETR",
      currency: "EUR",
      exchangeName: "XETRA",
      providerSymbol: "CG1G.XETRA",
      country: "Germany",
      previousClose: 12.34,
    });
    expect(listings[1]).toMatchObject({
      mic: "XPAR",
      providerSymbol: "CG1G.PA",
      previousClose: 12.3,
    });
  });
});

describe("eodhdProvider.fetchQuote", () => {
  it("returns { close, fetchedAt } from the real-time payload", async () => {
    mockFetch(async () => json({ close: 187.42 }));

    const quote = await eodhdProvider.fetchQuote("AAPL.US");

    expect(quote).not.toBeNull();
    expect(quote?.close).toBe(187.42);
    expect(typeof quote?.fetchedAt).toBe("string");
    expect(Number.isNaN(Date.parse(quote!.fetchedAt))).toBe(false);
  });

  it("returns null on non-OK responses", async () => {
    mockFetch(async () => new Response("rate limited", { status: 429 }));
    expect(await eodhdProvider.fetchQuote("AAPL.US")).toBeNull();
  });
});

describe("eodhdProvider.fetchFxToEur", () => {
  it("returns 1 for EUR without hitting the network", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    expect(await eodhdProvider.fetchFxToEur("EUR")).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it("derives GBX as GBP / 100", async () => {
    mockFetch(async (input) => {
      const url = String(input);
      if (url.includes("GBPEUR.FOREX")) return json({ close: 1.18 });
      throw new Error(`unexpected fetch to ${url}`);
    });

    const rate = await eodhdProvider.fetchFxToEur("GBX");
    expect(rate).toBeCloseTo(1.18 / 100, 6);
  });

  it("uses the <CCY>EUR.FOREX pair for other currencies", async () => {
    mockFetch(async (input) => {
      const url = String(input);
      if (url.includes("USDEUR.FOREX")) return json({ close: 0.85 });
      throw new Error(`unexpected fetch to ${url}`);
    });

    expect(await eodhdProvider.fetchFxToEur("USD")).toBe(0.85);
  });
});
