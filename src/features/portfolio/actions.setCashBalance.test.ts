import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/features/accounts/active", () => ({
  getActiveAccount: vi.fn(async () => "acc-1"),
  resolveWritableAccountId: vi.fn(async (override?: string | null) =>
    override
      ? { ok: true as const, accountId: override }
      : { ok: true as const, accountId: "acc-1" },
  ),
}));

import { resolveWritableAccountId } from "@/features/accounts/active";
import { createClient } from "@/lib/supabase/server";

import { setCashBalance } from "./actions";

type Tx = {
  id: string;
  kind: string;
  gross_amount: number;
  fees?: number;
  trade_date: string;
  notes?: string | null;
  support: string;
  broker: string;
  currency: string;
};

type Insert = Record<string, unknown>;
type Update = { id: string; payload: Record<string, unknown> };

function makeSupabase(opts: {
  user?: { id: string } | null;
  fxRates?: { currency: string; eur_rate: number }[];
  txs?: Tx[];
  accountId?: string;
}) {
  const inserts: { table: string; payload: Insert }[] = [];
  const updates: Update[] = [];
  const user = opts.user === undefined ? { id: "u1" } : opts.user;
  const fx = opts.fxRates ?? [];
  const txs = opts.txs ?? [];
  const accountId = opts.accountId ?? "acc-1";
  const txFilters: Record<string, string> = {};

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
      if (table === "transactions") {
        // Chained .eq().eq()...lte() then a final read returns the filtered txs.
        let lteDate: string | null = null;
        const builder: Record<string, unknown> = {
          select: vi.fn(() => builder),
          eq: vi.fn((col: string, val: string) => {
            txFilters[col] = val;
            return builder;
          }),
          lte: vi.fn((_col: string, val: string) => {
            lteDate = val;
            return builder;
          }),
          // The select chain resolves when awaited (via Thenable shape of
          // PostgrestBuilder). Simulate by exposing then() on the last call.
          then: (resolve: (value: { data: Tx[]; error: null }) => void) => {
            const filtered = txs.filter(
              (t) =>
                (!txFilters.user_id || t.kind != null) &&
                (!txFilters.support || t.support === txFilters.support) &&
                (!txFilters.broker || t.broker === txFilters.broker) &&
                (!txFilters.currency || t.currency === txFilters.currency) &&
                (!lteDate || t.trade_date <= lteDate),
            );
            resolve({ data: filtered, error: null });
            return Promise.resolve({ data: filtered, error: null });
          },
        };
        return {
          select: builder.select,
          eq: builder.eq,
          insert: vi.fn(async (payload: Insert) => {
            inserts.push({ table, payload });
            return { error: null };
          }),
          update: vi.fn((payload: Record<string, unknown>) => ({
            eq: vi.fn(async (col: string, id: string) => {
              if (col === "id") updates.push({ id, payload });
              return { error: null };
            }),
          })),
        };
      }
      return {};
    }),
  };

  return { client, inserts, updates, txFilters };
}

const createClientMock = vi.mocked(createClient);

