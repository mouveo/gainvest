import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Listing, Quote } from "@/lib/quotes";

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
      fetchQuote: vi.fn<(symbol: string) => Promise<Quote | null>>(),
      fetchFxToEur: vi.fn<(ccy: string) => Promise<number | null>>(),
    },
  };
});

import { createClient } from "@/lib/supabase/server";
import { quoteProvider } from "@/lib/quotes";

import { refreshPrices } from "./actions";

type InstrumentRow = {
  id: string;
  isin: string | null;
  name: string;
  currency: string;
  preferred_mic: string | null;
  preferred_currency: string | null;
  provider: string | null;
  provider_symbol: string | null;
  current_price: number | null;
  current_price_updated_at: string | null;
};

type Update = { table: string; id: string; payload: Record<string, unknown> };
type Upsert = { table: string; payload: Record<string, unknown>; opts: unknown };

function makeInstrument(overrides: Partial<InstrumentRow>): InstrumentRow {
  return {
    id: "i1",
    isin: "FR0010655712",
    name: "Test Instrument",
    currency: "EUR",
    preferred_mic: null,
    preferred_currency: null,
    provider: null,
    provider_symbol: null,
    current_price: null,
    current_price_updated_at: null,
    ...overrides,
  };
}

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
  instruments: InstrumentRow[];
  fxRates?: { currency: string; fetched_at: string }[];
}) {
  const updates: Update[] = [];
  const upserts: Upsert[] = [];

  const user = opts.user === undefined ? { id: "u1" } : opts.user;
  const transactions = opts.instruments.map((inst) => ({ instrument: inst }));
  const fxRates = opts.fxRates ?? [];

  const client = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user } })),
    },
    from: vi.fn((table: string) => {
      const builder = {
        select: vi.fn(() => builder),
        in: vi.fn((_col: string, _values: unknown[]) => {
          if (table === "transactions") {
            return Promise.resolve({ data: transactions, error: null });
          }
          if (table === "fx_rates") {
            return Promise.resolve({ data: fxRates, error: null });
          }
          return Promise.resolve({ data: [], error: null });
        }),
        update: vi.fn((payload: Record<string, unknown>) => ({
          eq: vi.fn((col: string, val: string) => {
            updates.push({ table, id: col === "id" ? val : `${col}=${val}`, payload });
            return Promise.resolve({ error: null });
          }),
        })),
        upsert: vi.fn((payload: Record<string, unknown>, optsArg: unknown) => {
          upserts.push({ table, payload, opts: optsArg });
          return Promise.resolve({ error: null });
        }),
      };
      return builder;
    }),
  };

  return { client, updates, upserts };
}

const createClientMock = vi.mocked(createClient);
const searchListings = quoteProvider.searchListings as ReturnType<typeof vi.fn>;
const fetchQuote = quoteProvider.fetchQuote as ReturnType<typeof vi.fn>;
const fetchFxToEur = quoteProvider.fetchFxToEur as ReturnType<typeof vi.fn>;

