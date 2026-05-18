import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/openfigi", () => ({
  lookupIsin: vi.fn(),
}));

vi.mock("@/lib/quotes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/quotes")>("@/lib/quotes");
  return {
    ...actual,
    coingeckoProvider: {
      name: "coingecko",
      searchListings: vi.fn(),
      fetchQuote: vi.fn(),
      fetchFxToEur: vi.fn(),
    },
  };
});

vi.mock("@/features/accounts/active", () => ({
  getActiveAccount: vi.fn(async () => "acc-1"),
  resolveWritableAccountId: vi.fn(async (override?: string | null) =>
    override
      ? { ok: true as const, accountId: override }
      : { ok: true as const, accountId: "acc-1" },
  ),
}));

import { lookupIsin } from "@/lib/openfigi";
import { coingeckoProvider } from "@/lib/quotes";
import { createClient } from "@/lib/supabase/server";

import type { ParsedRow } from "../brokers/types";

import { importBrokerOrders } from "./actions";

type InstrumentRow = {
  id: string;
  isin: string | null;
  symbol?: string | null;
  name: string;
  asset_class: string;
  currency: string;
  bond_coupon_rate?: number | null;
  bond_maturity_date?: string | null;
  bond_coupon_frequency?: number | null;
  preferred_mic?: string | null;
  preferred_currency?: string | null;
  provider?: string | null;
  provider_symbol?: string | null;
};

type UpsertCall = { payload: Record<string, unknown>; opts: unknown };
type UpdateCall = { id: string; patch: Record<string, unknown> };
type InsertedTx = Record<string, unknown>;
type InstrumentInsertCall = { payload: Record<string, unknown> };

function makeSupabase(opts: {
  existingInstruments?: InstrumentRow[];
  insertedInstrument?: (payload: Record<string, unknown>) => InstrumentRow | null;
  updatedInstrument?: (id: string, patch: Record<string, unknown>) => InstrumentRow | null;
  insertedCryptoInstrument?: (payload: Record<string, unknown>) => InstrumentRow | null;
}) {
  const upserts: UpsertCall[] = [];
  const updates: UpdateCall[] = [];
  const insertedTx: InsertedTx[] = [];
  const cryptoInserts: InstrumentInsertCall[] = [];
  let existing: InstrumentRow[] = (opts.existingInstruments ?? []).slice();

  const client = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })),
    },
    from: vi.fn((table: string) => {
      if (table === "accounts") {
        return {
          select: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: { id: "acc-1" }, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "instruments") {
        return {
          select: (_cols: string) => ({
            // ISIN-keyed read: .in("isin", [...]).
            in: async (col: string, isins: string[]) => ({
              data: existing.filter((e) =>
                col === "isin" ? e.isin && isins.includes(e.isin) : false,
              ),
              error: null,
            }),
            // Crypto read: .eq("asset_class","crypto").in("symbol", [...]).
            eq: (_col: string, assetClass: string) => ({
              in: async (_symCol: string, symbols: string[]) => ({
                data: existing.filter(
                  (e) =>
                    e.asset_class === assetClass &&
                    (e as { symbol?: string | null }).symbol != null &&
                    symbols.includes((e as { symbol?: string | null }).symbol as string),
                ),
                error: null,
              }),
            }),
          }),
          upsert: (payload: Record<string, unknown>, upsertOpts: unknown) => {
            upserts.push({ payload, opts: upsertOpts });
            const created = opts.insertedInstrument?.(payload) ?? null;
            return {
              select: () => ({
                single: async () => ({ data: created, error: created ? null : { message: "no row" } }),
              }),
            };
          },
          insert: (payload: Record<string, unknown>) => {
            cryptoInserts.push({ payload });
            const created = opts.insertedCryptoInstrument?.(payload) ?? null;
            if (created) existing.push(created);
            return {
              select: () => ({
                single: async () => ({ data: created, error: created ? null : { message: "no row" } }),
              }),
            };
          },
          update: (patch: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => {
              updates.push({ id, patch });
              const updated = opts.updatedInstrument?.(id, patch) ?? null;
              if (updated) {
                existing = existing.map((e) => (e.id === id ? updated : e));
              }
              return {
                select: () => ({
                  single: async () => ({ data: updated, error: updated ? null : { message: "no row" } }),
                }),
              };
            },
          }),
        };
      }
      if (table === "transactions") {
        // Two queries reach this builder:
        //  - dedup window: .select(cols).eq("account_id", x).gte(...).lte(...)
        //  - priorTx read: .select(cols).eq("account_id", x).eq("support", s)
        //                                .in("kind", [...]).in("instrument_id", [...])
        // Use a self-referential builder so each .eq / .in / .gte / .lte hop
        // returns the same shape, and any terminal method resolves to [].
        const builder: Record<string, unknown> = {};
        const terminate = async () => ({ data: [] as unknown[], error: null });
        builder.eq = () => builder;
        builder.in = () => builder;
        builder.gte = () => builder;
        builder.lte = terminate;
        builder.then = (resolve: (value: { data: unknown[]; error: null }) => void) => {
          const value = { data: [] as unknown[], error: null };
          resolve(value);
          return Promise.resolve(value);
        };
        return {
          select: (_cols: string) => builder,
          insert: async (chunk: InsertedTx[]) => {
            for (const row of chunk) insertedTx.push(row);
            return { error: null };
          },
        };
      }
      return {};
    }),
  };

  return { client, upserts, updates, insertedTx, cryptoInserts, getExisting: () => existing };
}

