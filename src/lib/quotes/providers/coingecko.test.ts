import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { coingeckoProvider } from "./coingecko";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env["COINGECKO_API_KEY"];

beforeEach(() => {
  delete process.env["COINGECKO_API_KEY"];
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_KEY === undefined) delete process.env["COINGECKO_API_KEY"];
  else process.env["COINGECKO_API_KEY"] = ORIGINAL_KEY;
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

describe("coingeckoProvider.searchListings", () => {
  it("returns [] when the query is an ISIN", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const listings = await coingeckoProvider.searchListings("FR0010655712");
    expect(listings).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("matches a symbol and returns a single Listing with mic=CRYPTO and currency=EUR", async () => {
    mockFetch(async () =>
      json([
        { id: "ethereum", symbol: "eth", name: "Ethereum" },
        { id: "tether", symbol: "usdt", name: "Tether" },
      ]),
    );

    const listings = await coingeckoProvider.searchListings("ETH");

    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({
      mic: "CRYPTO",
      currency: "EUR",
      exchangeName: "COINGECKO",
      providerSymbol: "ethereum",
      previousClose: null,
    });
  });

  it("places the primary id first when the symbol is ambiguous", async () => {
    mockFetch(async () =>
      json([
        { id: "wrapped-bitcoin", symbol: "btc", name: "Wrapped Bitcoin" },
        { id: "bitcoin", symbol: "btc", name: "Bitcoin" },
        { id: "btc-wat", symbol: "btc", name: "Random BTC Token" },
      ]),
    );

    const listings = await coingeckoProvider.searchListings("BTC");

    expect(listings).toHaveLength(3);
    expect(listings[0]!.providerSymbol).toBe("bitcoin");
  });

  it("attaches the demo API key header when COINGECKO_API_KEY is set", async () => {
    process.env["COINGECKO_API_KEY"] = "demo-key";
    let captured: HeadersInit | undefined;
    mockFetch(async (_input, init) => {
      captured = init?.headers;
      return json([]);
    });

    await coingeckoProvider.searchListings("BTC");

    expect(captured).toMatchObject({ "x-cg-demo-api-key": "demo-key" });
  });

  it("omits the API key header when COINGECKO_API_KEY is unset", async () => {
    let captured: HeadersInit | undefined;
    mockFetch(async (_input, init) => {
      captured = init?.headers;
      return json([]);
    });

    await coingeckoProvider.searchListings("BTC");

    expect(captured).toEqual({});
  });

  it("returns [] on non-OK responses", async () => {
    mockFetch(async () => new Response("rate limited", { status: 429 }));
    expect(await coingeckoProvider.searchListings("ETH")).toEqual([]);
  });
});

describe("coingeckoProvider.fetchQuote", () => {
  it("returns { close, fetchedAt } from /simple/price keyed on the id", async () => {
    mockFetch(async (input) => {
      const url = String(input);
      expect(url).toContain("/simple/price");
      expect(url).toContain("ids=bitcoin");
      expect(url).toContain("vs_currencies=eur");
      return json({ bitcoin: { eur: 60000 } });
    });

    const quote = await coingeckoProvider.fetchQuote("bitcoin");

    expect(quote).not.toBeNull();
    expect(quote?.close).toBe(60000);
    expect(Number.isNaN(Date.parse(quote!.fetchedAt))).toBe(false);
  });

  it("returns null when the response has no entry for the id", async () => {
    mockFetch(async () => json({}));
    expect(await coingeckoProvider.fetchQuote("bitcoin")).toBeNull();
  });

  it("returns null on non-OK responses", async () => {
    mockFetch(async () => new Response("rate limited", { status: 429 }));
    expect(await coingeckoProvider.fetchQuote("bitcoin")).toBeNull();
  });
});

describe("coingeckoProvider.fetchFxToEur", () => {
  it("returns 1 for EUR without hitting the network", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    expect(await coingeckoProvider.fetchFxToEur("EUR")).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns null for non-EUR currencies", async () => {
    expect(await coingeckoProvider.fetchFxToEur("USD")).toBeNull();
  });
});
