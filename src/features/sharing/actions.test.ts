import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => (name === "origin" ? "http://localhost:3000" : null),
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import {
  cancelInvitation,
  inviteMember,
  materializeInvitations,
  revokeMember,
  updateMemberRole,
} from "./actions";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER_ID = "22222222-2222-2222-2222-222222222222";
const ACC_PERSO = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ACC_MOUVEO = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

type Membership = { account_id: string; user_id: string; role: string };
type Pending = {
  id: string;
  email: string;
  account_id: string;
  role: string;
  consumed_at: string | null;
  expires_at: string;
};

type Captured = {
  invites: { email: string; redirectTo?: string }[];
  otps: { email: string; redirectTo?: string }[];
  rpcCalls: { fn: string; args: Record<string, unknown> }[];
};

function makeStubs(opts: {
  user?: { id: string; email?: string } | null;
  memberships?: Membership[];
  pendings?: Pending[];
  inviteError?: { code?: string; message: string } | null;
  rpcResult?: { account_id: string }[];
  rpcError?: { message: string } | null;
}) {
  const user = opts.user === undefined ? { id: USER_ID } : opts.user;
  const memberships = (opts.memberships ?? []).slice();
  const pendings = (opts.pendings ?? []).slice();
  const captured: Captured = { invites: [], otps: [], rpcCalls: [] };

  function membershipsBuilder() {
    const filters: Record<string, string | string[]> = {};
    const sort: { col?: string; asc?: boolean } = {};
    let countMode = false;

    const builder: Record<string, unknown> = {};
    const applyFilters = (rows: Membership[]) =>
      rows.filter((r) => {
        if (filters.account_id && r.account_id !== filters.account_id) return false;
        if (filters.user_id && r.user_id !== filters.user_id) return false;
        if (filters.role && r.role !== filters.role) return false;
        if (filters.account_ids_in) {
          const list = filters.account_ids_in as string[];
          if (!list.includes(r.account_id)) return false;
        }
        if (filters.user_id_neq && r.user_id === filters.user_id_neq) return false;
        return true;
      });

    builder.select = (
      _cols: string,
      options?: { count?: string; head?: boolean },
    ) => {
      countMode = !!(options?.count && options.head);
      return builder;
    };
    builder.eq = (col: string, val: string) => {
      filters[col] = val;
      return builder;
    };
    builder.neq = (col: string, val: string) => {
      filters[`${col}_neq`] = val;
      return builder;
    };
    builder.in = (col: string, vals: string[]) => {
      filters[`${col}s_in`] = vals;
      return builder;
    };
    builder.order = (col: string, opts: { ascending?: boolean }) => {
      sort.col = col;
      sort.asc = opts.ascending !== false;
      return builder;
    };
    builder.maybeSingle = async () => {
      const matches = applyFilters(memberships);
      return { data: matches[0] ?? null, error: null };
    };
    builder.then = (
      resolve: (value: { data: unknown; count?: number; error: null }) => void,
    ) => {
      const matches = applyFilters(memberships);
      if (countMode) {
        const v = { count: matches.length, data: null, error: null };
        resolve(v);
        return Promise.resolve(v);
      }
      const v = { data: matches, error: null };
      resolve(v);
      return Promise.resolve(v);
    };
    // delete / update operate on the same filter state
    builder.delete = () => builder;
    builder.update = (patch: Partial<Membership>) => {
      const matches = applyFilters(memberships);
      for (const row of matches) Object.assign(row, patch);
      return builder;
    };
    return builder;
  }

  function pendingBuilder() {
    const filters: Record<string, string | null> = {};
    const builder: Record<string, unknown> = {};

    const applyFilters = (rows: Pending[]) =>
      rows.filter((r) => {
        if (filters.id != null && r.id !== filters.id) return false;
        if (filters.account_id != null && r.account_id !== filters.account_id) {
          return false;
        }
        if (filters.consumed_at_is === "null" && r.consumed_at != null) return false;
        if (filters.expires_at_gt && r.expires_at <= filters.expires_at_gt) {
          return false;
        }
        return true;
      });

    builder.select = (_cols: string) => builder;
    builder.eq = (col: string, val: string) => {
      filters[col] = val;
      return builder;
    };
    builder.is = (_col: string, _val: null) => {
      filters.consumed_at_is = "null";
      return builder;
    };
    builder.gt = (_col: string, val: string) => {
      filters.expires_at_gt = val;
      return builder;
    };
    builder.order = () => builder;
    builder.upsert = (payload: Pending[], _opts: unknown) => {
      const inserted: Pending[] = [];
      for (const row of payload) {
        const dupe = pendings.some(
          (p) =>
            p.email.toLowerCase() === row.email.toLowerCase() &&
            p.account_id === row.account_id &&
            p.consumed_at == null,
        );
        if (dupe) continue;
        const stored: Pending = {
          id: `pending-${pendings.length + 1}`,
          email: row.email,
          account_id: row.account_id,
          role: row.role,
          consumed_at: null,
          expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
        };
        pendings.push(stored);
        inserted.push(stored);
      }
      return {
        select: () =>
          Promise.resolve({ data: inserted.map((p) => ({ id: p.id })), error: null }),
      };
    };
    builder.delete = () => builder;
    builder.then = (
      resolve: (value: { data: unknown; error: null }) => void,
    ) => {
      const matches = applyFilters(pendings);
      // If filters.id is present, it's a delete-by-id flow → return the
      // deleted rows.
      if (filters.id) {
        for (const m of matches) {
          const idx = pendings.indexOf(m);
          if (idx >= 0) pendings.splice(idx, 1);
        }
      }
      const v = { data: matches, error: null };
      resolve(v);
      return Promise.resolve(v);
    };
    return builder;
  }

  function accountsBuilder() {
    const filters: Record<string, string | string[]> = {};
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (col: string, val: string) => {
      filters[col] = val;
      return builder;
    };
    builder.in = (col: string, vals: string[]) => {
      filters[`${col}s_in`] = vals;
      return builder;
    };
    builder.order = () => builder;
    builder.then = (resolve: (value: { data: unknown; error: null }) => void) => {
      // Trivial mock: emit a row for every requested id.
      const ids = (filters.ids_in as string[] | undefined) ?? [];
      const v = {
        data: ids.map((id) => ({ id, name: `Account ${id.slice(0, 4)}` })),
        error: null,
      };
      resolve(v);
      return Promise.resolve(v);
    };
    return builder;
  }

  const userClient = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user } })),
      signInWithOtp: vi.fn(async (input: { email: string; options?: { emailRedirectTo?: string } }) => {
        captured.otps.push({ email: input.email, redirectTo: input.options?.emailRedirectTo });
        return { error: null };
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "account_memberships") return membershipsBuilder();
      if (table === "pending_memberships") return pendingBuilder();
      if (table === "accounts") return accountsBuilder();
      return {};
    }),
  };

  const adminClient = {
    auth: {
      admin: {
        inviteUserByEmail: vi.fn(async (email: string, options?: { redirectTo?: string }) => {
          if (opts.inviteError) {
            return { data: null, error: opts.inviteError };
          }
          captured.invites.push({ email, redirectTo: options?.redirectTo });
          return { data: { user: { id: "new-user-id", email } }, error: null };
        }),
        getUserById: vi.fn(async (id: string) => ({
          data: { user: { id, email: `${id.slice(0, 4)}@example.com` } },
          error: null,
        })),
      },
    },
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      captured.rpcCalls.push({ fn, args });
      if (opts.rpcError) return { data: null, error: opts.rpcError };
      return { data: opts.rpcResult ?? [], error: null };
    }),
  };

  return { userClient, adminClient, captured, memberships, pendings };
}