const createClientMock = vi.mocked(createClient);
const lookupIsinMock = vi.mocked(lookupIsin);
const cgSearchListings = coingeckoProvider.searchListings as ReturnType<typeof vi.fn>;
const cgFetchQuote = coingeckoProvider.fetchQuote as ReturnType<typeof vi.fn>;

beforeEach(() => {
  createClientMock.mockReset();
  lookupIsinMock.mockReset();
  cgSearchListings.mockReset();
  cgFetchQuote.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function bondBuyRow(overrides: Partial<ParsedRow> = {}): ParsedRow {
  return {
    rawLine: 1,
    date: "2024-06-01",
    kind: "buy",
    isin: "US912828YV68",
    description: "UST 4.125 11/15/27",
    quantity: 10000,
    totalAmount: 9902.25,
    grossAmount: 9900.25,
    price: 98.5,
    needsAttention: false,
    externalId: "exec-bond-1",
    symbol: "UST",
    name: "UST 4.125 11/15/27",
    currency: "USD",
    fees: 2,
    fxRate: 0.91,
    broker: "Interactive Brokers",
    assetClass: "bond",
    tradeId: "trade-bond-1",
    ...overrides,
  };
}

describe("importBrokerOrders — broker-metadata fallback for instruments", () => {
  it("creates the instrument from broker metadata when OpenFIGI returns null", async () => {
    lookupIsinMock.mockResolvedValue(null);
    const sb = makeSupabase({
      existingInstruments: [],
      insertedInstrument: (payload) => ({
        id: "inst-bond-1",
        isin: payload.isin as string,
        name: payload.name as string,
        asset_class: payload.asset_class as string,
        currency: payload.currency as string,
      }),
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const result = await importBrokerOrders("interactive-brokers", "CTO", [bondBuyRow()]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inserted).toBe(1);
    expect(sb.upserts).toHaveLength(1);
    expect(sb.upserts[0]!.payload.asset_class).toBe("bond");
    expect(sb.upserts[0]!.payload.name).toBe("UST 4.125 11/15/27");
    expect(sb.upserts[0]!.payload.currency).toBe("USD");
    expect(sb.insertedTx).toHaveLength(1);
    expect(sb.insertedTx[0]!.instrument_id).toBe("inst-bond-1");
  });

  it("updates asset_class when the cached instrument carries the wrong class", async () => {
    lookupIsinMock.mockResolvedValue(null);
    const sb = makeSupabase({
      existingInstruments: [
        {
          id: "inst-bond-1",
          isin: "US912828YV68",
          name: "UST 4.125 11/15/27",
          asset_class: "equity",
          currency: "USD",
        },
      ],
      updatedInstrument: (id, patch) => ({
        id,
        isin: "US912828YV68",
        name: "UST 4.125 11/15/27",
        asset_class: patch.asset_class as string,
        currency: "USD",
      }),
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const result = await importBrokerOrders("interactive-brokers", "CTO", [bondBuyRow()]);

    expect(result.ok).toBe(true);
    expect(sb.updates).toHaveLength(1);
    expect(sb.updates[0]!.id).toBe("inst-bond-1");
    expect(sb.updates[0]!.patch.asset_class).toBe("bond");
    // No upsert (instrument already cached locally, just patched).
    expect(sb.upserts).toHaveLength(0);
    expect(sb.insertedTx).toHaveLength(1);
    expect(sb.insertedTx[0]!.instrument_id).toBe("inst-bond-1");
  });

  it("does not update when broker asset_class matches the cached one (equity/etf no-op)", async () => {
    lookupIsinMock.mockResolvedValue(null);
    const sb = makeSupabase({
      existingInstruments: [
        {
          id: "inst-amzn",
          isin: "US0231351067",
          name: "AMAZON.COM INC",
          asset_class: "equity",
          currency: "USD",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const equityRow: ParsedRow = {
      ...bondBuyRow({
        isin: "US0231351067",
        assetClass: "equity",
        name: "AMAZON.COM INC",
        description: "AMAZON.COM INC",
        symbol: "AMZN",
        quantity: 10,
        price: 200,
        grossAmount: 2000,
        totalAmount: 2001,
        fees: 1,
        externalId: "exec-amzn",
        tradeId: "trade-amzn",
      }),
    };

    const result = await importBrokerOrders("interactive-brokers", "CTO", [equityRow]);
    expect(result.ok).toBe(true);
    expect(sb.updates).toHaveLength(0);
    expect(sb.upserts).toHaveLength(0);
    expect(sb.insertedTx).toHaveLength(1);
    expect(sb.insertedTx[0]!.instrument_id).toBe("inst-amzn");
  });
});

describe("importBrokerOrders — bond metadata persistence", () => {
  it("persists bond metadata when creating a new bond instrument", async () => {
    lookupIsinMock.mockResolvedValue(null);
    const sb = makeSupabase({
      existingInstruments: [],
      insertedInstrument: (payload) => ({
        id: "inst-bond-1",
        isin: payload.isin as string,
        name: payload.name as string,
        asset_class: payload.asset_class as string,
        currency: payload.currency as string,
        bond_coupon_rate: (payload.bond_coupon_rate as number | null) ?? null,
        bond_maturity_date: (payload.bond_maturity_date as string | null) ?? null,
        bond_coupon_frequency: (payload.bond_coupon_frequency as number | null) ?? null,
      }),
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const row = bondBuyRow({
      bondMetadata: { couponRate: 4.125, maturityDate: "2027-11-15", frequency: 2 },
    });

    const result = await importBrokerOrders("interactive-brokers", "CTO", [row]);
    expect(result.ok).toBe(true);
    expect(sb.upserts).toHaveLength(1);
    expect(sb.upserts[0]!.payload.bond_coupon_rate).toBe(4.125);
    expect(sb.upserts[0]!.payload.bond_maturity_date).toBe("2027-11-15");
    expect(sb.upserts[0]!.payload.bond_coupon_frequency).toBe(2);
  });

  it("fills bond_* columns on a cached bond instrument when they are NULL", async () => {
    lookupIsinMock.mockResolvedValue(null);
    const sb = makeSupabase({
      existingInstruments: [
        {
          id: "inst-bond-1",
          isin: "US912828YV68",
          name: "UST 4.125 11/15/27",
          asset_class: "bond",
          currency: "USD",
          bond_coupon_rate: null,
          bond_maturity_date: null,
          bond_coupon_frequency: null,
        },
      ],
      updatedInstrument: (id, patch) => ({
        id,
        isin: "US912828YV68",
        name: "UST 4.125 11/15/27",
        asset_class: "bond",
        currency: "USD",
        bond_coupon_rate: (patch.bond_coupon_rate as number | null) ?? null,
        bond_maturity_date: (patch.bond_maturity_date as string | null) ?? null,
        bond_coupon_frequency: (patch.bond_coupon_frequency as number | null) ?? null,
      }),
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const row = bondBuyRow({
      bondMetadata: { couponRate: 4.125, maturityDate: "2027-11-15", frequency: 2 },
    });

    const result = await importBrokerOrders("interactive-brokers", "CTO", [row]);
    expect(result.ok).toBe(true);
    expect(sb.updates).toHaveLength(1);
    expect(sb.updates[0]!.patch.bond_coupon_rate).toBe(4.125);
    expect(sb.updates[0]!.patch.bond_maturity_date).toBe("2027-11-15");
    expect(sb.updates[0]!.patch.bond_coupon_frequency).toBe(2);
    expect(sb.upserts).toHaveLength(0);
  });

  it("writes preferred_mic/preferred_currency on the insert payload when broker pair is complete", async () => {
    lookupIsinMock.mockResolvedValue(null);
    const sb = makeSupabase({
      existingInstruments: [],
      insertedInstrument: (payload) => ({
        id: "inst-dbk",
        isin: payload.isin as string,
        name: payload.name as string,
        asset_class: payload.asset_class as string,
        currency: payload.currency as string,
        preferred_mic: (payload.preferred_mic as string | null) ?? null,
        preferred_currency: (payload.preferred_currency as string | null) ?? null,
      }),
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const row = bondBuyRow({
      isin: "DE0005140008",
      assetClass: "equity",
      name: "DEUTSCHE BANK AG",
      description: "DEUTSCHE BANK AG",
      symbol: "DBK",
      quantity: 5,
      price: 10,
      grossAmount: 50,
      totalAmount: 51,
      currency: "EUR",
      fees: 1,
      fxRate: 1,
      externalId: "exec-dbk",
      tradeId: null,
      bondMetadata: undefined,
      preferredMic: "XETR",
      preferredCurrency: "EUR",
    });

    const result = await importBrokerOrders("interactive-brokers", "CTO", [row]);
    expect(result.ok).toBe(true);
    expect(sb.upserts).toHaveLength(1);
    expect(sb.upserts[0]!.payload.preferred_mic).toBe("XETR");
    expect(sb.upserts[0]!.payload.preferred_currency).toBe("EUR");
  });

  it("fills preferred_mic/preferred_currency on a cached instrument when both are NULL", async () => {
    lookupIsinMock.mockResolvedValue(null);
    const sb = makeSupabase({
      existingInstruments: [
        {
          id: "inst-dbk",
          isin: "DE0005140008",
          name: "DEUTSCHE BANK AG",
          asset_class: "equity",
          currency: "EUR",
          preferred_mic: null,
          preferred_currency: null,
        },
      ],
      updatedInstrument: (id, patch) => ({
        id,
        isin: "DE0005140008",
        name: "DEUTSCHE BANK AG",
        asset_class: "equity",
        currency: "EUR",
        preferred_mic: (patch.preferred_mic as string | null) ?? null,
        preferred_currency: (patch.preferred_currency as string | null) ?? null,
      }),
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const row = bondBuyRow({
      isin: "DE0005140008",
      assetClass: "equity",
      name: "DEUTSCHE BANK AG",
      description: "DEUTSCHE BANK AG",
      symbol: "DBK",
      quantity: 5,
      price: 10,
      grossAmount: 50,
      totalAmount: 51,
      currency: "EUR",
      fees: 1,
      fxRate: 1,
      externalId: "exec-dbk-cached",
      tradeId: null,
      bondMetadata: undefined,
      preferredMic: "XETR",
      preferredCurrency: "EUR",
    });

    const result = await importBrokerOrders("interactive-brokers", "CTO", [row]);
    expect(result.ok).toBe(true);
    expect(sb.updates).toHaveLength(1);
    expect(sb.updates[0]!.patch.preferred_mic).toBe("XETR");
    expect(sb.updates[0]!.patch.preferred_currency).toBe("EUR");
    expect(sb.upserts).toHaveLength(0);
  });

  it("does not overwrite preferred_mic when it is already set on the cached instrument", async () => {
    lookupIsinMock.mockResolvedValue(null);
    const sb = makeSupabase({
      existingInstruments: [
        {
          id: "inst-dbk",
          isin: "DE0005140008",
          name: "DEUTSCHE BANK AG",
          asset_class: "equity",
          currency: "EUR",
          preferred_mic: "XETR",
          preferred_currency: "EUR",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const row = bondBuyRow({
      isin: "DE0005140008",
      assetClass: "equity",
      name: "DEUTSCHE BANK AG",
      description: "DEUTSCHE BANK AG",
      symbol: "DBK",
      quantity: 5,
      price: 10,
      grossAmount: 50,
      totalAmount: 51,
      currency: "EUR",
      fees: 1,
      fxRate: 1,
      externalId: "exec-dbk-preset",
      tradeId: null,
      bondMetadata: undefined,
      preferredMic: "XPAR",
      preferredCurrency: "EUR",
    });

    const result = await importBrokerOrders("interactive-brokers", "CTO", [row]);
    expect(result.ok).toBe(true);
    expect(sb.updates).toHaveLength(0);
    expect(sb.upserts).toHaveLength(0);
    expect(sb.insertedTx).toHaveLength(1);
  });

  it("ignores an incomplete preferred pair (mic-only) when creating an instrument", async () => {
    lookupIsinMock.mockResolvedValue(null);
    const sb = makeSupabase({
      existingInstruments: [],
      insertedInstrument: (payload) => ({
        id: "inst-amzn",
        isin: payload.isin as string,
        name: payload.name as string,
        asset_class: payload.asset_class as string,
        currency: payload.currency as string,
        preferred_mic: (payload.preferred_mic as string | null) ?? null,
        preferred_currency: (payload.preferred_currency as string | null) ?? null,
      }),
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const row = bondBuyRow({
      isin: "US0231351067",
      assetClass: "equity",
      name: "AMAZON.COM INC",
      description: "AMAZON.COM INC",
      symbol: "AMZN",
      quantity: 1,
      price: 200,
      grossAmount: 200,
      totalAmount: 201,
      currency: "USD",
      fees: 1,
      fxRate: 0.92,
      externalId: "exec-amzn-incomplete",
      tradeId: null,
      bondMetadata: undefined,
      preferredMic: "XNAS",
      preferredCurrency: null,
    });

    const result = await importBrokerOrders("interactive-brokers", "CTO", [row]);
    expect(result.ok).toBe(true);
    expect(sb.upserts).toHaveLength(1);
    expect(sb.upserts[0]!.payload.preferred_mic).toBeUndefined();
    expect(sb.upserts[0]!.payload.preferred_currency).toBeUndefined();
  });

  it("does not overwrite bond_* columns that are already set on the cached instrument", async () => {
    lookupIsinMock.mockResolvedValue(null);
    const sb = makeSupabase({
      existingInstruments: [
        {
          id: "inst-bond-1",
          isin: "US912828YV68",
          name: "UST 4.125 11/15/27",
          asset_class: "bond",
          currency: "USD",
          bond_coupon_rate: 5.5,
          bond_maturity_date: "2099-01-01",
          bond_coupon_frequency: 4,
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const row = bondBuyRow({
      bondMetadata: { couponRate: 4.125, maturityDate: "2027-11-15", frequency: 2 },
    });

    const result = await importBrokerOrders("interactive-brokers", "CTO", [row]);
    expect(result.ok).toBe(true);
    expect(sb.updates).toHaveLength(0);
    expect(sb.upserts).toHaveLength(0);
    expect(sb.insertedTx).toHaveLength(1);
  });
});

function cryptoBuyRow(overrides: Partial<ParsedRow> = {}): ParsedRow {
  return {
    rawLine: 1,
    date: "2024-03-12",
    kind: "buy",
    isin: null,
    description: "Buy",
    quantity: 0.5,
    totalAmount: 30100,
    grossAmount: 30000,
    price: 60000,
    needsAttention: false,
    symbol: "BTC",
    name: "BTC",
    currency: "EUR",
    fees: 100,
    fxRate: 1,
    broker: "Coinbase",
    assetClass: "crypto",
    ...overrides,
  };
}

describe("importBrokerOrders — crypto without ISIN", () => {
  it("imports a crypto buy row without ISIN, resolves the instrument via CoinGecko and skips OpenFIGI", async () => {
    cgSearchListings.mockResolvedValue([
      {
        mic: "CRYPTO",
        currency: "EUR",
        exchangeName: "COINGECKO",
        providerSymbol: "bitcoin",
        country: "",
        previousClose: null,
      },
    ]);
    const sb = makeSupabase({
      existingInstruments: [],
      insertedCryptoInstrument: (payload) => ({
        id: "inst-btc",
        isin: null,
        symbol: payload.symbol as string,
        name: payload.name as string,
        asset_class: payload.asset_class as string,
        currency: payload.currency as string,
      }),
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const result = await importBrokerOrders("coinbase", "CRYPTO", [cryptoBuyRow()]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inserted).toBe(1);
    expect(lookupIsinMock).not.toHaveBeenCalled();
    expect(cgSearchListings).toHaveBeenCalledWith("BTC");

    // Instrument creation went via .insert (crypto path), not .upsert.
    expect(sb.cryptoInserts).toHaveLength(1);
    expect(sb.upserts).toHaveLength(0);
    expect(sb.cryptoInserts[0]!.payload).toMatchObject({
      isin: null,
      symbol: "BTC",
      asset_class: "crypto",
      currency: "EUR",
      provider: "coingecko",
      provider_symbol: "bitcoin",
      preferred_currency: "EUR",
      preferred_mic: null,
    });

    expect(sb.insertedTx).toHaveLength(1);
    expect(sb.insertedTx[0]!.instrument_id).toBe("inst-btc");
  });

  it("reuses an existing crypto instrument keyed on (symbol, asset_class=crypto) without calling CoinGecko", async () => {
    const sb = makeSupabase({
      existingInstruments: [
        {
          id: "inst-eth",
          isin: null,
          symbol: "ETH",
          name: "ETH",
          asset_class: "crypto",
          currency: "EUR",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const result = await importBrokerOrders("coinbase", "CRYPTO", [
      cryptoBuyRow({ symbol: "ETH", name: "ETH" }),
    ]);

    expect(result.ok).toBe(true);
    expect(cgSearchListings).not.toHaveBeenCalled();
    expect(sb.cryptoInserts).toHaveLength(0);
    expect(sb.insertedTx).toHaveLength(1);
    expect(sb.insertedTx[0]!.instrument_id).toBe("inst-eth");
  });

  it("propagates convert_pair_id from both legs of a Coinbase Convert", async () => {
    cgSearchListings.mockImplementation(async (sym: string) => [
      {
        mic: "CRYPTO",
        currency: "EUR",
        exchangeName: "COINGECKO",
        providerSymbol: sym === "BTC" ? "bitcoin" : "ethereum",
        country: "",
        previousClose: null,
      },
    ]);
    let nextId = 1;
    const sb = makeSupabase({
      existingInstruments: [],
      insertedCryptoInstrument: (payload) => ({
        id: `inst-${(payload.symbol as string).toLowerCase()}-${nextId++}`,
        isin: null,
        symbol: payload.symbol as string,
        name: payload.name as string,
        asset_class: payload.asset_class as string,
        currency: payload.currency as string,
      }),
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const pairId = "11111111-2222-3333-4444-555555555555";
    const result = await importBrokerOrders("coinbase", "CRYPTO", [
      cryptoBuyRow({
        rawLine: 1,
        kind: "sell",
        symbol: "BTC",
        name: "BTC",
        convertPairId: pairId,
      }),
      cryptoBuyRow({
        rawLine: 2,
        kind: "buy",
        symbol: "ETH",
        name: "ETH",
        quantity: 1.5,
        price: 4000,
        grossAmount: 6000,
        totalAmount: 6000,
        fees: 0,
        convertPairId: pairId,
      }),
    ]);

    expect(result.ok).toBe(true);
    expect(sb.insertedTx).toHaveLength(2);
    expect(sb.insertedTx[0]!.convert_pair_id).toBe(pairId);
    expect(sb.insertedTx[1]!.convert_pair_id).toBe(pairId);
  });

  it("fails the row when CoinGecko has no match for the crypto symbol", async () => {
    cgSearchListings.mockResolvedValue([]);
    const sb = makeSupabase({ existingInstruments: [] });
    createClientMock.mockResolvedValue(sb.client as never);

    const result = await importBrokerOrders("coinbase", "CRYPTO", [
      cryptoBuyRow({ symbol: "MYSTERYCOIN", name: "MYSTERYCOIN" }),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inserted).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.reason).toMatch(/CoinGecko/);
    expect(sb.insertedTx).toHaveLength(0);
  });

  it("rejects a non-crypto buy without ISIN", async () => {
    const sb = makeSupabase({ existingInstruments: [] });
    createClientMock.mockResolvedValue(sb.client as never);

    const equityRow: ParsedRow = {
      rawLine: 1,
      date: "2024-03-12",
      kind: "buy",
      isin: null,
      description: "Mystery equity",
      quantity: 1,
      totalAmount: 100,
      grossAmount: 100,
      price: 100,
      needsAttention: false,
      symbol: "X",
      currency: "EUR",
      broker: "Bourse Direct",
      assetClass: "equity",
    };

    const result = await importBrokerOrders("bourse-direct", "CTO", [equityRow]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inserted).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.reason).toMatch(/ISIN obligatoire/);
    expect(cgSearchListings).not.toHaveBeenCalled();
  });
});
