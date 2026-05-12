import { afterEach, describe, expect, it, vi } from "vitest";

import { isValidIsin, lookupIsin } from "./openfigi";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
}

describe("isValidIsin", () => {
  it("accepts a well-formed ISIN", () => {
    expect(isValidIsin("US0378331005")).toBe(true);
  });

  it("rejects malformed strings", () => {
    expect(isValidIsin("INVALID")).toBe(false);
    expect(isValidIsin("us0378331005")).toBe(false);
    expect(isValidIsin("US037833100X")).toBe(false);
  });
});

describe("lookupIsin", () => {
  it("returns equity / USD for an Apple-like FIGI payload", async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify([
            {
              data: [
                {
                  name: "APPLE INC",
                  ticker: "AAPL",
                  securityType: "Common Stock",
                  securityType2: "Common Stock",
                  exchCode: "US",
                },
              ],
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    const result = await lookupIsin("US0378331005");

    expect(result).not.toBeNull();
    expect(result?.name).toBe("APPLE INC");
    expect(result?.assetClass).toBe("equity");
    expect(result?.currency).toBe("USD");
    expect(result?.ticker).toBe("AAPL");
    expect(result?.country).toBe("US");
    expect(result?.source).toBe("openfigi");
  });

  it("returns null when payload is missing data", async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify([{ warning: "No identifier found." }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    expect(await lookupIsin("US0378331005")).toBeNull();
  });

  it("returns null on a non-OK HTTP response", async () => {
    mockFetch(async () => new Response("rate limited", { status: 429 }));
    expect(await lookupIsin("US0378331005")).toBeNull();
  });

  it("returns null for an invalid ISIN without calling fetch", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    expect(await lookupIsin("nope")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
