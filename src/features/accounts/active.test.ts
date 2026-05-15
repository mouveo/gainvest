import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = { value: null as string | null };

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn((name: string) =>
      name === "gainvest_active_account" && cookieStore.value !== null
        ? { value: cookieStore.value }
        : undefined,
    ),
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

import { getActiveAccount } from "./active";
import { ALL_ACCOUNTS } from "./constants";

const OLDEST = "11111111-1111-1111-1111-111111111111";
const OWNED = "22222222-2222-2222-2222-222222222222";
const UNKNOWN = "33333333-3333-3333-3333-333333333333";

function makeSupabase(opts: { ownedAccountIds?: string[] }) {
  const owned = new Set(opts.ownedAccountIds ?? [OLDEST]);
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })),
    },
    from: vi.fn((table: string) => {
      if (table !== "accounts") return {};
      // Two distinct chains used:
      //  - select("id").eq("id", x).maybeSingle()   (ownership lookup)
      //  - select("id").order(...).limit(1).maybeSingle()   (oldest fallback)
      const state: { eqId?: string } = {};
      const builder = {
        eq: vi.fn((col: string, val: string) => {
          if (col === "id") state.eqId = val;
          return builder;
        }),
        order: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => {
          if (state.eqId) {
            return owned.has(state.eqId)
              ? { data: { id: state.eqId }, error: null }
              : { data: null, error: null };
          }
          // fallback: oldest
          const first = owned.values().next().value;
          return first
            ? { data: { id: first }, error: null }
            : { data: null, error: null };
        }),
      };
      return {
        select: vi.fn(() => builder),
      };
    }),
  };
}

const createClientMock = vi.mocked(createClient);

beforeEach(() => {
  cookieStore.value = null;
  createClientMock.mockReset();
});

describe("getActiveAccount", () => {
  it("falls back to the oldest account when the cookie is missing", async () => {
    cookieStore.value = null;
    const supabase = makeSupabase({ ownedAccountIds: [OLDEST] });
    createClientMock.mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const result = await getActiveAccount();
    expect(result).toBe(OLDEST);
  });

  it("returns ALL when the cookie is set to ALL", async () => {
    cookieStore.value = ALL_ACCOUNTS;
    const supabase = makeSupabase({ ownedAccountIds: [OLDEST] });
    createClientMock.mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const result = await getActiveAccount();
    expect(result).toBe(ALL_ACCOUNTS);
  });

  it("returns the cookie UUID when the user owns that account", async () => {
    cookieStore.value = OWNED;
    const supabase = makeSupabase({ ownedAccountIds: [OLDEST, OWNED] });
    createClientMock.mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const result = await getActiveAccount();
    expect(result).toBe(OWNED);
  });

  it("falls back to the oldest account when the cookie UUID is not owned", async () => {
    cookieStore.value = UNKNOWN;
    const supabase = makeSupabase({ ownedAccountIds: [OLDEST] });
    createClientMock.mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const result = await getActiveAccount();
    expect(result).toBe(OLDEST);
  });

  it("falls back to the oldest account when the cookie is not a UUID", async () => {
    cookieStore.value = "not-a-uuid";
    const supabase = makeSupabase({ ownedAccountIds: [OLDEST] });
    createClientMock.mockResolvedValue(
      supabase as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const result = await getActiveAccount();
    expect(result).toBe(OLDEST);
  });
});
