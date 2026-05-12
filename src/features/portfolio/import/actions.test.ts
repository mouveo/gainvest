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
            gte: () => ({
              lte: async () => ({ data: [], error: null }),
            }),
            eq: () => ({
              eq: () => ({
                in: () => ({
                  in: async () => ({ data: [], error: null }),
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
