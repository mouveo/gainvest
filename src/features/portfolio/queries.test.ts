import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/features/accounts/active", () => ({
  getActiveAccount: vi.fn(),
}));

import { getActiveAccount } from "@/features/accounts/active";
import { createClient } from "@/lib/supabase/server";

import { getOrders } from "./queries";

const ACC_PERSO = "11111111-1111-1111-1111-111111111111";

type TxRow = {
  id: string;
  kind: string;
  trade_date: string;
  trade_time: string | null;
  quantity: number | null;
  price: number | null;
  gross_amount: number;
  fees: number;
  tax: number;
  fx_rate: number;
  notes: string | null;
  currency: string;
  execution_venue: string | null;
  broker: string | null;
  support: string;
  instrument: null;
};

function row(id: string, overrides: Partial<TxRow> = {}): TxRow {
  return {
    id,
    kind: "deposit",
    trade_date: "2024-01-01",
    trade_time: null,
    quantity: null,
    price: null,
    gross_amount: 100,
    fees: 0,
    tax: 0,
    fx_rate: 1,
    notes: null,
    currency: "EUR",
    execution_venue: null,
    broker: "Manual",
    support: "CTO",
    instrument: null,
    ...overrides,
  };
}

function makeSupabase(rows: TxRow[]) {
  const filters: { accountId?: string } = {};
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((col: string, val: string) => {
      if (col === "account_id") filters.accountId = val;
      return builder;
    }),
    order: vi.fn(async () => {
      const data = filters.accountId
        ? rows.filter((r) => r.id.startsWith(filters.accountId!.slice(0, 8)))
        : rows;
      return { data, error: null };
    }),
  };
  return {
    from: vi.fn(() => builder),
    filters,
  };
}

const createClientMock = vi.mocked(createClient);
const getActiveAccountMock = vi.mocked(getActiveAccount);

beforeEach(() => {
  createClientMock.mockReset();
  getActiveAccountMock.mockReset();
});

describe("getOrders", () => {
  it("filters by account_id when a specific account is active", async () => {
    const sb = makeSupabase([
      row("11111111-aaaa-001"),
      row("22222222-bbbb-001"),
    ]);
    createClientMock.mockResolvedValue(sb as never);
    getActiveAccountMock.mockResolvedValue(ACC_PERSO);

    const orders = await getOrders();
    expect(sb.filters.accountId).toBe(ACC_PERSO);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.id).toBe("11111111-aaaa-001");
  });

  it("does not filter when ALL is active", async () => {
    const sb = makeSupabase([
      row("11111111-aaaa-001"),
      row("22222222-bbbb-001"),
    ]);
    createClientMock.mockResolvedValue(sb as never);
    getActiveAccountMock.mockResolvedValue("ALL");

    const orders = await getOrders();
    expect(sb.filters.accountId).toBeUndefined();
    expect(orders).toHaveLength(2);
  });

  it("respects an explicit active scope argument over the cookie", async () => {
    const sb = makeSupabase([
      row("11111111-aaaa-001"),
      row("22222222-bbbb-001"),
    ]);
    createClientMock.mockResolvedValue(sb as never);
    getActiveAccountMock.mockResolvedValue("ALL");

    await getOrders(ACC_PERSO);
    expect(sb.filters.accountId).toBe(ACC_PERSO);
    // getActiveAccount must not be consulted when the caller provides a scope.
    expect(getActiveAccountMock).not.toHaveBeenCalled();
  });
});
