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

import { resolveWritableAccountId } from "@/features/accounts/active";
import { coingeckoProvider } from "@/lib/quotes";
import { createClient } from "@/lib/supabase/server";

import { addOrder } from "./actions";

type Insert = Record<string, unknown>;

type FxRow = { currency: string; eur_rate: number };

type ExistingInstrument = {
  id: string;
  symbol: string;
  asset_class?: string;
  preferred_mic: string | null;
  preferred_currency: string | null;
};

function makeSupabase(opts: {
  user?: { id: string } | null;
  fxRates?: FxRow[];
  instrumentId?: string;
  accountId?: string;
  existingInstruments?: ExistingInstrument[];
}) {
  const inserts: { table: string; payload: Insert | Insert[] }[] = [];
  const instrumentInserts: { payload: Insert }[] = [];
  const instrumentUpdates: { id: string; patch: Insert }[] = [];
  const user = opts.user === undefined ? { id: "u1" } : opts.user;
  const fx = opts.fxRates ?? [{ currency: "USD", eur_rate: 0.92 }];
  const instrumentId = opts.instrumentId ?? "inst-1";
  const accountId = opts.accountId ?? "acc-1";
  let existing: ExistingInstrument[] = (opts.existingInstruments ?? []).slice();

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
        // Lookup state captures all .eq() and .is() filters so we can resolve
        // both the legacy ETF chain (symbol + mic IS NULL) and the new crypto
        // chain (symbol + asset_class = crypto).
        const lookup: {
          symbol?: string;
          assetClass?: string;
          micIsNull?: boolean;
        } = {};
        const selectBuilder = {
          eq: vi.fn((col: string, val: string) => {
            if (col === "symbol") lookup.symbol = val;
            if (col === "asset_class") lookup.assetClass = val;
            return selectBuilder;
          }),
          is: vi.fn((col: string, val: unknown) => {
            if (col === "mic" && val === null) lookup.micIsNull = true;
            return selectBuilder;
          }),
          maybeSingle: vi.fn(async () => {
            if (!lookup.symbol) return { data: null, error: null };
            const row = existing.find(
              (e) =>
                e.symbol === lookup.symbol &&
                (lookup.assetClass == null || e.asset_class === lookup.assetClass),
            );
            return { data: row ?? null, error: null };
          }),
        };

        return {
          select: vi.fn(() => selectBuilder),
          insert: vi.fn((payload: Insert) => {
            instrumentInserts.push({ payload });
            const inserted: ExistingInstrument = {
              id: instrumentId,
              symbol: String(payload.symbol ?? ""),
              asset_class: payload.asset_class as string | undefined,
              preferred_mic: (payload.preferred_mic as string | undefined) ?? null,
              preferred_currency: (payload.preferred_currency as string | undefined) ?? null,
            };
            existing = [...existing, inserted];
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({ data: { id: instrumentId }, error: null })),
              })),
            };
          }),
          update: vi.fn((patch: Insert) => ({
            eq: vi.fn(async (col: string, id: string) => {
              if (col === "id") {
                instrumentUpdates.push({ id, patch });
                existing = existing.map((e) =>
                  e.id === id
                    ? {
                        ...e,
                        preferred_mic:
                          (patch.preferred_mic as string | undefined) ?? e.preferred_mic,
                        preferred_currency:
                          (patch.preferred_currency as string | undefined) ??
                          e.preferred_currency,
                      }
                    : e,
                );
              }
              return { error: null };
            }),
          })),
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

  return { client, inserts, instrumentInserts, instrumentUpdates };
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
    expect(sb.instrumentInserts).toHaveLength(0); // no instrument insert for cash
    expect(sb.instrumentUpdates).toHaveLength(0);
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

  it("creates a new instrument with the preferred listing when the form supplies a complete pair", async () => {
    const sb = makeSupabase({ existingInstruments: [] });
    createClientMock.mockResolvedValue(sb.client as never);
    const r = await addOrder(
      form({
        kind: "buy",
        isin: "IE00B4L5Y983",
        name: "iShares Core MSCI World",
        quantity: "10",
        price: "100",
        gross_amount: "1000",
        fees: "1",
        trade_date: "2025-01-01",
        broker: "Bourse Direct",
        support: "CTO",
        currency: "EUR",
        asset_class: "etf",
        preferred_mic: "XAMS",
        preferred_currency: "EUR",
      }),
    );
    expect(r.ok).toBe(true);
    expect(sb.instrumentInserts).toHaveLength(1);
    const payload = sb.instrumentInserts[0]!.payload as Record<string, unknown>;
    expect(payload.preferred_mic).toBe("XAMS");
    expect(payload.preferred_currency).toBe("EUR");
    expect(sb.instrumentUpdates).toHaveLength(0);
  });

  it("creates a new instrument without preferred columns when no listing is chosen", async () => {
    const sb = makeSupabase({ existingInstruments: [] });
    createClientMock.mockResolvedValue(sb.client as never);
    const r = await addOrder(
      form({
        kind: "buy",
        isin: "FR0010315770",
        name: "Lyxor",
        quantity: "10",
        price: "100",
        gross_amount: "1000",
        fees: "0",
        trade_date: "2025-01-01",
        broker: "Bourse Direct",
        support: "CTO",
        currency: "EUR",
        asset_class: "etf",
      }),
    );
    expect(r.ok).toBe(true);
    expect(sb.instrumentInserts).toHaveLength(1);
    const payload = sb.instrumentInserts[0]!.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("preferred_mic");
    expect(payload).not.toHaveProperty("preferred_currency");
    expect(sb.instrumentUpdates).toHaveLength(0);
  });

  it("fills the preferred listing on an existing instrument when both columns are NULL", async () => {
    const sb = makeSupabase({
      existingInstruments: [
        {
          id: "inst-existing",
          symbol: "IE00B4L5Y983",
          preferred_mic: null,
          preferred_currency: null,
        },
      ],
      instrumentId: "inst-existing",
    });
    createClientMock.mockResolvedValue(sb.client as never);
    const r = await addOrder(
      form({
        kind: "buy",
        isin: "IE00B4L5Y983",
        name: "iShares Core MSCI World",
        quantity: "10",
        price: "100",
        gross_amount: "1000",
        fees: "0",
        trade_date: "2025-01-01",
        broker: "Bourse Direct",
        support: "CTO",
        currency: "EUR",
        asset_class: "etf",
        preferred_mic: "XAMS",
        preferred_currency: "EUR",
      }),
    );
    expect(r.ok).toBe(true);
    expect(sb.instrumentInserts).toHaveLength(0);
    expect(sb.instrumentUpdates).toHaveLength(1);
    expect(sb.instrumentUpdates[0]!.id).toBe("inst-existing");
    expect(sb.instrumentUpdates[0]!.patch).toEqual({
      preferred_mic: "XAMS",
      preferred_currency: "EUR",
    });
  });

  it("never overwrites a preferred listing already set on the cached instrument", async () => {
    const sb = makeSupabase({
      existingInstruments: [
        {
          id: "inst-locked",
          symbol: "IE00B4L5Y983",
          preferred_mic: "XETR",
          preferred_currency: "EUR",
        },
      ],
      instrumentId: "inst-locked",
    });
    createClientMock.mockResolvedValue(sb.client as never);
    const r = await addOrder(
      form({
        kind: "buy",
        isin: "IE00B4L5Y983",
        name: "iShares Core MSCI World",
        quantity: "10",
        price: "100",
        gross_amount: "1000",
        fees: "0",
        trade_date: "2025-01-01",
        broker: "Bourse Direct",
        support: "CTO",
        currency: "EUR",
        asset_class: "etf",
        preferred_mic: "XAMS",
        preferred_currency: "EUR",
      }),
    );
    expect(r.ok).toBe(true);
    expect(sb.instrumentInserts).toHaveLength(0);
    expect(sb.instrumentUpdates).toHaveLength(0);
    expect(sb.inserts).toHaveLength(1);
  });

  it("ignores an incomplete preferred pair (mic-only) at creation", async () => {
    const sb = makeSupabase({ existingInstruments: [] });
    createClientMock.mockResolvedValue(sb.client as never);
    const r = await addOrder(
      form({
        kind: "buy",
        isin: "IE00B4L5Y983",
        name: "iShares Core MSCI World",
        quantity: "10",
        price: "100",
        gross_amount: "1000",
        fees: "0",
        trade_date: "2025-01-01",
        broker: "Bourse Direct",
        support: "CTO",
        currency: "EUR",
        asset_class: "etf",
        preferred_mic: "XAMS",
        preferred_currency: "",
      }),
    );
    expect(r.ok).toBe(true);
    expect(sb.instrumentInserts).toHaveLength(1);
    const payload = sb.instrumentInserts[0]!.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("preferred_mic");
    expect(payload).not.toHaveProperty("preferred_currency");
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

describe("addOrder — account scope", () => {
  const resolveMock = vi.mocked(resolveWritableAccountId);

  function basicForm(extra: Record<string, string> = {}) {
    return form({
      kind: "deposit",
      gross_amount: "1000",
      trade_date: "2025-01-01",
      broker: "Bourse Direct",
      support: "CTO",
      currency: "EUR",
      ...extra,
    });
  }

  it("refuses an account_id the caller does not own", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    resolveMock.mockResolvedValueOnce({
      ok: false,
      error: "Compte introuvable ou non détenu.",
    });

    const r = await addOrder(
      basicForm({ account_id: "00000000-0000-0000-0000-000000000099" }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/introuvable|détenu/i);
    expect(sb.inserts).toHaveLength(0);
  });

  it("refuses ALL active without an account_id override", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    resolveMock.mockResolvedValueOnce({
      ok: false,
      error: "Sélectionne un compte spécifique avant d'écrire.",
    });

    const r = await addOrder(basicForm());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/compte spécifique/);
    expect(sb.inserts).toHaveLength(0);
  });

  it("uses the active scope when no override is supplied", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    // Default mock returns acc-1 for undefined override — exercise that path.
    const r = await addOrder(basicForm());
    expect(r.ok).toBe(true);
    expect(sb.inserts).toHaveLength(1);
    const ins = sb.inserts[0]!.payload as Record<string, unknown>;
    expect(ins.account_id).toBe("acc-1");
    expect(resolveMock).toHaveBeenCalledWith(null);
  });

  it("uses the override account_id when supplied", async () => {
    const sb = makeSupabase({ accountId: "acc-2" });
    createClientMock.mockResolvedValue(sb.client as never);

    const r = await addOrder(
      basicForm({ account_id: "11111111-1111-1111-1111-111111111111" }),
    );
    expect(r.ok).toBe(true);
    const ins = sb.inserts[0]!.payload as Record<string, unknown>;
    expect(ins.account_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(resolveMock).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
  });
});

