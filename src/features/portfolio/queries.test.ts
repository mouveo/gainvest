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

type InstrumentJoin = {
  id: string;
  isin: string | null;
  symbol: string | null;
  name: string;
  asset_class: string;
  currency: string;
  preferred_mic: string | null;
  preferred_currency: string | null;
  bond_coupon_rate: number | null;
  bond_maturity_date: string | null;
  bond_coupon_frequency: number | null;
};

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
  convert_pair_id: string | null;
  instrument: InstrumentJoin | null;
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
    convert_pair_id: null,
    instrument: null,
    ...overrides,
  };
}

function cryptoInstrument(overrides: Partial<InstrumentJoin> = {}): InstrumentJoin {
  return {
    id: "inst-btc",
    isin: null,
    symbol: "BTC",
    name: "BTC",
    asset_class: "crypto",
    currency: "EUR",
    preferred_mic: null,
    preferred_currency: "EUR",
    bond_coupon_rate: null,
    bond_maturity_date: null,
    bond_coupon_frequency: null,
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

  it("surfaces convert_pair_id from the transactions row", async () => {
    const pairId = "11111111-2222-3333-4444-555555555555";
    const sb = makeSupabase([
      row("ALL-aaaa-001", {
        kind: "buy",
        quantity: 1,
        price: 50000,
        gross_amount: 50000,
        broker: "Coinbase",
        support: "CRYPTO",
        convert_pair_id: pairId,
        instrument: cryptoInstrument(),
      }),
    ]);
    createClientMock.mockResolvedValue(sb as never);
    getActiveAccountMock.mockResolvedValue("ALL");

    const orders = await getOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0]!.convertPairId).toBe(pairId);
  });

  it("surfaces instrumentSymbol from the joined instruments row", async () => {
    const sb = makeSupabase([
      row("ALL-aaaa-001", {
        kind: "buy",
        quantity: 1,
        price: 50000,
        gross_amount: 50000,
        broker: "Coinbase",
        support: "CRYPTO",
        instrument: cryptoInstrument({ symbol: "ETH", name: "Ethereum", id: "inst-eth" }),
      }),
    ]);
    createClientMock.mockResolvedValue(sb as never);
    getActiveAccountMock.mockResolvedValue("ALL");

    const orders = await getOrders();
    expect(orders[0]!.instrumentSymbol).toBe("ETH");
    expect(orders[0]!.instrumentId).toBe("inst-eth");
  });

  it("accepts crypto rows without ISIN (empty isin string surfaces, symbol carries identity)", async () => {
    const sb = makeSupabase([
      row("ALL-aaaa-001", {
        kind: "buy",
        quantity: 1,
        price: 50000,
        gross_amount: 50000,
        broker: "Coinbase",
        support: "CRYPTO",
        instrument: cryptoInstrument({ isin: null }),
      }),
    ]);
    createClientMock.mockResolvedValue(sb as never);
    getActiveAccountMock.mockResolvedValue("ALL");

    const orders = await getOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0]!.isin).toBe("");
    expect(orders[0]!.instrumentSymbol).toBe("BTC");
    expect(orders[0]!.instrumentId).toBe("inst-btc");
    expect(orders[0]!.assetClass).toBe("crypto");
  });
});
