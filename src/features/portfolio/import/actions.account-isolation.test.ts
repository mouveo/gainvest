import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/openfigi", () => ({
  lookupIsin: vi.fn(async () => null),
}));

vi.mock("@/features/accounts/active", () => ({
  getActiveAccount: vi.fn(),
  resolveWritableAccountId: vi.fn(),
}));

import { getActiveAccount, resolveWritableAccountId } from "@/features/accounts/active";
import { createClient } from "@/lib/supabase/server";

import type { ParsedRow } from "../brokers/types";

import { importBrokerOrders } from "./actions";

const ACC_PERSO = "acc-perso";
const ACC_SOCIETE = "acc-societe";

type TxRow = {
  account_id: string;
  instrument_id: string | null;
  trade_date: string;
  kind: string;
  quantity: number | null;
  gross_amount: number;
  support: string;
  external_id?: string | null;
};

type PriorTx = {
  account_id: string;
  instrument_id: string;
  kind: "buy" | "sell";
  quantity: number;
  trade_date: string;
  support: string;
};

function makeSupabase(opts: {
  existingTx?: TxRow[];
  priorTx?: PriorTx[];
}) {
  const insertedTx: Record<string, unknown>[] = [];
  const existingTx = opts.existingTx ?? [];
  const priorTx = opts.priorTx ?? [];

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })),
    },
    from: vi.fn((table: string) => {
      if (table === "instruments") {
        return {
          select: () => ({
            in: async (_col: string, isins: string[]) => ({
              data: isins.map((isin, i) => ({
                id: `inst-${i + 1}`,
                isin,
                name: `Inst ${isin}`,
                asset_class: "equity",
                currency: "EUR",
                bond_coupon_rate: null,
                bond_maturity_date: null,
                bond_coupon_frequency: null,
                preferred_mic: null,
                preferred_currency: null,
              })),
              error: null,
            }),
          }),
          upsert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: { message: "no row" } }),
            }),
          }),
        };
      }
      if (table === "transactions") {
        const filters: { accountId?: string } = {};
        const builder = {
          select: () => builder,
          // dedup window read: .eq("account_id", x).gte(...).lte(...)
          eq: (col: string, val: string) => {
            if (col === "account_id") filters.accountId = val;
            return {
              gte: () => ({
                lte: async () => ({
                  data: existingTx.filter((r) => r.account_id === filters.accountId),
                  error: null,
                }),
              }),
              // priorTx chain when we add eq(user_id).eq(account_id).eq(support).in(kind).in(instId)
              eq: (col2: string, val2: string) => {
                if (col2 === "account_id") filters.accountId = val2;
                return {
                  eq: () => ({
                    in: () => ({
                      in: async () => ({
                        data: priorTx.filter(
                          (r) => r.account_id === filters.accountId,
                        ),
                        error: null,
                      }),
                    }),
                  }),
                };
              },
            };
          },
          insert: async (chunk: Record<string, unknown>[]) => {
            for (const row of chunk) insertedTx.push(row);
            return { error: null };
          },
        };
        return builder;
      }
      return {};
    }),
    insertedTx,
  };
}

const createClientMock = vi.mocked(createClient);
const getActiveAccountMock = vi.mocked(getActiveAccount);
const resolveMock = vi.mocked(resolveWritableAccountId);

function buyRow(overrides: Partial<ParsedRow> = {}): ParsedRow {
  return {
    rawLine: 1,
    date: "2024-06-01",
    kind: "buy",
    isin: "FR0010655712",
    description: "Test",
    quantity: 10,
    totalAmount: 1000,
    grossAmount: 1000,
    price: 100,
    needsAttention: false,
    externalId: null,
    symbol: "TST",
    name: "Test",
    currency: "EUR",
    fees: 0,
    fxRate: 1,
    broker: "Bourse Direct",
    assetClass: "equity",
    tradeId: null,
    ...overrides,
  };
}

beforeEach(() => {
  createClientMock.mockReset();
  getActiveAccountMock.mockReset();
  resolveMock.mockReset();
});

describe("importBrokerOrders — account isolation", () => {
  it("does not dedupe against a same-key transaction sitting in another account", async () => {
    // Existing tx in ACC_SOCIETE with the same synthetic key — must NOT block
    // an import targeting ACC_PERSO.
    const sb = makeSupabase({
      existingTx: [
        {
          account_id: ACC_SOCIETE,
          instrument_id: "inst-1",
          trade_date: "2024-06-01",
          kind: "buy",
          quantity: 10,
          gross_amount: 1000,
          support: "CTO",
          external_id: null,
        },
      ],
    });
    createClientMock.mockResolvedValue(sb as never);
    getActiveAccountMock.mockResolvedValue(ACC_PERSO);
    resolveMock.mockResolvedValue({ ok: true, accountId: ACC_PERSO });

    const result = await importBrokerOrders("bourse-direct", "CTO", [buyRow()]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(sb.insertedTx[0]?.account_id).toBe(ACC_PERSO);
  });

  it("ignores prior holdings from another account when inferring liquidation quantity", async () => {
    // Liquidation row needs a positive stock at the trade date. A buy sitting
    // in ACC_SOCIETE must NOT count toward the stock when we import into
    // ACC_PERSO — the row should be flagged as "needsAttention".
    const sb = makeSupabase({
      priorTx: [
        {
          account_id: ACC_SOCIETE,
          instrument_id: "inst-1",
          kind: "buy",
          quantity: 5,
          trade_date: "2024-01-01",
          support: "CTO",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb as never);
    getActiveAccountMock.mockResolvedValue(ACC_PERSO);
    resolveMock.mockResolvedValue({ ok: true, accountId: ACC_PERSO });

    const liq = buyRow({
      kind: "sell",
      inferQtyFromHoldings: true,
      quantity: null,
      grossAmount: 600,
    });

    const result = await importBrokerOrders("bourse-direct", "CTO", [liq]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inserted).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.reason).toMatch(/liquidation/i);
  });

  it("refuses to run when ALL is active without an explicit override", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb as never);
    getActiveAccountMock.mockResolvedValue("ALL");
    resolveMock.mockResolvedValue({
      ok: false,
      error: "Sélectionne un compte spécifique avant d'écrire.",
    });

    const result = await importBrokerOrders("bourse-direct", "CTO", [buyRow()]);
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("compte spécifique"),
    });
  });
});
