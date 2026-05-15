import "server-only";

import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";

import { ACTIVE_ACCOUNT_COOKIE, ALL_ACCOUNTS, type ActiveAccount } from "./constants";
import { getOldestAccountId, isUuid, userOwnsAccount } from "./queries";

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

/**
 * Pick a writable account id. Explicit `override` (when owned by the caller)
 * wins; otherwise the active scope from the cookie is used. Refuses `ALL`
 * since it cannot map to a concrete `account_id` column on `transactions`.
 */
export async function resolveWritableAccountId(
  override?: string | null,
): Promise<{ ok: true; accountId: string } | { ok: false; error: string }> {
  if (override) {
    const trimmed = override.trim();
    if (!isUuid(trimmed)) {
      return { ok: false, error: "Identifiant de compte invalide." };
    }
    const owns = await userOwnsAccount(trimmed);
    if (!owns) {
      return { ok: false, error: "Compte introuvable ou non détenu." };
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
