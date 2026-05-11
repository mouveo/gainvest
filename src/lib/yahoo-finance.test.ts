import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchQuotes } from "./yahoo-finance";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
}

function quoteResponse(result: unknown): Response {
  return new Response(JSON.stringify({ quoteResponse: { result } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchQuotes", () => {
  it("returns [] and does not call fetch when symbols is empty", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;

    expect(await fetchQuotes([])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("parses a valid payload with regularMarketPrice", async () => {
    mockFetch(async () =>
      quoteResponse([
        {
          symbol: "AAPL",
          regularMarketPrice: 187.25,
          currency: "USD",
          fullExchangeName: "NasdaqGS",
        },
      ]),
    );

    const quotes = await fetchQuotes(["AAPL"]);

    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.symbol).toBe("AAPL");
    expect(quotes[0]!.price).toBe(187.25);
    expect(quotes[0]!.currency).toBe("USD");
    expect(quotes[0]!.exchangeName).toBe("NasdaqGS");
    expect(typeof quotes[0]!.fetchedAt).toBe("string");
  });

  it("ignores a non-OK response", async () => {
    mockFetch(async () => new Response("nope", { status: 500 }));
    expect(await fetchQuotes(["AAPL"])).toEqual([]);
  });

  it("ignores a row without a numeric regularMarketPrice", async () => {
    mockFetch(async () =>
      quoteResponse([
        { symbol: "AAPL", regularMarketPrice: 100, currency: "USD" },
        { symbol: "MSFT", currency: "USD" },
        { symbol: "GOOG", regularMarketPrice: "not-a-number", currency: "USD" },
      ]),
    );

    const quotes = await fetchQuotes(["AAPL", "MSFT", "GOOG"]);

    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.symbol).toBe("AAPL");
  });

  it("splits >50 symbols across multiple batches", async () => {
    const calls: string[] = [];
    mockFetch(async (input) => {
      calls.push(String(input));
      return quoteResponse([]);
    });

    const symbols = Array.from({ length: 120 }, (_, i) => `SYM${i}`);
    await fetchQuotes(symbols);

    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain("SYM0");
    expect(calls[0]).toContain("SYM49");
    expect(calls[0]).not.toContain("SYM50,");
    expect(calls[1]).toContain("SYM50");
    expect(calls[1]).toContain("SYM99");
    expect(calls[2]).toContain("SYM100");
    expect(calls[2]).toContain("SYM119");
  });

  it("does not throw when payload shape is incomplete", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ foo: "bar" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(fetchQuotes(["AAPL"])).resolves.toEqual([]);
  });

  it("deduplicates symbols before batching", async () => {
    const calls: string[] = [];
    mockFetch(async (input) => {
      calls.push(String(input));
      return quoteResponse([]);
    });

    await fetchQuotes(["AAPL", "AAPL", "MSFT", "AAPL"]);

    expect(calls).toHaveLength(1);
    const url = calls[0]!;
    const matches = url.match(/AAPL/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(url).toContain("MSFT");
  });
});
