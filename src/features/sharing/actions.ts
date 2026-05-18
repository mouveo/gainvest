"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { isUuid } from "@/features/accounts/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type MemberRole = "owner" | "editor" | "viewer";

const ROLES: readonly MemberRole[] = ["owner", "editor", "viewer"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type MemberSummary = {
  userId: string;
  role: MemberRole;
  email: string | null;
  createdAt: string;
};

export type PendingInvitation = {
  id: string;
  email: string;
  role: MemberRole;
  invitedAt: string;
  expiresAt: string;
};

export type OwnerAccount = {
  id: string;
  name: string;
};

export type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

export type InviteResult = {
  ok: true;
  created: number;
  alreadyOpen: number;
  emailSent: boolean;
} | { ok: false; error: string };

function isMemberRole(value: unknown): value is MemberRole {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

async function resolveSiteOrigin(): Promise<string> {
  const explicit = process.env["NEXT_PUBLIC_SITE_URL"];
  if (explicit) return explicit.replace(/\/+$/, "");
  const hdrs = await headers();
  const origin = hdrs.get("origin");
  if (origin) return origin.replace(/\/+$/, "");
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host");
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  if (host) return `${proto}://${host}`;
  return "http://localhost:3000";
}

/**
 * Return every account on which the caller has the owner role. Used by the
 * invite form to populate the "share these accounts" selector.
 */
export async function listOwnerAccounts(): Promise<ActionResult<OwnerAccount[]>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Non authentifié." };

  // Read memberships first (RLS-restricted to accounts I can see), filter on
  // owner role for my user id. Could also join accounts in one round-trip
  // via PostgREST, but two queries keep the types simple and there's
  // typically a handful of accounts per user.
  const { data: memberships, error: memErr } = await supabase
    .from("account_memberships")
    .select("account_id, role")
    .eq("user_id", user.id)
    .eq("role", "owner");
  if (memErr) return { ok: false, error: memErr.message };

  const accountIds = (memberships ?? []).map((m) => m.account_id);
  if (accountIds.length === 0) return { ok: true, value: [] };

  const { data: accounts, error: accErr } = await supabase
    .from("accounts")
    .select("id, name")
    .in("id", accountIds)
    .order("created_at", { ascending: true });
  if (accErr) return { ok: false, error: accErr.message };

  return {
    ok: true,
    value: (accounts ?? []).map((a) => ({ id: a.id, name: a.name })),
  };
}

/**
 * Return materialized + pending members of the given account. The caller
 * must be a member; pending rows are owner-only (RLS), so they only show up
 * when the caller is an owner.
 */
export async function listMembers(
  accountId: string,
): Promise<
  ActionResult<{ members: MemberSummary[]; pending: PendingInvitation[] }>
> {
  if (!isUuid(accountId)) {
    return { ok: false, error: "Identifiant de compte invalide." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Non authentifié." };

  const { data: rows, error } = await supabase
    .from("account_memberships")
    .select("user_id, role, created_at")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: error.message };

  // RLS filters memberships by the caller's accessible accounts — an empty
  // result on a uuid-shaped id means "you can't see this account".
  if (!rows || rows.length === 0) {
    return { ok: false, error: "Compte introuvable ou non accessible." };
  }

  // Pull emails through the admin client (auth.users is not RLS-friendly).
  // Worst case is O(n) round-trips; n is the membership count, which is
  // small in practice.
  const admin = createAdminClient();
  const members: MemberSummary[] = [];
  for (const row of rows) {
    let email: string | null = null;
    const { data: lookup } = await admin.auth.admin.getUserById(row.user_id);
    email = lookup?.user?.email ?? null;
    members.push({
      userId: row.user_id,
      role: row.role as MemberRole,
      email,
      createdAt: row.created_at,
    });
  }

  // Pending invitations are owner-only. We attempt the read with the user
  // client — non-owners get an empty result, which is the correct UX (they
  // shouldn't be aware of pending invites they cannot cancel anyway).
  const { data: pendingRows } = await supabase
    .from("pending_memberships")
    .select("id, email, role, invited_at, expires_at, consumed_at")
    .eq("account_id", accountId)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("invited_at", { ascending: true });

  const pending: PendingInvitation[] = (pendingRows ?? []).map((p) => ({
    id: p.id,
    email: p.email,
    role: p.role as MemberRole,
    invitedAt: p.invited_at,
    expiresAt: p.expires_at,
  }));

  return { ok: true, value: { members, pending } };
}

/**
 * Create a pending invitation per selected account and send a single email
 * (invite or magic link) to the invitee. The DB unique index on
 * (lower(email), account_id) WHERE consumed_at IS NULL makes the insert
 * idempotent — re-inviting the same email on the same account is a no-op.
 */
export async function inviteMember(input: {
  email: string;
  accountIds: string[];
  role: MemberRole;
}): Promise<InviteResult> {
  const email = normalizeEmail(input.email ?? "");
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Email invalide." };
  }
  if (!isMemberRole(input.role)) {
    return { ok: false, error: "Rôle invalide." };
  }
  if (!Array.isArray(input.accountIds) || input.accountIds.length === 0) {
    return { ok: false, error: "Sélectionne au moins un compte à partager." };
  }
  const accountIds = Array.from(new Set(input.accountIds.map((id) => id.trim())));
  for (const id of accountIds) {
    if (!isUuid(id)) return { ok: false, error: "Identifiant de compte invalide." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Non authentifié." };

  // Every targeted account must be owned by the caller. Resolve via the
  // owner-only memberships row — anything missing means "not owner" and
  // refuses the whole batch.
  const { data: ownerRows, error: ownerErr } = await supabase
    .from("account_memberships")
    .select("account_id")
    .eq("user_id", user.id)
    .eq("role", "owner")
    .in("account_id", accountIds);
  if (ownerErr) return { ok: false, error: ownerErr.message };
  const ownedSet = new Set((ownerRows ?? []).map((r) => r.account_id));
  for (const id of accountIds) {
    if (!ownedSet.has(id)) {
      return {
        ok: false,
        error: "Tu dois être propriétaire de chaque compte sélectionné.",
      };
    }
  }

  // Insert pending rows. The partial unique index makes a duplicate open
  // invitation a no-op (ignoreDuplicates), so we count how many actually
  // landed vs. were already there.
  const payload = accountIds.map((accountId) => ({
    email,
    account_id: accountId,
    role: input.role,
    invited_by: user.id,
  }));
  const { data: inserted, error: insErr } = await supabase
    .from("pending_memberships")
    .upsert(payload, {
      onConflict: "email,account_id",
      ignoreDuplicates: true,
    })
    .select("id");
  if (insErr) return { ok: false, error: insErr.message };

  const created = inserted?.length ?? 0;
  const alreadyOpen = accountIds.length - created;

  // Send a single email — either an invite (new user) or a magic link
  // (existing user). Email sending is best-effort: even when it fails, the
  // pending rows are in place and the invitee will be materialised at next
  // sign-in via the auth callback.
  const admin = createAdminClient();
  const origin = await resolveSiteOrigin();
  const redirectTo = `${origin}/auth/callback?next=/portfolio`;

  let emailSent = false;
  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
  });
  if (!inviteErr) {
    emailSent = true;
  } else {
    // inviteUserByEmail fails when the user already exists. Fall back to a
    // magic link so the existing user gets notified and lands on the auth
    // callback (which then materialises the new memberships).
    const anonClient = await createClient();
    const { error: otpErr } = await anonClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });
    if (!otpErr) emailSent = true;
  }

  revalidatePath("/settings/accounts");
  return { ok: true, created, alreadyOpen, emailSent };
}