const createClientMock = vi.mocked(createClient);
const createAdminClientMock = vi.mocked(createAdminClient);

beforeEach(() => {
  createClientMock.mockReset();
  createAdminClientMock.mockReset();
});

describe("inviteMember", () => {
  it("validates inputs", async () => {
    const stubs = makeStubs({});
    createClientMock.mockResolvedValue(stubs.userClient as never);
    createAdminClientMock.mockReturnValue(stubs.adminClient as never);

    expect(
      await inviteMember({ email: "not-an-email", accountIds: [ACC_PERSO], role: "viewer" }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("Email") });
    expect(
      await inviteMember({
        email: "alice@example.com",
        accountIds: [ACC_PERSO],
        role: "boss" as never,
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("Rôle") });
    expect(
      await inviteMember({ email: "alice@example.com", accountIds: [], role: "viewer" }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("au moins un") });
    expect(
      await inviteMember({
        email: "alice@example.com",
        accountIds: ["nope"],
        role: "viewer",
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("compte invalide") });
  });

  it("refuses when the caller is not owner of every selected account", async () => {
    const stubs = makeStubs({
      memberships: [{ account_id: ACC_PERSO, user_id: USER_ID, role: "owner" }],
    });
    createClientMock.mockResolvedValue(stubs.userClient as never);
    createAdminClientMock.mockReturnValue(stubs.adminClient as never);

    const result = await inviteMember({
      email: "alice@example.com",
      accountIds: [ACC_PERSO, ACC_MOUVEO],
      role: "viewer",
    });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("propriétaire") });
    expect(stubs.pendings).toHaveLength(0);
    expect(stubs.captured.invites).toHaveLength(0);
  });

  it("creates one pending row per account and sends a single email", async () => {
    const stubs = makeStubs({
      memberships: [
        { account_id: ACC_PERSO, user_id: USER_ID, role: "owner" },
        { account_id: ACC_MOUVEO, user_id: USER_ID, role: "owner" },
      ],
    });
    createClientMock.mockResolvedValue(stubs.userClient as never);
    createAdminClientMock.mockReturnValue(stubs.adminClient as never);

    const result = await inviteMember({
      email: "ALICE@example.COM",
      accountIds: [ACC_PERSO, ACC_MOUVEO],
      role: "editor",
    });

    expect(result).toMatchObject({ ok: true, created: 2, alreadyOpen: 0, emailSent: true });
    expect(stubs.pendings).toHaveLength(2);
    // Email is normalized to lowercase.
    expect(stubs.pendings.every((p) => p.email === "alice@example.com")).toBe(true);
    // Only one auth email goes out for the batch.
    expect(stubs.captured.invites).toHaveLength(1);
    expect(stubs.captured.invites[0]!.email).toBe("alice@example.com");
    expect(stubs.captured.invites[0]!.redirectTo).toContain("/auth/callback");
    expect(stubs.captured.invites[0]!.redirectTo).toContain("next=/portfolio");
    expect(stubs.captured.otps).toHaveLength(0);
  });

  it("is idempotent — re-inviting on the same account does not duplicate the pending row", async () => {
    const stubs = makeStubs({
      memberships: [{ account_id: ACC_PERSO, user_id: USER_ID, role: "owner" }],
      pendings: [
        {
          id: "pending-existing",
          email: "alice@example.com",
          account_id: ACC_PERSO,
          role: "viewer",
          consumed_at: null,
          expires_at: new Date(Date.now() + 86400_000).toISOString(),
        },
      ],
    });
    createClientMock.mockResolvedValue(stubs.userClient as never);
    createAdminClientMock.mockReturnValue(stubs.adminClient as never);

    const result = await inviteMember({
      email: "alice@example.com",
      accountIds: [ACC_PERSO],
      role: "viewer",
    });
    expect(result).toMatchObject({ ok: true, created: 0, alreadyOpen: 1 });
    expect(stubs.pendings).toHaveLength(1);
  });

  it("falls back to a magic link when the invitee already exists", async () => {
    const stubs = makeStubs({
      memberships: [{ account_id: ACC_PERSO, user_id: USER_ID, role: "owner" }],
      inviteError: { code: "email_exists", message: "User already registered" },
    });
    createClientMock.mockResolvedValue(stubs.userClient as never);
    createAdminClientMock.mockReturnValue(stubs.adminClient as never);

    const result = await inviteMember({
      email: "alice@example.com",
      accountIds: [ACC_PERSO],
      role: "viewer",
    });
    expect(result).toMatchObject({ ok: true, emailSent: true });
    expect(stubs.captured.invites).toHaveLength(0); // inviteUserByEmail "failed"
    expect(stubs.captured.otps).toHaveLength(1);
    expect(stubs.captured.otps[0]!.email).toBe("alice@example.com");
  });
});

