import type { Metadata } from "next";

import { getActiveAccount } from "@/features/accounts/active";
import { ALL_ACCOUNTS } from "@/features/accounts/constants";
import { listAccounts } from "@/features/accounts/queries";
import {
  listMembers,
  listOwnerAccounts,
  type MemberSummary,
  type OwnerAccount,
  type PendingInvitation,
} from "@/features/sharing/actions";
import { SharingManager } from "@/features/sharing/components/sharing-manager";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Partage",
};

export const dynamic = "force-dynamic";

export default async function SharingSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Resolve the caller's view: which accounts they can manage as owner,
  // which account is "active" (and therefore which membership table to show).
  const active = await getActiveAccount();
  const accounts = await listAccounts();
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const ownerResult = await listOwnerAccounts();
  const ownerAccounts: OwnerAccount[] = ownerResult.ok ? ownerResult.value : [];
  const ownerIds = new Set(ownerAccounts.map((a) => a.id));

  // ALL is not a single-account view — there's nothing concrete to list.
  // We surface a guidance message via empty `members`/`pending` and an
  // "isSelectionRequired" flag the client component reads.
  let activeAccountId: string | null = active === ALL_ACCOUNTS ? null : active;
  let activeAccountName: string | null = null;
  let members: MemberSummary[] = [];
  let pending: PendingInvitation[] = [];
  let membersError: string | null = null;

  if (activeAccountId) {
    activeAccountName = accountById.get(activeAccountId)?.name ?? null;
    const res = await listMembers(activeAccountId);
    if (res.ok) {
      members = res.value.members;
      pending = res.value.pending;
    } else {
      membersError = res.error;
    }
  }

  const isCallerOwner = activeAccountId ? ownerIds.has(activeAccountId) : false;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Partage</h1>
        <p className="text-muted-foreground text-sm">
          Invite quelqu&apos;un sur tes comptes, gère les rôles et révoque les
          accès. Les invitations sont consommées au prochain sign-in du
          destinataire.
        </p>
      </header>
      <SharingManager
        currentUserId={user?.id ?? null}
        activeAccountId={activeAccountId}
        activeAccountName={activeAccountName}
        isCallerOwner={isCallerOwner}
        members={members}
        pending={pending}
        membersError={membersError}
        ownerAccounts={ownerAccounts}
      />
    </div>
  );
}
