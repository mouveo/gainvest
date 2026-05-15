import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/features/accounts/active", () => ({
  getActiveAccount: vi.fn(),
}));

import { getActiveAccount } from "@/features/accounts/active";
import { createClient } from "@/lib/supabase/server";

import { deleteTransactionsByBroker } from "./actions";

const ACC_PERSO = "11111111-1111-1111-1111-111111111111";

type DeletedRow = { id: string; account_id: string; broker: string };

function makeSupabase(rows: DeletedRow[]) {
  const filters: { userId?: string; accountId?: string; broker?: string } = {};
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })),
    },
    from: vi.fn(() => {
      const builder = {
        delete: vi.fn(() => builder),
        eq: vi.fn((col: string, val: string) => {
          if (col === "user_id") filters.userId = val;
          if (col === "account_id") filters.accountId = val;
          if (col === "broker") filters.broker = val;
          return builder;
        }),
        select: vi.fn(async () => {
          const matched = rows.filter(
            (r) =>
              r.account_id === filters.accountId && r.broker === filters.broker,
          );
          return { data: matched, error: null };
        }),
      };
      return builder;
    }),
    filters,
  };
}

const createClientMock = vi.mocked(createClient);
const getActiveAccountMock = vi.mocked(getActiveAccount);

beforeEach(() => {
  createClientMock.mockReset();
  getActiveAccountMock.mockReset();
});

describe("deleteTransactionsByBroker", () => {
  it("only deletes rows in the active account", async () => {
    const sb = makeSupabase([
      { id: "t1", account_id: ACC_PERSO, broker: "Bourse Direct" },
      { id: "t2", account_id: "other-acct", broker: "Bourse Direct" },
    ]);
    createClientMock.mockResolvedValue(sb as never);
    getActiveAccountMock.mockResolvedValue(ACC_PERSO);

    const result = await deleteTransactionsByBroker("Bourse Direct");
    expect(result).toEqual({ deleted: 1 });
    expect(sb.filters.accountId).toBe(ACC_PERSO);
  });

  it("refuses to run when ALL is active without an explicit override", async () => {
    const sb = makeSupabase([]);
    createClientMock.mockResolvedValue(sb as never);
    getActiveAccountMock.mockResolvedValue("ALL");

    const result = await deleteTransactionsByBroker("Bourse Direct");
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("compte spécifique"),
    });
  });
});
