import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Listing } from "@/lib/quotes";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/quotes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/quotes")>("@/lib/quotes");
  return {
    ...actual,
    quoteProvider: {
      name: "eodhd",
      searchListings: vi.fn<(isin: string) => Promise<Listing[]>>(),
      fetchQuote: vi.fn(),
      fetchFxToEur: vi.fn(),
    },
  };
});

import { createClient } from "@/lib/supabase/server";
import { quoteProvider } from "@/lib/quotes";

import { fetchAvailableListings, setInstrumentListing } from "./actions";

type Update = { table: string; id: string; payload: Record<string, unknown> };

function makeListing(overrides: Partial<Listing> & { mic: string; currency: string }): Listing {
  return {
    exchangeName: overrides.mic,
    providerSymbol: `X.${overrides.mic}`,
    country: "",
    previousClose: null,
    ...overrides,
  };
}

function makeSupabase(opts: {
  user?: { id: string } | null;
  ownedInstrumentIds?: string[];
}) {
  const updates: Update[] = [];
  const user = opts.user === undefined ? { id: "u1" } : opts.user;
  const owned = new Set(opts.ownedInstrumentIds ?? []);

  const client = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user } })),
    },
    from: vi.fn((table: string) => {
      if (table === "transactions") {
        const state: { eqUser?: string; eqInst?: string } = {};
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn((col: string, val: string) => {
            if (col === "user_id") state.eqUser = val;
            if (col === "instrument_id") state.eqInst = val;
            return builder;
          }),
          limit: vi.fn(() => builder),
          maybeSingle: vi.fn(() => {
            const matches =
              state.eqUser === user?.id && state.eqInst && owned.has(state.eqInst);
            return Promise.resolve({ data: matches ? { id: "t1" } : null, error: null });
          }),
        };
        return builder;
      }
      if (table === "instruments") {
        return {
          update: vi.fn((payload: Record<string, unknown>) => ({
            eq: vi.fn((col: string, val: string) => {
              updates.push({ table, id: col === "id" ? val : `${col}=${val}`, payload });
              return Promise.resolve({ error: null });
            }),
          })),
        };
      }
      return {};
    }),
  };

  return { client, updates };
}

const createClientMock = vi.mocked(createClient);
const searchListings = quoteProvider.searchListings as ReturnType<typeof vi.fn>;

beforeEach(() => {
  searchListings.mockReset();
  createClientMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("fetchAvailableListings", () => {
  it("returns [] for an empty ISIN without hitting the provider", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);

    const result = await fetchAvailableListings("");
    expect(result).toEqual([]);
    expect(searchListings).not.toHaveBeenCalled();
  });

  it("returns [] when the caller is not authenticated", async () => {
    const sb = makeSupabase({ user: null });
    createClientMock.mockResolvedValue(sb.client as never);

    const result = await fetchAvailableListings("FR0010655712");
    expect(result).toEqual([]);
    expect(searchListings).not.toHaveBeenCalled();
  });

  it("returns the provider listings with the preferred candidate ranked first", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);

    searchListings.mockResolvedValue([
      makeListing({ mic: "XPAR", currency: "EUR", providerSymbol: "CG1G.PA" }),
      makeListing({ mic: "XETR", currency: "EUR", providerSymbol: "CG1G.XETRA" }),
      makeListing({ mic: "XLON", currency: "GBP", providerSymbol: "CG1G.LSE" }),
    ]);

    const result = await fetchAvailableListings("FR0010655712");
    expect(result).toHaveLength(3);
    expect(result[0]!.mic).toBe("XETR");
  });
});

describe("setInstrumentListing", () => {
  it("rejects when the instrument id is empty", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);

    const r = await setInstrumentListing("", "XETR", "EUR");
    expect(r.ok).toBe(false);
  });

  it("rejects when MIC or currency is empty", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);

    expect((await setInstrumentListing("i1", "", "EUR")).ok).toBe(false);
    expect((await setInstrumentListing("i1", "XETR", "")).ok).toBe(false);
  });

  it("rejects when the user is not authenticated", async () => {
    const sb = makeSupabase({ user: null });
    createClientMock.mockResolvedValue(sb.client as never);

    const r = await setInstrumentListing("i1", "XETR", "EUR");
    expect(r).toEqual({ ok: false, error: "Non authentifié." });
    expect(sb.updates).toHaveLength(0);
  });

  it("refuses an instrument the user does not own", async () => {
    const sb = makeSupabase({ ownedInstrumentIds: [] });
    createClientMock.mockResolvedValue(sb.client as never);

    const r = await setInstrumentListing("i1", "XETR", "EUR");
    expect(r.ok).toBe(false);
    expect(sb.updates).toHaveLength(0);
  });

  it("writes preferred_mic/currency, mirrors currency, and clears provider fields", async () => {
    const sb = makeSupabase({ ownedInstrumentIds: ["i1"] });
    createClientMock.mockResolvedValue(sb.client as never);

    const r = await setInstrumentListing("i1", "xpar", "eur");
    expect(r).toEqual({ ok: true });
    expect(sb.updates).toHaveLength(1);
    expect(sb.updates[0]!.payload).toEqual({
      preferred_mic: "XPAR",
      preferred_currency: "EUR",
      currency: "EUR",
      provider: null,
      provider_symbol: null,
    });
    expect(sb.updates[0]!.id).toBe("i1");
  });

  it("never writes current_price or provider_symbol", async () => {
    const sb = makeSupabase({ ownedInstrumentIds: ["i1"] });
    createClientMock.mockResolvedValue(sb.client as never);

    await setInstrumentListing("i1", "XETR", "EUR");
    const payload = sb.updates[0]!.payload;
    expect(payload).not.toHaveProperty("current_price");
    expect(payload.provider_symbol).toBeNull();
  });
});