const cgSearchListings = coingeckoProvider.searchListings as ReturnType<typeof vi.fn>;

describe("addOrder — crypto (manual order without ISIN)", () => {
  beforeEach(() => {
    cgSearchListings.mockReset();
  });

  it("accepts a CRYPTO buy without ISIN when the symbol is supplied, and resolves via CoinGecko", async () => {
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
    const sb = makeSupabase({ existingInstruments: [], instrumentId: "inst-btc" });
    createClientMock.mockResolvedValue(sb.client as never);

    const r = await addOrder(
      form({
        kind: "buy",
        symbol: "BTC",
        name: "BTC",
        quantity: "0.5",
        price: "60000",
        gross_amount: "30000",
        fees: "0",
        trade_date: "2025-01-01",
        broker: "Coinbase",
        support: "CRYPTO",
        currency: "EUR",
        asset_class: "crypto",
      }),
    );

    expect(r.ok).toBe(true);
    expect(cgSearchListings).toHaveBeenCalledWith("BTC");
    expect(sb.instrumentInserts).toHaveLength(1);
    const payload = sb.instrumentInserts[0]!.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      isin: null,
      symbol: "BTC",
      asset_class: "crypto",
      currency: "EUR",
      provider: "coingecko",
      provider_symbol: "bitcoin",
      preferred_mic: null,
      preferred_currency: "EUR",
    });
    expect(sb.inserts).toHaveLength(1);
    const ins = sb.inserts[0]!.payload as Record<string, unknown>;
    expect(ins.instrument_id).toBe("inst-btc");
    expect(ins.support).toBe("CRYPTO");
  });

  it("reuses an existing crypto instrument keyed on (symbol, asset_class=crypto) without a CoinGecko call", async () => {
    const sb = makeSupabase({
      existingInstruments: [
        {
          id: "inst-eth",
          symbol: "ETH",
          asset_class: "crypto",
          preferred_mic: null,
          preferred_currency: "EUR",
        },
      ],
      instrumentId: "inst-eth",
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const r = await addOrder(
      form({
        kind: "buy",
        symbol: "ETH",
        name: "ETH",
        quantity: "1",
        price: "3000",
        gross_amount: "3000",
        fees: "0",
        trade_date: "2025-01-01",
        broker: "Coinbase",
        support: "CRYPTO",
        currency: "EUR",
        asset_class: "crypto",
      }),
    );

    expect(r.ok).toBe(true);
    expect(cgSearchListings).not.toHaveBeenCalled();
    expect(sb.instrumentInserts).toHaveLength(0);
    expect(sb.inserts).toHaveLength(1);
    const ins = sb.inserts[0]!.payload as Record<string, unknown>;
    expect(ins.instrument_id).toBe("inst-eth");
  });

  it("rejects a crypto order without a symbol", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    const r = await addOrder(
      form({
        kind: "buy",
        name: "BTC",
        quantity: "0.5",
        price: "60000",
        gross_amount: "30000",
        fees: "0",
        trade_date: "2025-01-01",
        broker: "Coinbase",
        support: "CRYPTO",
        currency: "EUR",
        asset_class: "crypto",
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Symbole crypto/);
    expect(cgSearchListings).not.toHaveBeenCalled();
  });

  it("rejects a crypto order whose symbol is unknown to CoinGecko", async () => {
    cgSearchListings.mockResolvedValue([]);
    const sb = makeSupabase({ existingInstruments: [] });
    createClientMock.mockResolvedValue(sb.client as never);

    const r = await addOrder(
      form({
        kind: "buy",
        symbol: "MYSTERYCOIN",
        name: "MYSTERYCOIN",
        quantity: "1",
        price: "1",
        gross_amount: "1",
        fees: "0",
        trade_date: "2025-01-01",
        broker: "Coinbase",
        support: "CRYPTO",
        currency: "EUR",
        asset_class: "crypto",
      }),
    );

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/CoinGecko/);
    expect(sb.instrumentInserts).toHaveLength(0);
    expect(sb.inserts).toHaveLength(0);
  });

  it("still rejects a non-crypto buy without ISIN", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    const r = await addOrder(
      form({
        kind: "buy",
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
});
