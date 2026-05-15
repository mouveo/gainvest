"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

import { ACCOUNT_TYPES, type AccountType } from "./constants";
import { isUuid } from "./queries";

export type AccountActionResult = { ok: true } | { ok: false; error: string };

const CURRENCY_RE = /^[A-Z]{3}$/;
const MAX_NAME_LENGTH = 80;

type AccountInputRaw = {
  name: unknown;
  type: unknown;
  currency: unknown;
};

type AccountInput = {
  name: string;
  type: AccountType;
  currency: string;
};

function validateName(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return { ok: false, error: "Le nom du compte est requis." };
  if (value.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Nom trop long (max ${MAX_NAME_LENGTH} caractères).` };
  }
  return { ok: true, value };
}

function validateType(raw: unknown): { ok: true; value: AccountType } | { ok: false; error: string } {
  if (typeof raw !== "string" || !ACCOUNT_TYPES.includes(raw as AccountType)) {
    return { ok: false, error: "Type de compte invalide." };
  }
  return { ok: true, value: raw as AccountType };
}

function validateCurrency(
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!CURRENCY_RE.test(value)) {
    return { ok: false, error: "Devise invalide (code ISO 4217 sur 3 lettres)." };
  }
  return { ok: true, value };
}

function parseAccountInput(
  input: AccountInputRaw,
): { ok: true; value: AccountInput } | { ok: false; error: string } {
  const name = validateName(input.name);
  if (!name.ok) return name;
  const type = validateType(input.type);
  if (!type.ok) return type;
  const currency = validateCurrency(input.currency);
  if (!currency.ok) return currency;
  return {
    ok: true,
    value: {
      name: name.value,
      type: type.value,
      currency: currency.value,
    },
  };
}

function revalidateAccountSurfaces() {
  revalidatePath("/settings/accounts");
  revalidatePath("/portfolio");
  revalidatePath("/");
}

export async function createAccount(input: {
  name: string;
  type: string;
  currency: string;
}): Promise<AccountActionResult> {
  const parsed = parseAccountInput(input);
  if (!parsed.ok) return parsed;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Non authentifié." };

  const { error } = await supabase.from("accounts").insert({
    user_id: user.id,
    name: parsed.value.name,
    type: parsed.value.type,
    currency: parsed.value.currency,
  });
  if (error) return { ok: false, error: error.message };

  revalidateAccountSurfaces();
  return { ok: true };
}

export async function renameAccount(
  accountId: string,
  name: string,
): Promise<AccountActionResult> {
  if (!isUuid(accountId)) return { ok: false, error: "Identifiant de compte invalide." };
  const validated = validateName(name);
  if (!validated.ok) return validated;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Non authentifié." };

  // RLS filters to the caller's rows; the explicit eq("user_id") keeps the
  // intent visible and stops a renamed row from silently no-op'ing when the
  // user_id doesn't match.
  const { data, error } = await supabase
    .from("accounts")
    .update({ name: validated.value })
    .eq("id", accountId)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Compte introuvable ou non détenu." };

  revalidateAccountSurfaces();
  return { ok: true };
}

export async function updateAccount(
  accountId: string,
  input: { name: string; type: string; currency: string },
): Promise<AccountActionResult> {
  if (!isUuid(accountId)) return { ok: false, error: "Identifiant de compte invalide." };
  const parsed = parseAccountInput(input);
  if (!parsed.ok) return parsed;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Non authentifié." };

  const { data, error } = await supabase
    .from("accounts")
    .update({
      name: parsed.value.name,
      type: parsed.value.type,
      currency: parsed.value.currency,
    })
    .eq("id", accountId)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Compte introuvable ou non détenu." };

  revalidateAccountSurfaces();
  return { ok: true };
}

export async function deleteAccount(accountId: string): Promise<AccountActionResult> {
  if (!isUuid(accountId)) return { ok: false, error: "Identifiant de compte invalide." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Non authentifié." };

  // Ownership check first — RLS would already block the delete, but a
  // surgical lookup gives a clean error message rather than "0 rows".
  const { data: owned, error: ownedErr } = await supabase
    .from("accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (ownedErr) return { ok: false, error: ownedErr.message };
  if (!owned) return { ok: false, error: "Compte introuvable ou non détenu." };

  // Refuse to delete the last remaining account: the FK on transactions
  // requires at least one account to exist for new flows.
  const { count: accountCount, error: countErr } = await supabase
    .from("accounts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (countErr) return { ok: false, error: countErr.message };
  if ((accountCount ?? 0) <= 1) {
    return { ok: false, error: "Impossible de supprimer le dernier compte." };
  }

  const { count: txCount, error: txErr } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);
  if (txErr) return { ok: false, error: txErr.message };
  if ((txCount ?? 0) > 0) {
    return {
      ok: false,
      error: "Impossible de supprimer un compte avec des transactions.",
    };
  }

  const { error: delErr } = await supabase
    .from("accounts")
    .delete()
    .eq("id", accountId)
    .eq("user_id", user.id);
  if (delErr) return { ok: false, error: delErr.message };

  revalidateAccountSurfaces();
  return { ok: true };
}
