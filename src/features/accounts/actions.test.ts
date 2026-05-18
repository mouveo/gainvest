import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

import {
  createAccount,
  deleteAccount,
  renameAccount,
  updateAccount,
} from "./actions";

const USER_ID = "9f2bfbb4-2d94-4def-958a-ab0604b63a25";
const OWNED_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "22222222-2222-2222-2222-222222222222";

type Visible = { id: string; transactionCount: number; canDelete?: boolean };

type MockOptions = {
  user?: { id: string } | null;
  // Accounts the caller can see (RLS-visible). `canDelete` controls whether
  // the RLS-gated DELETE actually removes the row (proxy for "owner role").
  visibleAccounts?: Visible[];
};

function makeSupabase(opts: MockOptions = {}) {
  const user = opts.user === undefined ? { id: USER_ID } : opts.user;
  const visible = new Map<string, Visible>(
    (opts.visibleAccounts ?? [{ id: OWNED_ID, transactionCount: 0, canDelete: true }]).map(
      (a) => [a.id, a],
    ),
  );

  const inserts: Record<string, unknown>[] = [];
  const updates: { id: string | undefined; payload: Record<string, unknown> }[] = [];
  const deletes: { id: string | undefined }[] = [];

  const client = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user } })),
    },
    from: vi.fn((table: string) => {
      if (table === "accounts") return accountsBuilder();
      if (table === "transactions") return transactionsBuilder();
      return {};
    }),
  };

  function accountsBuilder() {
    return {
      insert: vi.fn(async (payload: Record<string, unknown>) => {
        inserts.push(payload);
        return { error: null };
      }),
      update: vi.fn((payload: Record<string, unknown>) => {
        const filters: { id?: string } = {};
        const builder = {
          eq: vi.fn((col: string, val: string) => {
            if (col === "id") filters.id = val;
            return builder;
          }),
          select: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => {
            updates.push({ id: filters.id, payload });
            const ok = filters.id != null && visible.has(filters.id);
            return ok
              ? { data: { id: filters.id }, error: null }
              : { data: null, error: null };
          }),
        };
        return builder;
      }),
      delete: vi.fn(() => {
        const filters: { id?: string } = {};
        const builder = {
          eq: vi.fn((col: string, val: string) => {
            if (col === "id") filters.id = val;
            return builder;
          }),
          select: vi.fn(async () => {
            deletes.push({ id: filters.id });
            const row = filters.id ? visible.get(filters.id) : undefined;
            // RLS silently filters when the caller is not an owner.
            const data = row && row.canDelete !== false ? [{ id: row.id }] : [];
            return { data, error: null };
          }),
        };
        return builder;
      }),
      select: vi.fn((_cols: string, options?: { count?: string; head?: boolean }) => {
        if (options?.count === "exact" && options.head) {
          return {
            // `.select("id", { count: "exact", head: true })` resolves directly
            // — no further chaining now that user_id is gone.
            then: (
              resolve: (value: { count: number; error: null }) => void,
            ) => {
              resolve({ count: visible.size, error: null });
              return Promise.resolve({ count: visible.size, error: null });
            },
          };
        }
        // Surgical accessibility lookup: select("id").eq("id", x).maybeSingle()
        const filters: { id?: string } = {};
        const builder = {
          eq: vi.fn((col: string, val: string) => {
            if (col === "id") filters.id = val;
            return builder;
          }),
          maybeSingle: vi.fn(async () => {
            const ok = filters.id != null && visible.has(filters.id);
            return ok
              ? { data: { id: filters.id }, error: null }
              : { data: null, error: null };
          }),
        };
        return builder;
      }),
    };
  }

  function transactionsBuilder() {
    return {
      select: vi.fn((_cols: string, options?: { count?: string; head?: boolean }) => {
        if (options?.count === "exact" && options.head) {
          const filters: { accountId?: string } = {};
          const builder = {
            eq: vi.fn(async (col: string, val: string) => {
              if (col === "account_id") filters.accountId = val;
              const count = filters.accountId
                ? (visible.get(filters.accountId)?.transactionCount ?? 0)
                : 0;
              return { count, error: null };
            }),
          };
          return builder;
        }
        return { eq: vi.fn(async () => ({ count: 0, error: null })) };
      }),
    };
  }

  return { client, inserts, updates, deletes };
}

