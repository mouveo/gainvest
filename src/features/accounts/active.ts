import "server-only";

import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";

import { ACTIVE_ACCOUNT_COOKIE, ALL_ACCOUNTS, type ActiveAccount } from "./constants";
import { getOldestAccountId, isUuid } from "./queries";

/**
 * Resolve the active account from the cookie:
 * - `ALL` → portfolio aggregates every account.
 * - UUID owned by the caller → that account.
 * - missing / invalid / not owned → fallback to the oldest account.
 */
export async function getActiveAccount(): Promise<ActiveAccount> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(ACTIVE_ACCOUNT_COOKIE)?.value ?? null;

  if (raw === ALL_ACCOUNTS) return ALL_ACCOUNTS;

  if (raw && isUuid(raw)) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", raw)
      .maybeSingle();
    if (!error && data) return data.id;
  }

  return getOldestAccountId();
}
