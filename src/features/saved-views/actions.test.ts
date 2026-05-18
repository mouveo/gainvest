import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

import {
  applyView,
  deleteView,
  listViews,
  saveAsNewView,
  setDefaultView,
  updateView,
} from "./actions";
import type { ViewPayload } from "./types";

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

type SavedRow = {
  id: string;
  user_id: string;
  scope: string;
  name: string;
  payload: Record<string, unknown>;
  is_default: boolean;
  updated_at: string;
};

type PrefRow = { user_id: string; scope: string; payload: Record<string, unknown> };

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `view-${idCounter}`;
}

let nowCounter = 0;
function nextTimestamp() {
  nowCounter += 1;
  return new Date(2026, 0, 1, 0, 0, nowCounter).toISOString();
}

type MockOptions = {
  user?: { id: string } | null;
  views?: SavedRow[];
  prefs?: PrefRow[];
  insertError?: { code?: string; message: string } | null;
  rpcError?: { message: string } | null;
};

function makeSupabase(opts: MockOptions = {}) {
  const user = opts.user === undefined ? { id: USER_A } : opts.user;
  const views: SavedRow[] = (opts.views ?? []).slice();
  const prefs: PrefRow[] = (opts.prefs ?? []).slice();
  const rpcCalls: Array<{ name: string; args: unknown }> = [];

  const client = {
    rpcCalls,
    auth: {
      getUser: vi.fn(async () => ({ data: { user } })),
    },
    rpc: vi.fn(async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      if (opts.rpcError) return { data: null, error: opts.rpcError };
      if (name === "set_default_saved_view") {
        const { target_id } = args as { target_id: string };
        const target = views.find((v) => v.id === target_id && v.user_id === (user?.id ?? null));
        if (!target) return { data: null, error: { message: "saved_view_not_found" } };
        for (const v of views) {
          if (v.user_id === target.user_id && v.scope === target.scope) {
            v.is_default = v.id === target_id;
          }
        }
        return { data: null, error: null };
      }
      return { data: null, error: { message: `unknown rpc ${name}` } };
    }),
    from: vi.fn((table: string) => {
      if (table === "saved_views") return savedViewsBuilder();
      if (table === "user_preferences") return prefsBuilder();
      throw new Error(`unexpected table ${table}`);
    }),
  };

  return { client, views, prefs };

  function savedViewsBuilder() {
    const eqs: Array<[string, unknown]> = [];
    const neqs: Array<[string, unknown]> = [];
    const orders: Array<{ col: string; asc: boolean }> = [];
    let limitN: number | null = null;
    let mode: "select" | "insert" | "update" | "delete" = "select";
    let updatePatch: Partial<SavedRow> = {};
    let insertRow: Partial<SavedRow> | null = null;
    let updateOptions: { count?: "exact" } | undefined;
    let selectAfterMutation = false;

    const applyFilters = (row: SavedRow) =>
      eqs.every(([c, v]) => (row as unknown as Record<string, unknown>)[c] === v) &&
      neqs.every(([c, v]) => (row as unknown as Record<string, unknown>)[c] !== v);

    const builder: Record<string, unknown> = {};
    builder.select = (_cols?: string) => {
      if (mode === "insert" || mode === "update" || mode === "delete") {
        selectAfterMutation = true;
      }
      return builder;
    };
    builder.eq = (col: string, val: unknown) => {
      eqs.push([col, val]);
      return builder;
    };
    builder.neq = (col: string, val: unknown) => {
      neqs.push([col, val]);
      return builder;
    };
    builder.order = (col: string, options: { ascending: boolean }) => {
      orders.push({ col, asc: options.ascending });
      return builder;
    };
    builder.limit = (n: number) => {
      limitN = n;
      return builder;
    };
    builder.insert = (row: Partial<SavedRow>) => {
      mode = "insert";
      insertRow = row;
      return builder;
    };
    builder.update = (patch: Partial<SavedRow>, options?: { count?: "exact" }) => {
      mode = "update";
      updatePatch = patch;
      updateOptions = options;
      return builder;
    };
    builder.delete = () => {
      mode = "delete";
      return builder;
    };

    const finishSelect = () => {
      let rows = views.filter(applyFilters);
      for (const ord of [...orders].reverse()) {
        rows = rows.slice().sort((a, b) => {
          const av = (a as unknown as Record<string, unknown>)[ord.col];
          const bv = (b as unknown as Record<string, unknown>)[ord.col];
          if (av === bv) return 0;
          const cmp = av! < bv! ? -1 : 1;
          return ord.asc ? cmp : -cmp;
        });
      }
      if (limitN !== null) rows = rows.slice(0, limitN);
      return rows;
    };

    builder.maybeSingle = async () => {
      if (mode === "select") {
        const rows = finishSelect();
        return { data: rows[0] ?? null, error: null };
      }
      throw new Error(`maybeSingle on mode ${mode} not supported`);
    };
    builder.single = async () => {
      if (mode === "insert") {
        if (opts.insertError) return { data: null, error: opts.insertError };
        // Enforce unique (user_id, scope, name)
        const row = insertRow as Partial<SavedRow>;
        const dup = views.find(
          (v) =>
            v.user_id === row.user_id &&
            v.scope === row.scope &&
            v.name === row.name,
        );
        if (dup) {
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        // Enforce partial unique (is_default) — only one default per (user, scope).
        if (row.is_default) {
          const otherDefault = views.find(
            (v) =>
              v.user_id === row.user_id && v.scope === row.scope && v.is_default,
          );
          if (otherDefault) {
            return { data: null, error: { code: "23505", message: "duplicate default" } };
          }
        }
        const created: SavedRow = {
          id: nextId(),
          user_id: row.user_id!,
          scope: row.scope!,
          name: row.name!,
          payload: (row.payload as Record<string, unknown>) ?? {},
          is_default: row.is_default ?? false,
          updated_at: nextTimestamp(),
        };
        views.push(created);
        return { data: { id: created.id }, error: null };
      }
      throw new Error(`single on mode ${mode} not supported`);
    };

    const thenable = {
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        const promise = (async () => {
          try {
            if (mode === "select") {
              const rows = finishSelect();
              return { data: rows, error: null, count: rows.length };
            }
            if (mode === "update") {
              const rows = views.filter(applyFilters);
              for (const row of rows) {
                Object.assign(row, updatePatch);
                row.updated_at = nextTimestamp();
              }
              const count = updateOptions?.count === "exact" ? rows.length : null;
              if (selectAfterMutation) {
                return { data: rows, error: null, count };
              }
              return { data: null, error: null, count };
            }
            if (mode === "delete") {
              const toRemove = views.filter(applyFilters);
              for (const row of toRemove) {
                const idx = views.indexOf(row);
                if (idx >= 0) views.splice(idx, 1);
              }
              return { data: null, error: null, count: toRemove.length };
            }
            return { data: null, error: null };
          } catch (err) {
            return { data: null, error: err };
          }
        })();
        return promise.then(onFulfilled, onRejected);
      },
    };

    // Make the builder itself thenable so `await supabase.from(...).update(...).eq(...)` works.
    (builder as Record<string, unknown>).then = thenable.then;

    return builder;
  }

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
      const match = prefs.find(
        (r) => r.user_id === filters.user_id && r.scope === filters.scope,
      );
      return { data: match ? { payload: match.payload } : null, error: null };
    };
    builder.upsert = async (row: PrefRow, _opts: unknown) => {
      const idx = prefs.findIndex(
        (r) => r.user_id === row.user_id && r.scope === row.scope,
      );
      if (idx >= 0) prefs[idx] = { ...row };
      else prefs.push({ ...row });
      return { data: null, error: null };
    };
    return builder;
  }
}

