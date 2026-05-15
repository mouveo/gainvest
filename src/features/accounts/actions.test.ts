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

type Owned = { id: string; transactionCount: number };

type MockOptions = {
  user?: { id: string } | null;
  ownedAccounts?: Owned[];
};

function makeSupabase(opts: MockOptions = {}) {
  const user = opts.user === undefined ? { id: USER_ID } : opts.user;
  const owned = new Map<string, Owned>(
    (opts.ownedAccounts ?? [{ id: OWNED_ID, transactionCount: 0 }]).map((a) => [a.id, a]),
  );

  const inserts: Record<string, unknown>[] = [];
  const updates: { id: string | undefined; payload: Record<string, unknown> }[] = [];
  const deletes: { id: string | undefined; userId: string | undefined }[] = [];

  const client = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user } })),
    },
    from: vi.fn((table: string) => {
      if (table === "accounts") {
        return accountsBuilder();
      }
      if (table === "transactions") {
        return transactionsBuilder();
      }
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
        const filters: { id?: string; userId?: string } = {};
        const builder = {
          eq: vi.fn((col: string, val: string) => {
            if (col === "id") filters.id = val;
            if (col === "user_id") filters.userId = val;
            return builder;
          }),
          select: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => {
            updates.push({ id: filters.id, payload });
            const ok = filters.id && owned.has(filters.id) && filters.userId === USER_ID;
            return ok ? { data: { id: filters.id }, error: null } : { data: null, error: null };
          }),
        };
        return builder;
      }),
      delete: vi.fn(() => {
        const filters: { id?: string; userId?: string } = {};
        const builder = {
          eq: vi.fn(async (col: string, val: string) => {
            if (col === "id") filters.id = val;
            if (col === "user_id") filters.userId = val;
            deletes.push({ id: filters.id, userId: filters.userId });
            return { error: null };
          }),
        };
        // Both eq() chain twice — return self until awaited on the second one.
        let calls = 0;
        const chain = {
          eq: vi.fn((col: string, val: string) => {
            if (col === "id") filters.id = val;
            if (col === "user_id") filters.userId = val;
            calls += 1;
            if (calls >= 2) {
              deletes.push({ id: filters.id, userId: filters.userId });
              return Promise.resolve({ error: null });
            }
            return chain;
          }),
        };
        return chain as unknown as typeof builder;
      }),
      select: vi.fn((cols: string, options?: { count?: string; head?: boolean }) => {
        if (options?.count === "exact" && options.head) {
          const filters: { userId?: string } = {};
          const builder = {
            eq: vi.fn(async (col: string, val: string) => {
              if (col === "user_id") filters.userId = val;
              const count = filters.userId === USER_ID ? owned.size : 0;
              return { count, error: null };
            }),
          };
          return builder;
        }
        // Ownership lookup: select("id").eq("id", x).eq("user_id", x).maybeSingle()
        const filters: { id?: string; userId?: string } = {};
        const builder = {
          eq: vi.fn((col: string, val: string) => {
            if (col === "id") filters.id = val;
            if (col === "user_id") filters.userId = val;
            return builder;
          }),
          maybeSingle: vi.fn(async () => {
            const ok = filters.id && owned.has(filters.id) && filters.userId === USER_ID;
            return ok ? { data: { id: filters.id }, error: null } : { data: null, error: null };
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
                ? (owned.get(filters.accountId)?.transactionCount ?? 0)
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

  it("inserts using the authenticated user_id", async () => {
    const { client, inserts } = makeSupabase();
    createClientMock.mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    const result = await createAccount({
      name: "Société Mouveo",
      type: "cto",
      broker: "Bourse Direct",
      currency: "eur",
    });
    expect(result).toEqual({ ok: true });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      user_id: USER_ID,
      name: "Société Mouveo",
      type: "cto",
      broker: "Bourse Direct",
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
});

describe("deleteAccount", () => {
  it("refuses the last remaining account", async () => {
    const { client } = makeSupabase({
      ownedAccounts: [{ id: OWNED_ID, transactionCount: 0 }],
    });
    createClientMock.mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    const result = await deleteAccount(OWNED_ID);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("dernier") });
  });

  it("refuses an account with transactions", async () => {
    const { client } = makeSupabase({
      ownedAccounts: [
        { id: OWNED_ID, transactionCount: 3 },
        { id: OTHER_ID, transactionCount: 0 },
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

  it("refuses an account not owned by the caller", async () => {
    const { client } = makeSupabase({
      ownedAccounts: [{ id: OTHER_ID, transactionCount: 0 }],
    });
    createClientMock.mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    const result = await deleteAccount("33333333-3333-3333-3333-333333333333");
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("introuvable"),
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