const createClientMock = vi.mocked(createClient);

beforeEach(() => {
  createClientMock.mockReset();
});

describe("createAccount", () => {
  it("refuses an empty name", async () => {
    const { client } = makeSupabase();
    createClientMock.mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    const result = await createAccount({ name: "   ", type: "cto", currency: "EUR" });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("nom") });
  });

  it("refuses an invalid type", async () => {
    const { client } = makeSupabase();
    createClientMock.mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    const result = await createAccount({ name: "Perso", type: "bogus", currency: "EUR" });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Type") });
  });

  it("refuses an invalid currency", async () => {
    const { client } = makeSupabase();
    createClientMock.mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    const result = await createAccount({ name: "Perso", type: "cto", currency: "EURO" });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Devise") });
  });

  it("inserts using the authenticated user_id as audit", async () => {
    const { client, inserts } = makeSupabase();
    createClientMock.mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    const result = await createAccount({
      name: "Société Mouveo",
      type: "cto",
      currency: "eur",
    });
    expect(result).toEqual({ ok: true });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      user_id: USER_ID,
      name: "Société Mouveo",
      type: "cto",
      currency: "EUR",
    });
  });
});

describe("renameAccount", () => {
  it("refuses an empty name", async () => {
    const { client } = makeSupabase();
    createClientMock.mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    const result = await renameAccount(OWNED_ID, "   ");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("nom") });
  });

  it("returns a clear error when RLS filters out the update", async () => {
    const { client } = makeSupabase({ visibleAccounts: [] });
    createClientMock.mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    const result = await renameAccount(OWNED_ID, "Perso");
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("modification non autorisée"),
    });
  });
});

describe("deleteAccount", () => {
  it("refuses the last remaining accessible account", async () => {
    const { client } = makeSupabase({
      visibleAccounts: [{ id: OWNED_ID, transactionCount: 0, canDelete: true }],
    });
    createClientMock.mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    const result = await deleteAccount(OWNED_ID);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("dernier") });
  });

  it("refuses an account with transactions", async () => {
    const { client } = makeSupabase({
      visibleAccounts: [
        { id: OWNED_ID, transactionCount: 3, canDelete: true },
        { id: OTHER_ID, transactionCount: 0, canDelete: true },
      ],
    });
    createClientMock.mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    const result = await deleteAccount(OWNED_ID);
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("transactions"),
    });
  });

  it("refuses an account the caller cannot access", async () => {
    const { client } = makeSupabase({
      visibleAccounts: [{ id: OTHER_ID, transactionCount: 0, canDelete: true }],
    });
    createClientMock.mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    const result = await deleteAccount("33333333-3333-3333-3333-333333333333");
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("non accessible"),
    });
  });

  it("rejects with an owner-required error when RLS filters the delete (viewer / editor)", async () => {
    const { client } = makeSupabase({
      visibleAccounts: [
        // Account is visible (caller is e.g. viewer) but the DELETE is silently
        // filtered by RLS because the caller is not the owner.
        { id: OWNED_ID, transactionCount: 0, canDelete: false },
        { id: OTHER_ID, transactionCount: 0, canDelete: true },
      ],
    });
    createClientMock.mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    const result = await deleteAccount(OWNED_ID);
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("propriétaire"),
    });
  });
});

describe("updateAccount", () => {
  it("validates input before hitting the DB", async () => {
    const { client } = makeSupabase();
    createClientMock.mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    const result = await updateAccount(OWNED_ID, {
      name: "Perso",
      type: "bogus",
      currency: "EUR",
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Type") });
  });
});