describe("revokeMember", () => {
  it("refuses when the caller is not owner", async () => {
    const stubs = makeStubs({
      memberships: [
        { account_id: ACC_PERSO, user_id: USER_ID, role: "viewer" },
        { account_id: ACC_PERSO, user_id: OTHER_USER_ID, role: "owner" },
      ],
    });
    createClientMock.mockResolvedValue(stubs.userClient as never);
    createAdminClientMock.mockReturnValue(stubs.adminClient as never);

    const result = await revokeMember(ACC_PERSO, OTHER_USER_ID);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("propriétaires") });
  });

  it("refuses to remove the last owner", async () => {
    const stubs = makeStubs({
      memberships: [{ account_id: ACC_PERSO, user_id: USER_ID, role: "owner" }],
    });
    createClientMock.mockResolvedValue(stubs.userClient as never);
    createAdminClientMock.mockReturnValue(stubs.adminClient as never);

    const result = await revokeMember(ACC_PERSO, USER_ID);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("dernier propriétaire") });
  });

  it("removes a non-owner member", async () => {
    const stubs = makeStubs({
      memberships: [
        { account_id: ACC_PERSO, user_id: USER_ID, role: "owner" },
        { account_id: ACC_PERSO, user_id: OTHER_USER_ID, role: "viewer" },
      ],
    });
    createClientMock.mockResolvedValue(stubs.userClient as never);
    createAdminClientMock.mockReturnValue(stubs.adminClient as never);

    const result = await revokeMember(ACC_PERSO, OTHER_USER_ID);
    expect(result).toEqual({ ok: true });
  });
});