const createClientMock = vi.mocked(createClient);

beforeEach(() => {
  createClientMock.mockReset();
  idCounter = 0;
  nowCounter = 0;
});

function basePayload(overrides: Partial<ViewPayload> = {}): ViewPayload {
  return {
    version: 1,
    columns: { instrument: true },
    filters: {},
    search: "",
    toggles: {},
    sort: [],
    ...overrides,
  };
}

describe("listViews", () => {
  it("returns the user's views, defaults first", async () => {
    const sb = makeSupabase({
      views: [
        {
          id: "v-1",
          user_id: USER_A,
          scope: "positions",
          name: "A",
          payload: { version: 1 },
          is_default: false,
          updated_at: "2026-02-01T00:00:00Z",
        },
        {
          id: "v-2",
          user_id: USER_A,
          scope: "positions",
          name: "B",
          payload: { version: 1 },
          is_default: true,
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "v-3",
          user_id: USER_B,
          scope: "positions",
          name: "Other",
          payload: { version: 1 },
          is_default: true,
          updated_at: "2026-03-01T00:00:00Z",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const out = await listViews("positions");
    expect(out.map((r) => r.id)).toEqual(["v-2", "v-1"]);
    expect(out[0]!.payload.version).toBe(1);
  });

  it("returns [] when scope is invalid", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    expect(await listViews("global" as never)).toEqual([]);
  });

  it("returns [] when unauthenticated", async () => {
    const sb = makeSupabase({ user: null });
    createClientMock.mockResolvedValue(sb.client as never);
    expect(await listViews("positions")).toEqual([]);
  });
});

describe("saveAsNewView", () => {
  it("creates the first view as default", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    const result = await saveAsNewView({
      scope: "positions",
      name: "My view",
      payload: basePayload(),
    });
    expect(result.ok).toBe(true);
    expect(sb.views).toHaveLength(1);
    expect(sb.views[0]!.is_default).toBe(true);
    expect(sb.views[0]!.user_id).toBe(USER_A);
  });

  it("creates subsequent views as non-default", async () => {
    const sb = makeSupabase({
      views: [
        {
          id: "v-1",
          user_id: USER_A,
          scope: "positions",
          name: "First",
          payload: { version: 1 },
          is_default: true,
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);
    const result = await saveAsNewView({
      scope: "positions",
      name: "Second",
      payload: basePayload(),
    });
    expect(result.ok).toBe(true);
    const created = sb.views.find((v) => v.name === "Second")!;
    expect(created.is_default).toBe(false);
  });

  it("rejects an empty name with a clear message", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    const result = await saveAsNewView({
      scope: "positions",
      name: "   ",
      payload: basePayload(),
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("requis") });
  });

  it("rejects a name over 80 characters", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    const result = await saveAsNewView({
      scope: "positions",
      name: "x".repeat(81),
      payload: basePayload(),
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("80") });
  });

  it("rejects an invalid scope", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    const result = await saveAsNewView({
      scope: "global" as never,
      name: "X",
      payload: basePayload(),
    });
    expect(result.ok).toBe(false);
  });

  it("surfaces a friendly error on name conflict", async () => {
    const sb = makeSupabase({
      views: [
        {
          id: "v-1",
          user_id: USER_A,
          scope: "positions",
          name: "Taken",
          payload: { version: 1 },
          is_default: true,
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);
    const result = await saveAsNewView({
      scope: "positions",
      name: "Taken",
      payload: basePayload(),
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("déjà") });
  });

  it("isolates users — user B writes their own row", async () => {
    const sb = makeSupabase({
      user: { id: USER_B },
      views: [
        {
          id: "v-1",
          user_id: USER_A,
          scope: "positions",
          name: "Shared",
          payload: { version: 1 },
          is_default: true,
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);
    // Same name allowed because the unique key includes user_id.
    const result = await saveAsNewView({
      scope: "positions",
      name: "Shared",
      payload: basePayload(),
    });
    expect(result.ok).toBe(true);
    const bRow = sb.views.find((v) => v.user_id === USER_B);
    expect(bRow).toBeDefined();
    expect(bRow!.is_default).toBe(true); // first view in scope for user B
  });
});

describe("updateView", () => {
  it("updates name and payload", async () => {
    const sb = makeSupabase({
      views: [
        {
          id: "v-1",
          user_id: USER_A,
          scope: "positions",
          name: "Old",
          payload: { version: 1, columns: { a: true } },
          is_default: true,
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);
    const result = await updateView("v-1", {
      name: "  New  ",
      payload: basePayload({ columns: { b: true } }),
    });
    expect(result).toEqual({ ok: true });
    expect(sb.views[0]!.name).toBe("New");
    expect((sb.views[0]!.payload as ViewPayload).columns).toEqual({ b: true });
  });

  it("returns not-found when the view doesn't belong to the caller", async () => {
    const sb = makeSupabase({
      user: { id: USER_B },
      views: [
        {
          id: "v-1",
          user_id: USER_A,
          scope: "positions",
          name: "Mine",
          payload: { version: 1 },
          is_default: true,
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);
    const result = await updateView("v-1", { name: "Stolen" });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("introuvable") });
  });

  it("rejects an oversized name", async () => {
    const sb = makeSupabase({});
    createClientMock.mockResolvedValue(sb.client as never);
    const result = await updateView("v-1", { name: "x".repeat(81) });
    expect(result.ok).toBe(false);
  });
});

describe("setDefaultView", () => {
  it("flips the default atomically via RPC", async () => {
    const sb = makeSupabase({
      views: [
        {
          id: "v-1",
          user_id: USER_A,
          scope: "positions",
          name: "A",
          payload: { version: 1 },
          is_default: true,
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "v-2",
          user_id: USER_A,
          scope: "positions",
          name: "B",
          payload: { version: 1 },
          is_default: false,
          updated_at: "2026-02-01T00:00:00Z",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);
    const result = await setDefaultView("v-2");
    expect(result).toEqual({ ok: true });
    expect(sb.views.find((v) => v.id === "v-1")!.is_default).toBe(false);
    expect(sb.views.find((v) => v.id === "v-2")!.is_default).toBe(true);
    expect(sb.client.rpcCalls).toHaveLength(1);
    expect(sb.client.rpcCalls[0]).toEqual({
      name: "set_default_saved_view",
      args: { target_id: "v-2" },
    });
  });

  it("maps the RPC not-found error to a clear message", async () => {
    const sb = makeSupabase({ views: [] });
    createClientMock.mockResolvedValue(sb.client as never);
    const result = await setDefaultView("missing");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("introuvable") });
  });
});

describe("deleteView", () => {
  it("allows deleting a non-default view", async () => {
    const sb = makeSupabase({
      views: [
        {
          id: "v-1",
          user_id: USER_A,
          scope: "positions",
          name: "A",
          payload: { version: 1 },
          is_default: true,
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "v-2",
          user_id: USER_A,
          scope: "positions",
          name: "B",
          payload: { version: 1 },
          is_default: false,
          updated_at: "2026-02-01T00:00:00Z",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);
    const result = await deleteView("v-2");
    expect(result).toEqual({ ok: true });
    expect(sb.views.map((v) => v.id)).toEqual(["v-1"]);
  });

  it("promotes the most-recently-updated sibling when deleting a default", async () => {
    const sb = makeSupabase({
      views: [
        {
          id: "v-1",
          user_id: USER_A,
          scope: "positions",
          name: "Default",
          payload: { version: 1 },
          is_default: true,
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "v-2",
          user_id: USER_A,
          scope: "positions",
          name: "Old",
          payload: { version: 1 },
          is_default: false,
          updated_at: "2026-02-01T00:00:00Z",
        },
        {
          id: "v-3",
          user_id: USER_A,
          scope: "positions",
          name: "Newer",
          payload: { version: 1 },
          is_default: false,
          updated_at: "2026-03-01T00:00:00Z",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);
    const result = await deleteView("v-1");
    expect(result).toEqual({ ok: true });
    expect(sb.views.find((v) => v.id === "v-1")).toBeUndefined();
    expect(sb.views.find((v) => v.id === "v-3")!.is_default).toBe(true);
    expect(sb.views.find((v) => v.id === "v-2")!.is_default).toBe(false);
  });

  it("refuses to delete the only (default) view of a scope", async () => {
    const sb = makeSupabase({
      views: [
        {
          id: "v-1",
          user_id: USER_A,
          scope: "positions",
          name: "Solo",
          payload: { version: 1 },
          is_default: true,
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);
    const result = await deleteView("v-1");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("dernière") });
    expect(sb.views).toHaveLength(1);
  });

  it("does not let user B delete user A's view", async () => {
    const sb = makeSupabase({
      user: { id: USER_B },
      views: [
        {
          id: "v-1",
          user_id: USER_A,
          scope: "positions",
          name: "A",
          payload: { version: 1 },
          is_default: true,
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);
    const result = await deleteView("v-1");
    expect(result.ok).toBe(false);
    expect(sb.views).toHaveLength(1);
  });
});

describe("applyView", () => {
  it("writes scoped + global preferences and returns the payload", async () => {
    const payload: ViewPayload = {
      version: 1,
      columns: { instrument: true, qty: false },
      filters: { broker: "ibkr" },
      search: "AAPL",
      toggles: { withDividends: true, netOfFees: false },
      sort: [{ id: "name", desc: true }],
      pagination: { pageIndex: 1, pageSize: 25 },
    };
    const sb = makeSupabase({
      views: [
        {
          id: "v-1",
          user_id: USER_A,
          scope: "positions",
          name: "Mine",
          payload: payload as unknown as Record<string, unknown>,
          is_default: true,
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      prefs: [
        {
          user_id: USER_A,
          scope: "positions",
          payload: { customLeftover: 1, columns: { stale: true } },
        },
        {
          user_id: USER_A,
          scope: "global",
          payload: { inflationAdjusted: true },
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const result = await applyView("v-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scope).toBe("positions");
    expect(result.payload.columns).toEqual({ instrument: true, qty: false });

    const scoped = sb.prefs.find((r) => r.scope === "positions")!.payload;
    expect(scoped).toMatchObject({
      columns: { instrument: true, qty: false },
      filters: { broker: "ibkr" },
      search: "AAPL",
      sort: [{ id: "name", desc: true }],
      pagination: { pageIndex: 1, pageSize: 25 },
      activeViewId: "v-1",
      customLeftover: 1,
    });
    // Stale managed key was dropped.
    expect((scoped.columns as Record<string, unknown>).stale).toBeUndefined();

    const global = sb.prefs.find((r) => r.scope === "global")!.payload;
    expect(global).toEqual({
      inflationAdjusted: true, // preserved (no overwrite — view set it to false? no, view didn't include it)
      pnlWithDividends: true,
      netOfFees: false,
    });
  });

  it("does not touch global preferences when the view carries no toggles", async () => {
    const sb = makeSupabase({
      views: [
        {
          id: "v-1",
          user_id: USER_A,
          scope: "positions",
          name: "Mine",
          payload: { version: 1, toggles: {} },
          is_default: true,
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      prefs: [
        {
          user_id: USER_A,
          scope: "global",
          payload: { netOfFees: true },
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);

    const result = await applyView("v-1");
    expect(result.ok).toBe(true);
    expect(sb.prefs.find((r) => r.scope === "global")!.payload).toEqual({ netOfFees: true });
  });

  it("returns not-found if the view belongs to another user", async () => {
    const sb = makeSupabase({
      user: { id: USER_B },
      views: [
        {
          id: "v-1",
          user_id: USER_A,
          scope: "positions",
          name: "Mine",
          payload: { version: 1 },
          is_default: true,
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    createClientMock.mockResolvedValue(sb.client as never);
    const result = await applyView("v-1");
    expect(result.ok).toBe(false);
  });
});
