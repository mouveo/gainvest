import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

export type Account = Database["public"]["Tables"]["accounts"]["Row"];
export type AccountWithTransactionCount = Account & { transaction_count: number };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Returns the oldest account id for the current user (deterministic fallback
 * when no active account cookie is set). Inserts a default Portefeuille if
 * the user has no accounts yet — should not happen in practice since the
 * on_auth_user_created trigger seeds one, but kept as a safety net.
 */
export async function getOldestAccountId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("accounts")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (data) return data.id;

  const { data: created, error: insertErr } = await supabase
    .from("accounts")
    .insert({ user_id: user.id, name: "Portefeuille", type: "cto", currency: "EUR" })
    .select("id")
    .single();
  if (insertErr) throw insertErr;
  return created.id;
}

export async function listAccounts(): Promise<Account[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listAccountsWithTransactionCounts(): Promise<
  AccountWithTransactionCount[]
> {
  const supabase = await createClient();
  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rows = accounts ?? [];
  if (rows.length === 0) return [];

  const { data: txRows, error: txErr } = await supabase
    .from("transactions")
    .select("account_id");
  if (txErr) throw txErr;

  const countByAccount = new Map<string, number>();
  for (const row of txRows ?? []) {
    if (!row.account_id) continue;
    countByAccount.set(row.account_id, (countByAccount.get(row.account_id) ?? 0) + 1);
  }

  return rows.map((acc) => ({
    ...acc,
    transaction_count: countByAccount.get(acc.id) ?? 0,
  }));
}

export async function userOwnsAccount(accountId: string): Promise<boolean> {
  if (!accountId || !isUuid(accountId)) return false;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("id")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

/**
 * Pick an account id for a write operation: an explicit override (verified
 * against the caller's owned accounts) takes precedence over the oldest
 * account fallback.
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
  try {
    const accountId = await getOldestAccountId();
    return { ok: true, accountId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