beforeEach(() => {
  searchListings.mockReset();
  fetchQuote.mockReset();
  fetchFxToEur.mockReset();
  createClientMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("refreshPrices", () => {
  it("auto-picks a preferred listing for instruments without one and fetches a quote", async () => {
    const inst = makeInstrument({ preferred_mic: null, isin: "FR0010655712" });
    const sb = makeSupabase({ instruments: [inst] });
    createClientMock.mockResolvedValue(sb.client as never);

    searchListings.mockResolvedValue([
      makeListing({
        mic: "XETR",
        currency: "EUR",
        providerSymbol: "CG1G.XETRA",
        country: "Germany",
      }),
      makeListing({
        mic: "XPAR",
        currency: "EUR",
        providerSymbol: "CG1G.PA",
        country: "France",
      }),
    ]);
    fetchQuote.mockResolvedValue({ close: 12.5, fetchedAt: "2026-05-12T00:00:00.000Z" });

    const result = await refreshPrices({ force: true });

    expect(result.refreshed).toBe(1);
    expect(result.failed).toEqual([]);
    expect(searchListings).toHaveBeenCalledWith("FR0010655712");
    expect(fetchQuote).toHaveBeenCalledWith("CG1G.XETRA");

    expect(sb.updates).toHaveLength(2);
    expect(sb.updates[0]!.payload).toMatchObject({
      preferred_mic: "XETR",
      preferred_currency: "EUR",
      currency: "EUR",
      provider: "eodhd",
      provider_symbol: "CG1G.XETRA",
    });
    expect(sb.updates[1]!.payload).toMatchObject({ current_price: 12.5 });
  });

  it("remaps provider_symbol when it is null but a preference is set", async () => {
    const inst = makeInstrument({
      preferred_mic: "XETR",
      preferred_currency: "EUR",
      currency: "EUR",
      provider: null,
      provider_symbol: null,
    });
    const sb = makeSupabase({ instruments: [inst] });
    createClientMock.mockResolvedValue(sb.client as never);

    searchListings.mockResolvedValue([
      makeListing({ mic: "XPAR", currency: "EUR", providerSymbol: "CG1G.PA" }),
      makeListing({ mic: "XETR", currency: "EUR", providerSymbol: "CG1G.XETRA" }),
    ]);
    fetchQuote.mockResolvedValue({ close: 13, fetchedAt: "2026-05-12T00:00:00.000Z" });

    const result = await refreshPrices({ force: true });

    expect(result.refreshed).toBe(1);
    expect(sb.updates[0]!.payload).toMatchObject({
      provider: "eodhd",
      provider_symbol: "CG1G.XETRA",
      currency: "EUR",
    });
    expect(fetchQuote).toHaveBeenCalledWith("CG1G.XETRA");
  });

  it("remaps provider_symbol when the stored provider differs from the active one", async () => {
    const inst = makeInstrument({
      preferred_mic: "XPAR",
      preferred_currency: "EUR",
      currency: "EUR",
      provider: "legacy",
      provider_symbol: "old.symbol",
    });
    const sb = makeSupabase({ instruments: [inst] });
    createClientMock.mockResolvedValue(sb.client as never);

    searchListings.mockResolvedValue([
      makeListing({ mic: "XPAR", currency: "EUR", providerSymbol: "CG1G.PA" }),
    ]);
    fetchQuote.mockResolvedValue({ close: 13, fetchedAt: "2026-05-12T00:00:00.000Z" });

    await refreshPrices({ force: true });

    expect(searchListings).toHaveBeenCalledWith("FR0010655712");
    expect(sb.updates[0]!.payload).toMatchObject({
      provider: "eodhd",
      provider_symbol: "CG1G.PA",
    });
    expect(fetchQuote).toHaveBeenCalledWith("CG1G.PA");
  });

  it("rejects a >50% divergent quote without force and keeps the old price", async () => {
    const inst = makeInstrument({
      preferred_mic: "XETR",
      preferred_currency: "EUR",
      currency: "EUR",
      provider: "eodhd",
      provider_symbol: "CG1G.XETRA",
      current_price: 100,
      current_price_updated_at: null,
    });
    const sb = makeSupabase({ instruments: [inst] });
    createClientMock.mockResolvedValue(sb.client as never);

    fetchQuote.mockResolvedValue({ close: 250, fetchedAt: "2026-05-12T00:00:00.000Z" });

    const result = await refreshPrices();

    expect(result.refreshed).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatch(/divergence >50%/);
    expect(sb.updates).toHaveLength(0);
  });

  it("writes a >50% divergent quote when force is true", async () => {
    const inst = makeInstrument({
      preferred_mic: "XETR",
      preferred_currency: "EUR",
      currency: "EUR",
      provider: "eodhd",
      provider_symbol: "CG1G.XETRA",
      current_price: 100,
    });
    const sb = makeSupabase({ instruments: [inst] });
    createClientMock.mockResolvedValue(sb.client as never);

    fetchQuote.mockResolvedValue({ close: 250, fetchedAt: "2026-05-12T00:00:00.000Z" });

    const result = await refreshPrices({ force: true });

    expect(result.refreshed).toBe(1);
    expect(result.failed).toEqual([]);
    expect(sb.updates[0]!.payload).toMatchObject({ current_price: 250 });
  });

  it("keeps currency aligned with preferred_currency and queries FX for non-EUR", async () => {
    const inst = makeInstrument({
      isin: "US0378331005",
      preferred_mic: null,
      currency: "EUR",
    });
    const sb = makeSupabase({ instruments: [inst] });
    createClientMock.mockResolvedValue(sb.client as never);

    searchListings.mockResolvedValue([
      makeListing({
        mic: "XNAS",
        currency: "USD",
        providerSymbol: "AAPL.US",
        country: "US",
      }),
    ]);
    fetchQuote.mockResolvedValue({ close: 187, fetchedAt: "2026-05-12T00:00:00.000Z" });
    fetchFxToEur.mockResolvedValue(0.85);

    const result = await refreshPrices({ force: true });

    expect(result.refreshed).toBe(1);
    expect(sb.updates[0]!.payload).toMatchObject({
      preferred_mic: "XNAS",
      preferred_currency: "USD",
      currency: "USD",
    });
    expect(fetchFxToEur).toHaveBeenCalledWith("USD");
    expect(sb.upserts).toHaveLength(1);
    expect(sb.upserts[0]!.payload).toMatchObject({ currency: "USD", eur_rate: 0.85 });
  });

  it("applies a GBX listing's FX as GBP / 100 via the provider", async () => {
    const inst = makeInstrument({
      isin: "GB00B6QH1J21",
      preferred_mic: null,
      currency: "EUR",
    });
    const sb = makeSupabase({ instruments: [inst] });
    createClientMock.mockResolvedValue(sb.client as never);

    searchListings.mockResolvedValue([
      makeListing({
        mic: "XLON",
        currency: "GBX",
        providerSymbol: "VOD.LSE",
        country: "GB",
      }),
    ]);
    fetchQuote.mockResolvedValue({ close: 88, fetchedAt: "2026-05-12T00:00:00.000Z" });
    fetchFxToEur.mockResolvedValue(1.18 / 100);

    const result = await refreshPrices({ force: true });

    expect(result.refreshed).toBe(1);
    expect(sb.updates[0]!.payload).toMatchObject({
      preferred_currency: "GBX",
      currency: "GBX",
    });
    expect(fetchFxToEur).toHaveBeenCalledWith("GBX");
  });

  it("does not apply the divergence guard when current_price is null", async () => {
    const inst = makeInstrument({
      preferred_mic: "XETR",
      preferred_currency: "EUR",
      currency: "EUR",
      provider: "eodhd",
      provider_symbol: "CG1G.XETRA",
      current_price: null,
    });
    const sb = makeSupabase({ instruments: [inst] });
    createClientMock.mockResolvedValue(sb.client as never);

    fetchQuote.mockResolvedValue({ close: 9999, fetchedAt: "2026-05-12T00:00:00.000Z" });

    const result = await refreshPrices();

    expect(result.refreshed).toBe(1);
    expect(result.failed).toEqual([]);
    expect(sb.updates[0]!.payload).toMatchObject({ current_price: 9999 });
  });
});
