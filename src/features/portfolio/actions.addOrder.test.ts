import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

import { addOrder } from "./actions";

type Insert = Record<string, unknown>;

type FxRow = { currency: string; eur_rate: number };

function makeSupabase(opts: {
  user?: { id: string } | null;
  fxRates?: FxRow[];
  instrumentId?: string;
  accountId?: string;
}) {
  const inserts: { table: string; payload: Insert | Insert[] }[] = [];
  const upserts: { table: string; payload: Insert; opts: unknown }[] = [];
  const user = opts.user === undefined ? { id: "u1" } : opts.user;
  const fx = opts.fxRates ?? [{ currency: "USD", eur_rate: 0.92 }];
  const instrumentId = opts.instrumentId ?? "inst-1";
  const accountId = opts.accountId ?? "acc-1";

  const client = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user } })),
    },
    from: vi.fn((table: string) => {
      if (table === "accounts") {
        return {
          select: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: { id: accountId }, error: null })),
              })),
            })),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { id: accountId }, error: null })),
            })),
          })),
        };
      }
      if (table === "fx_rates") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, val: string) => ({
              maybeSingle: vi.fn(async () => {
                const row = fx.find((r) => r.currency === val);
                return { data: row ?? null, error: null };
              }),
            })),
          })),
        };
      }
      if (table === "instruments") {
        return {
          upsert: vi.fn((payload: Insert, opts: unknown) => {
            upserts.push({ table, payload, opts });
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { id: instrumentId },
                  error: null,
                })),
              })),
            };
          }),
        };
      }
      if (table === "transactions") {
        return {
          insert: vi.fn(async (payload: Insert) => {
            inserts.push({ table, payload });
            return { error: null };
          }),
        };
      }
      return {};
    }),
  };

  return { client, inserts, upserts };
}

const createClientMock = vi.mocked(createClient);

beforeEach(() => {
  createClientMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function form(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.append(k, v);
  return fd;
}

describe("addOrder — buy/sell validation (unchanged)", () => {
  it("rejects buy with invalid ISIN", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    const r = await addOrder(
      form({
        kind: "buy",
        isin: "BAD",
        name: "Test",
        quantity: "10",
        price: "100",
        trade_date: "2025-01-01",
        broker: "Bourse Direct",
        support: "CTO",
        currency: "EUR",
        asset_class: "etf",
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ISIN/i);
  });

  it("rejects buy with quantity <= 0", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    const r = await addOrder(
      form({
        kind: "buy",
        isin: "FR0010315770",
        name: "Test",
        quantity: "0",
        price: "100",
        trade_date: "2025-01-01",
        broker: "Bourse Direct",
        support: "CTO",
        currency: "EUR",
        asset_class: "etf",
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/quantité/i);
  });

  it("accepts a valid buy with EUR currency and inserts the transaction", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    const r = await addOrder(
      form({
        kind: "buy",
        isin: "FR0010315770",
        name: "Lyxor",
        quantity: "10",
        price: "100",
        gross_amount: "1000",
        fees: "5",
        trade_date: "2025-01-01",
        broker: "Bourse Direct",
        support: "CTO",
        currency: "EUR",
        asset_class: "etf",
      }),
    );
    expect(r.ok).toBe(true);
    expect(sb.inserts).toHaveLength(1);
    const ins = sb.inserts[0]!.payload as Record<string, unknown>;
    expect(ins.kind).toBe("buy");
    expect(ins.instrument_id).toBe("inst-1");
    expect(ins.fx_rate).toBe(1);
    expect(ins.currency).toBe("EUR");
  });
});

describe("addOrder — cash kinds", () => {
  it("accepts a deposit without ISIN/quantity/price", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    const r = await addOrder(
      form({
        kind: "deposit",
        gross_amount: "1000",
        trade_date: "2025-01-01",
        broker: "Bourse Direct",
        support: "CTO",
        currency: "EUR",
      }),
    );
    expect(r.ok).toBe(true);
    expect(sb.upserts).toHaveLength(0); // no instrument upsert for cash
    expect(sb.inserts).toHaveLength(1);
    const ins = sb.inserts[0]!.payload as Record<string, unknown>;
    expect(ins.kind).toBe("deposit");
    expect(ins.instrument_id).toBeNull();
    expect(ins.quantity).toBeNull();
    expect(ins.price).toBeNull();
    expect(ins.fx_rate).toBe(1);
    expect(ins.gross_amount).toBe(1000);
  });

  it("rejects a cash flow without broker", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    const r = await addOrder(
      form({
        kind: "deposit",
        gross_amount: "1000",
        trade_date: "2025-01-01",
        broker: "",
        support: "CTO",
        currency: "EUR",
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/opérateur/i);
  });

  it("rejects a cash flow with grossAmount <= 0", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    const r = await addOrder(
      form({
        kind: "interest",
        gross_amount: "0",
        trade_date: "2025-01-01",
        broker: "Bourse Direct",
        support: "CTO",
        currency: "EUR",
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/montant/i);
  });

  it("accepts a non-EUR cash flow when the FX rate is cached", async () => {
    const sb = makeSupabase({ fxRates: [{ currency: "USD", eur_rate: 0.92 }] });
    createClientMock.mockResolvedValue(sb.client as never);
    const r = await addOrder(
      form({
        kind: "deposit",
        gross_amount: "1000",
        trade_date: "2025-01-01",
        broker: "Interactive Brokers",
        support: "CTO",
        currency: "USD",
      }),
    );
    expect(r.ok).toBe(true);
    const ins = sb.inserts[0]!.payload as Record<string, unknown>;
    expect(ins.currency).toBe("USD");
    expect(ins.fx_rate).toBeCloseTo(0.92, 8);
  });

  it("rejects a non-EUR cash flow when the FX rate is missing", async () => {
    const sb = makeSupabase({ fxRates: [] });
    createClientMock.mockResolvedValue(sb.client as never);
    const r = await addOrder(
      form({
        kind: "deposit",
        gross_amount: "1000",
        trade_date: "2025-01-01",
        broker: "Interactive Brokers",
        support: "CTO",
        currency: "GBP",
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/GBP/);
    expect(sb.inserts).toHaveLength(0);
  });
});
