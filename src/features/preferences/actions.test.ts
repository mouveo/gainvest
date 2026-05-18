import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

import { getUserPreference, setUserPreference } from "./actions";

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

type Row = { user_id: string; scope: string; payload: Record<string, unknown> };

function makeSupabase(opts: {
  user?: { id: string } | null;
  rows?: Row[];
  readError?: { message: string } | null;
  upsertError?: { message: string } | null;
}) {
  const user = opts.user === undefined ? { id: USER_A } : opts.user;
  const rows: Row[] = (opts.rows ?? []).slice();
  const upserts: Row[] = [];

  return {
    rows,
    upserts,
    client: {
      auth: {
        getUser: vi.fn(async () => ({ data: { user } })),
      },
      from: vi.fn((table: string) => {
        if (table !== "user_preferences") return {};
        return prefsBuilder();
      }),
    },
  };

  function prefsBuilder() {
    const filters: { user_id?: string; scope?: string } = {};
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (col: string, val: string) => {
      if (col === "user_id") filters.user_id = val;
      if (col === "scope") filters.scope = val;
      return builder;
    };
    builder.maybeSingle = async () => {
      if (opts.readError) return { data: null, error: opts.readError };
      const match = rows.find(
        (r) => r.user_id === filters.user_id && r.scope === filters.scope,
      );
      return { data: match ? { payload: match.payload } : null, error: null };
    };
    builder.upsert = async (row: Row, _options: unknown) => {
      if (opts.upsertError) return { data: null, error: opts.upsertError };
      upserts.push({ ...row });
      const idx = rows.findIndex(
        (r) => r.user_id === row.user_id && r.scope === row.scope,
      );
      if (idx >= 0) {
        rows[idx] = { ...row };
      } else {
        rows.push({ ...row });
      }
      return { data: null, error: null };
    };
    return builder;
  }
}

const createClientMock = vi.mocked(createClient);

beforeEach(() => {
  createClientMock.mockReset();
});

describe("getUserPreference", () => {
  it("returns null when no row exists", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    expect(await getUserPreference("positions")).toBeNull();
  });

  it("rejects an invalid scope", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    expect(await getUserPreference("nope" as never)).toBeNull();
  });

  it("returns null when the caller is not authenticated", async () => {
    const sb = makeSupabase({ user: null });
    createClientMock.mockResolvedValue(sb.client as never);
    expect(await getUserPreference("global")).toBeNull();
  });

  it("returns the user's payload", async () => {
    const sb = makeSupabase({
      rows: [
        {
          user_id: USER_A,
          scope: "positions",
          payload: { columns: { instrument: true } },
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);
    expect(await getUserPreference("positions")).toEqual({
      columns: { instrument: true },
    });
  });

  it("isolates users — user B cannot read user A's row", async () => {
    const sb = makeSupabase({
      user: { id: USER_B },
      rows: [
        {
          user_id: USER_A,
          scope: "positions",
          payload: { columns: { instrument: true } },
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);
    expect(await getUserPreference("positions")).toBeNull();
  });
});

describe("setUserPreference", () => {
  it("validates the scope", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    const result = await setUserPreference("nope" as never, { foo: 1 });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Scope") });
  });

  it("refuses arrays / non-object patches", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    const result = await setUserPreference("global", [] as unknown as Record<string, unknown>);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Patch") });
  });

  it("creates the row on first write", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    const result = await setUserPreference("global", { netOfFees: true });
    expect(result).toEqual({ ok: true });
    expect(sb.upserts).toHaveLength(1);
    expect(sb.upserts[0]!.payload).toEqual({ netOfFees: true });
  });

  it("merges patches without dropping sibling keys", async () => {
    const sb = makeSupabase({
      rows: [
        {
          user_id: USER_A,
          scope: "positions",
          payload: {
            columns: { instrument: true, broker: true },
            filters: { broker: "Bourse Direct" },
            toggles: { compact: true },
          },
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const result = await setUserPreference("positions", {
      columns: { instrument: false, broker: true },
    });
    expect(result).toEqual({ ok: true });
    expect(sb.rows[0]!.payload).toEqual({
      columns: { instrument: false, broker: true },
      filters: { broker: "Bourse Direct" },
      toggles: { compact: true },
    });
  });

  it("isolates user B's writes from user A's row", async () => {
    const sb = makeSupabase({
      user: { id: USER_B },
      rows: [
        {
          user_id: USER_A,
          scope: "global",
          payload: { netOfFees: true },
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);

    await setUserPreference("global", { netOfFees: false });
    // User A's row is untouched.
    expect(sb.rows.find((r) => r.user_id === USER_A)?.payload).toEqual({
      netOfFees: true,
    });
    // User B got their own row.
    expect(sb.rows.find((r) => r.user_id === USER_B)?.payload).toEqual({
      netOfFees: false,
    });
  });

  it("surfaces upsert errors", async () => {
    const sb = makeSupabase({
      upsertError: { message: "permission denied" },
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const result = await setUserPreference("global", { x: 1 });
    expect(result).toEqual({ ok: false, error: "permission denied" });
  });
});