describe("updateMemberRole", () => {
  it("refuses to demote the last owner", async () => {
    const stubs = makeStubs({
      memberships: [{ account_id: ACC_PERSO, user_id: USER_ID, role: "owner" }],
    });
    createClientMock.mockResolvedValue(stubs.userClient as never);
    createAdminClientMock.mockReturnValue(stubs.adminClient as never);

    const result = await updateMemberRole(ACC_PERSO, USER_ID, "viewer");
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("dégrader") });
  });

  it("promotes a viewer to editor when caller is owner", async () => {
    const stubs = makeStubs({
      memberships: [
        { account_id: ACC_PERSO, user_id: USER_ID, role: "owner" },
        { account_id: ACC_PERSO, user_id: OTHER_USER_ID, role: "viewer" },
      ],
    });
    createClientMock.mockResolvedValue(stubs.userClient as never);
    createAdminClientMock.mockReturnValue(stubs.adminClient as never);

    const result = await updateMemberRole(ACC_PERSO, OTHER_USER_ID, "editor");
    expect(result).toEqual({ ok: true });
    expect(
      stubs.memberships.find((m) => m.user_id === OTHER_USER_ID)?.role,
    ).toBe("editor");
  });
});

describe("cancelInvitation", () => {
  it("rejects invalid ids", async () => {
    const stubs = makeStubs({});
    createClientMock.mockResolvedValue(stubs.userClient as never);
    createAdminClientMock.mockReturnValue(stubs.adminClient as never);

    const result = await cancelInvitation("not-a-uuid");
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("invalide") });
  });

  it("deletes the pending row when RLS allows it", async () => {
    const stubs = makeStubs({
      pendings: [
        {
          id: "33333333-3333-3333-3333-333333333333",
          email: "alice@example.com",
          account_id: ACC_PERSO,
          role: "viewer",
          consumed_at: null,
          expires_at: new Date(Date.now() + 86400_000).toISOString(),
        },
      ],
    });
    createClientMock.mockResolvedValue(stubs.userClient as never);
    createAdminClientMock.mockReturnValue(stubs.adminClient as never);

    const result = await cancelInvitation("33333333-3333-3333-3333-333333333333");
    expect(result).toEqual({ ok: true });
    expect(stubs.pendings).toHaveLength(0);
  });

  it("returns an error when RLS filters the delete", async () => {
    const stubs = makeStubs({ pendings: [] });
    createClientMock.mockResolvedValue(stubs.userClient as never);
    createAdminClientMock.mockReturnValue(stubs.adminClient as never);

    const result = await cancelInvitation("44444444-4444-4444-4444-444444444444");
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("introuvable") });
  });
});

describe("materializeInvitations", () => {
  it("returns the first joined account_id when the RPC redeems invitations", async () => {
    const stubs = makeStubs({
      rpcResult: [{ account_id: ACC_PERSO }, { account_id: ACC_MOUVEO }],
    });
    createClientMock.mockResolvedValue(stubs.userClient as never);
    createAdminClientMock.mockReturnValue(stubs.adminClient as never);

    const result = await materializeInvitations(USER_ID, "Alice@Example.COM");
    expect(result).toBe(ACC_PERSO);
    expect(stubs.captured.rpcCalls).toHaveLength(1);
    expect(stubs.captured.rpcCalls[0]).toEqual({
      fn: "consume_pending_memberships",
      args: { invitee: USER_ID, invitee_email: "alice@example.com" },
    });
  });

  it("returns null when no invitations were redeemed", async () => {
    const stubs = makeStubs({ rpcResult: [] });
    createClientMock.mockResolvedValue(stubs.userClient as never);
    createAdminClientMock.mockReturnValue(stubs.adminClient as never);

    const result = await materializeInvitations(USER_ID, "alice@example.com");
    expect(result).toBeNull();
  });

  it("returns null on invalid arguments without calling the RPC", async () => {
    const stubs = makeStubs({});
    createClientMock.mockResolvedValue(stubs.userClient as never);
    createAdminClientMock.mockReturnValue(stubs.adminClient as never);

    expect(await materializeInvitations("not-a-uuid", "alice@example.com")).toBeNull();
    expect(await materializeInvitations(USER_ID, "not-an-email")).toBeNull();
    expect(stubs.captured.rpcCalls).toHaveLength(0);
  });

  it("returns null when the RPC errors", async () => {
    const stubs = makeStubs({
      rpcError: { message: "permission denied" },
    });
    createClientMock.mockResolvedValue(stubs.userClient as never);
    createAdminClientMock.mockReturnValue(stubs.adminClient as never);

    const result = await materializeInvitations(USER_ID, "alice@example.com");
    expect(result).toBeNull();
  });
});