beforeEach(() => {
  createClientMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("setCashBalance", () => {
  it("returns no-op when the gap is below 0.01", async () => {
    const sb = makeSupabase({
      txs: [
        {
          id: "t1",
          kind: "deposit",
          gross_amount: 1000,
          trade_date: "2025-01-01",
          notes: "Solde initial — saisie manuelle",
          support: "CTO",
          broker: "Bourse Direct",
          currency: "EUR",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const r = await setCashBalance({
      support: "CTO",
      broker: "Bourse Direct",
      currency: "EUR",
      amount: 1000.005,
      atDate: "2025-12-31",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action).toBe("noop");
    expect(sb.inserts).toHaveLength(0);
    expect(sb.updates).toHaveLength(0);
  });

  it("inserts a manual initial deposit when no previous calibration exists", async () => {
    const sb = makeSupabase({
      txs: [
        {
          id: "buy1",
          kind: "buy",
          gross_amount: 500,
          fees: 5,
          trade_date: "2025-02-01",
          support: "CTO",
          broker: "Bourse Direct",
          currency: "EUR",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const r = await setCashBalance({
      support: "CTO",
      broker: "Bourse Direct",
      currency: "EUR",
      amount: 1000,
      atDate: "2025-12-31",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action).toBe("inserted");
      // Current balance = -505 (buy with fees), target 1000 → gap = 1505
      expect(r.gap).toBeCloseTo(1505, 6);
    }
    expect(sb.inserts).toHaveLength(1);
    const ins = sb.inserts[0]!.payload as Record<string, unknown>;
    expect(ins.kind).toBe("deposit");
    expect(ins.notes).toBe("Solde initial — saisie manuelle");
    expect(ins.gross_amount).toBeCloseTo(1505, 6);
    // Dated one day before the earliest existing flow (2025-02-01).
    expect(ins.trade_date).toBe("2025-01-31");
    expect(ins.broker).toBe("Bourse Direct");
    expect(ins.currency).toBe("EUR");
    expect(ins.fx_rate).toBe(1);
  });

  it("updates the existing manual initial deposit when a positive gap is needed", async () => {
    const sb = makeSupabase({
      txs: [
        {
          id: "init",
          kind: "deposit",
          gross_amount: 1000,
          trade_date: "2024-12-01",
          notes: "Solde initial — saisie manuelle",
          support: "CTO",
          broker: "Bourse Direct",
          currency: "EUR",
        },
        {
          id: "buy1",
          kind: "buy",
          gross_amount: 200,
          trade_date: "2025-02-01",
          support: "CTO",
          broker: "Bourse Direct",
          currency: "EUR",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);

    // Current balance = 1000 - 200 = 800; target 1500 → gap = 700.
    const r = await setCashBalance({
      support: "CTO",
      broker: "Bourse Direct",
      currency: "EUR",
      amount: 1500,
      atDate: "2025-12-31",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action).toBe("updated");
      expect(r.gap).toBeCloseTo(700, 6);
    }
    expect(sb.updates).toHaveLength(1);
    expect(sb.updates[0]!.id).toBe("init");
    expect(sb.updates[0]!.payload.gross_amount).toBeCloseTo(1700, 6);
    expect(sb.inserts).toHaveLength(0);
  });

  it("updates the existing manual initial deposit when a negative gap is needed", async () => {
    const sb = makeSupabase({
      txs: [
        {
          id: "init",
          kind: "deposit",
          gross_amount: 1000,
          trade_date: "2024-12-01",
          notes: "Solde initial — saisie manuelle",
          support: "CTO",
          broker: "Bourse Direct",
          currency: "EUR",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);

    // Current balance = 1000; target 600 → gap = -400.
    const r = await setCashBalance({
      support: "CTO",
      broker: "Bourse Direct",
      currency: "EUR",
      amount: 600,
      atDate: "2025-12-31",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action).toBe("updated");
      expect(r.gap).toBeCloseTo(-400, 6);
    }
    expect(sb.updates[0]!.payload.gross_amount).toBeCloseTo(600, 6);
  });

  it("rejects non-EUR calibration when no FX rate is cached", async () => {
    const sb = makeSupabase({ txs: [], fxRates: [] });
    createClientMock.mockResolvedValue(sb.client as never);
    const r = await setCashBalance({
      support: "CTO",
      broker: "Interactive Brokers",
      currency: "GBP",
      amount: 1000,
      atDate: "2025-12-31",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/GBP/);
  });
});

describe("setCashBalance — account scope", () => {
  it("refuses ALL active without an accountId override", async () => {
    const sb = makeSupabase({ txs: [] });
    createClientMock.mockResolvedValue(sb.client as never);
    vi.mocked(resolveWritableAccountId).mockResolvedValueOnce({
      ok: false,
      error: "Sélectionne un compte spécifique avant d'écrire.",
    });

    const r = await setCashBalance({
      support: "CTO",
      broker: "Bourse Direct",
      currency: "EUR",
      amount: 1000,
      atDate: "2025-12-31",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/compte spécifique/);
    expect(sb.inserts).toHaveLength(0);
  });

  it("scopes the cash replay to the target account", async () => {
    const target = "11111111-1111-1111-1111-111111111111";
    const sb = makeSupabase({
      txs: [
        {
          id: "b1",
          kind: "buy",
          gross_amount: 200,
          fees: 0,
          trade_date: "2025-02-01",
          support: "CTO",
          broker: "Bourse Direct",
          currency: "EUR",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const r = await setCashBalance({
      support: "CTO",
      broker: "Bourse Direct",
      currency: "EUR",
      amount: 1000,
      atDate: "2025-12-31",
      accountId: target,
    });
    expect(r.ok).toBe(true);
    expect(sb.txFilters.account_id).toBe(target);
    expect(sb.inserts).toHaveLength(1);
    const ins = sb.inserts[0]!.payload as Record<string, unknown>;
    expect(ins.account_id).toBe(target);
  });
});
