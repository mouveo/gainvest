import { beforeEach, describe, expect, it, vi } from "vitest";

const setCookieMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    set: setCookieMock,
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

import { POST } from "./route";

const USER_ID = "9f2bfbb4-2d94-4def-958a-ab0604b63a25";
const OWNED = "11111111-1111-1111-1111-111111111111";

function makeSupabase(opts: { user?: { id: string } | null; ownedIds?: string[] } = {}) {
  const user = opts.user === undefined ? { id: USER_ID } : opts.user;
  const owned = new Set(opts.ownedIds ?? [OWNED]);
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user } })),
    },
    from: vi.fn((table: string) => {
      if (table !== "accounts") return {};
      const state: { eqId?: string } = {};
      const builder = {
        eq: vi.fn((col: string, val: string) => {
          if (col === "id") state.eqId = val;
          return builder;
        }),
        maybeSingle: vi.fn(async () => {
          const ok = state.eqId && owned.has(state.eqId);
          return ok ? { data: { id: state.eqId }, error: null } : { data: null, error: null };
        }),
      };
      return {
        select: vi.fn(() => builder),
      };
    }),
  };
}

function makeRequest(body: unknown): Parameters<typeof POST>[0] {
  return {
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0];
}

const createClientMock = vi.mocked(createClient);

beforeEach(() => {
  setCookieMock.mockReset();
  createClientMock.mockReset();
});

describe("POST /api/active-account", () => {
  it("sets the cookie for an owned UUID", async () => {
    const sb = makeSupabase();
    createClientMock.mockResolvedValue(sb as never);

    const res = await POST(makeRequest({ accountId: OWNED }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(setCookieMock).toHaveBeenCalledWith(
      "gainvest_active_account",
      OWNED,
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
  });

  it("sets the cookie when ALL is passed", async () => {
    const sb = makeSupabase();
    createClientMock.mockResolvedValue(sb as never);

    const res = await POST(makeRequest({ accountId: "ALL" }));
    expect(res.status).toBe(200);
    expect(setCookieMock).toHaveBeenCalledWith(
      "gainvest_active_account",
      "ALL",
      expect.any(Object),
    );
  });

  it("refuses a UUID the user does not own", async () => {
    const sb = makeSupabase({ ownedIds: [] });
    createClientMock.mockResolvedValue(sb as never);

    const res = await POST(makeRequest({ accountId: OWNED }));
    expect(res.status).toBe(404);
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid value with 400", async () => {
    const sb = makeSupabase();
    createClientMock.mockResolvedValue(sb as never);

    const res = await POST(makeRequest({ accountId: "not-a-uuid" }));
    expect(res.status).toBe(400);
    expect(setCookieMock).not.toHaveBeenCalled();
  });
});