async function assertOwner(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  accountId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("account_memberships")
    .select("role")
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data || data.role !== "owner") {
    return { ok: false, error: "Réservé aux propriétaires du compte." };
  }
  return { ok: true };
}

async function countOtherOwners(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  excludeUserId: string,
): Promise<number> {
  const { count } = await supabase
    .from("account_memberships")
    .select("user_id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("role", "owner")
    .neq("user_id", excludeUserId);
  return count ?? 0;
}

/**
 * Remove a member from an account. Refuses to drop the last owner —
 * the DB trigger from LOT 1 enforces the same invariant, but checking
 * here lets us return a clean French error instead of a Postgres one.
 */
export async function revokeMember(
  accountId: string,
  userId: string,
): Promise<ActionResult> {
  if (!isUuid(accountId)) return { ok: false, error: "Identifiant de compte invalide." };
  if (!isUuid(userId)) return { ok: false, error: "Identifiant utilisateur invalide." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Non authentifié." };

  const ownerCheck = await assertOwner(supabase, user.id, accountId);
  if (!ownerCheck.ok) return ownerCheck;

  const { data: target, error: targetErr } = await supabase
    .from("account_memberships")
    .select("role")
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (targetErr) return { ok: false, error: targetErr.message };
  if (!target) return { ok: false, error: "Membre introuvable." };

  if (target.role === "owner") {
    const others = await countOtherOwners(supabase, accountId, userId);
    if (others === 0) {
      return { ok: false, error: "Impossible de retirer le dernier propriétaire." };
    }
  }

  const { error: delErr } = await supabase
    .from("account_memberships")
    .delete()
    .eq("account_id", accountId)
    .eq("user_id", userId);
  if (delErr) return { ok: false, error: delErr.message };

  revalidatePath("/settings/accounts");
  return { ok: true };
}

/**
 * Change a member's role. Mirrors `revokeMember`'s last-owner check before
 * demoting an owner — same belt-and-suspenders as the DB trigger.
 */
export async function updateMemberRole(
  accountId: string,
  userId: string,
  role: MemberRole,
): Promise<ActionResult> {
  if (!isUuid(accountId)) return { ok: false, error: "Identifiant de compte invalide." };
  if (!isUuid(userId)) return { ok: false, error: "Identifiant utilisateur invalide." };
  if (!isMemberRole(role)) return { ok: false, error: "Rôle invalide." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Non authentifié." };

  const ownerCheck = await assertOwner(supabase, user.id, accountId);
  if (!ownerCheck.ok) return ownerCheck;

  const { data: target, error: targetErr } = await supabase
    .from("account_memberships")
    .select("role")
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (targetErr) return { ok: false, error: targetErr.message };
  if (!target) return { ok: false, error: "Membre introuvable." };

  if (target.role === "owner" && role !== "owner") {
    const others = await countOtherOwners(supabase, accountId, userId);
    if (others === 0) {
      return { ok: false, error: "Impossible de dégrader le dernier propriétaire." };
    }
  }

  const { error: updErr } = await supabase
    .from("account_memberships")
    .update({ role })
    .eq("account_id", accountId)
    .eq("user_id", userId);
  if (updErr) return { ok: false, error: updErr.message };

  revalidatePath("/settings/accounts");
  return { ok: true };
}

/**
 * Cancel a pending invitation. RLS already restricts the delete to the
 * account owner (`pending owner delete`), so we don't need to re-check.
 */
export async function cancelInvitation(pendingId: string): Promise<ActionResult> {
  if (!isUuid(pendingId)) return { ok: false, error: "Identifiant invalide." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Non authentifié." };

  const { data, error } = await supabase
    .from("pending_memberships")
    .delete()
    .eq("id", pendingId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "Invitation introuvable ou non autorisée." };
  }

  revalidatePath("/settings/accounts");
  return { ok: true };
}

/**
 * Redeem every open pending invitation for `email` as memberships on `userId`.
 * Called from the auth callback after `exchangeCodeForSession` succeeds. Uses
 * the admin client so the RPC runs with privileges that can read the
 * owner-only `pending_memberships` rows.
 *
 * Returns the first joined `account_id` so the caller can park it in the
 * `gainvest_active_account` cookie, or `null` when nothing was redeemed.
 */
export async function materializeInvitations(
  userId: string,
  email: string,
): Promise<string | null> {
  if (!isUuid(userId)) return null;
  const normalized = normalizeEmail(email);
  if (!EMAIL_RE.test(normalized)) return null;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("consume_pending_memberships", {
    invitee: userId,
    invitee_email: normalized,
  });
  if (error) {
    console.error("materializeInvitations: RPC failed", error);
    return null;
  }
  if (!data || data.length === 0) return null;
  return data[0]?.account_id ?? null;
}
