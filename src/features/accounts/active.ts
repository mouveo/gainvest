import "server-only";

import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";

import { ACTIVE_ACCOUNT_COOKIE, ALL_ACCOUNTS, type ActiveAccount } from "./constants";
import { getOldestAccountId, isUuid, userCanAccessAccount } from "./queries";

/**
 * Resolve the active account from the cookie:
 * - `ALL` → portfolio aggregates every accessible account.
 * - UUID the caller can access (owner / editor / viewer) → that account.
 * - missing / invalid / inaccessible → fallback to the oldest accessible account.
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

/**
 * Pick a writable account id. Explicit `override` wins when the caller can
 * access the target account; otherwise the active scope from the cookie is
 * used. Refuses `ALL` since it cannot map to a concrete `account_id` column
 * on `transactions`. Note: this only proves the caller has *some* membership.
 * The actual insert/update is gated by RLS — a viewer will be rejected at
 * the DB level even though we let them through here.
 */
export async function resolveWritableAccountId(
  override?: string | null,
): Promise<{ ok: true; accountId: string } | { ok: false; error: string }> {
  if (override) {
    const trimmed = override.trim();
    if (!isUuid(trimmed)) {
      return { ok: false, error: "Identifiant de compte invalide." };
    }
    const canAccess = await userCanAccessAccount(trimmed);
    if (!canAccess) {
      return { ok: false, error: "Compte introuvable ou non accessible." };
    }
    return { ok: true, accountId: trimmed };
  }
  const active = await getActiveAccount();
  if (active === ALL_ACCOUNTS) {
    return {
      ok: false,
      error: "Sélectionne un compte spécifique avant d'écrire.",
    };
  }
  return { ok: true, accountId: active };
}
