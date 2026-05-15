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

vi.mock("@/features/accounts/active", () => ({
  getActiveAccount: vi.fn(async () => "acc-1"),
  resolveWritableAccountId: vi.fn(async (override?: string | null) =>
    override
      ? { ok: true as const, accountId: override }
      : { ok: true as const, accountId: "acc-1" },
  ),
}));

import { lookupIsin } from "@/lib/openfigi";
import { createClient } from "@/lib/supabase/server";

import type { ParsedRow } from "../brokers/types";

import { importBrokerOrders } from "./actions";

type InstrumentRow = {
  id: string;
  isin: string;
  name: string;
  asset_class: string;
  currency: string;
  bond_coupon_rate?: number | null;
  bond_maturity_date?: string | null;
  bond_coupon_frequency?: number | null;
  preferred_mic?: string | null;
  preferred_currency?: string | null;
};

type UpsertCall = { payload: Record<string, unknown>; opts: unknown };
type UpdateCall = { id: string; patch: Record<string, unknown> };
type InsertedTx = Record<string, unknown>;

function makeSupabase(opts: {
  existingInstruments?: InstrumentRow[];
  insertedInstrument?: (payload: Record<string, unknown>) => InstrumentRow | null;
  updatedInstrument?: (id: string, patch: Record<string, unknown>) => InstrumentRow | null;
}) {
  const upserts: UpsertCall[] = [];
  const updates: UpdateCall[] = [];
  const insertedTx: InsertedTx[] = [];
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
            in: async (_col: string, isins: string[]) => ({
              data: existing.filter((e) => isins.includes(e.isin)),
              error: null,
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
        return {
          select: (_cols: string) => ({
            // dedup window read: .eq("account_id", x).gte(...).lte(...)
            eq: () => ({
              gte: () => ({
                lte: async () => ({ data: [], error: null }),
              }),
              // priorTx read: .eq("user_id").eq("account_id").eq("support").in("kind").in("instrument_id")
              eq: () => ({
                eq: () => ({
                  in: () => ({
                    in: async () => ({ data: [], error: null }),
                  }),
                }),
              }),
            }),
          }),
          insert: async (chunk: InsertedTx[]) => {
            for (const row of chunk) insertedTx.push(row);
            return { error: null };
          },
        };
      }
      return {};
    }),
  };

  return { client, upserts, updates, insertedTx, getExisting: () => existing };
}

const createClientMock = vi.mocked(createClient);
const lookupIsinMock = vi.mocked(lookupIsin);

beforeEach(() => {
  createClientMock.mockReset();
  lookupIsinMock.mockReset();
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
