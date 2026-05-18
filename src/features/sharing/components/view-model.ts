import type { MemberRole, MemberSummary, OwnerAccount } from "../actions";

export type SharingViewModel = {
  /** UI mode for the page-level shell. */
  mode:
    | "no-active-account"
    | "no-permission"
    | "ready";
  /** Whether the invite CTA should be rendered. */
  canInvite: boolean;
  /** Accounts the caller is allowed to invite people onto. */
  invitableAccounts: OwnerAccount[];
  /** Default-checked account ids for the dialog (active account when owner). */
  defaultInviteAccountIds: string[];
  /** Whether the caller is the *last* owner — drives the "cannot leave" guard. */
  callerIsLastOwner: boolean;
};

export type ViewModelInput = {
  activeAccountId: string | null;
  currentUserId: string | null;
  isCallerOwner: boolean;
  members: MemberSummary[];
  ownerAccounts: OwnerAccount[];
};

export function buildSharingViewModel(input: ViewModelInput): SharingViewModel {
  const ownerCount = input.members.filter((m) => m.role === "owner").length;
  const callerIsLastOwner =
    !!input.currentUserId &&
    input.isCallerOwner &&
    ownerCount === 1 &&
    input.members.some(
      (m) => m.userId === input.currentUserId && m.role === "owner",
    );

  if (input.activeAccountId == null) {
    return {
      mode: "no-active-account",
      canInvite: input.ownerAccounts.length > 0,
      invitableAccounts: input.ownerAccounts,
      defaultInviteAccountIds: [],
      callerIsLastOwner: false,
    };
  }

  if (!input.isCallerOwner) {
    return {
      mode: input.members.length > 0 ? "ready" : "no-permission",
      canInvite: false,
      invitableAccounts: [],
      defaultInviteAccountIds: [],
      callerIsLastOwner: false,
    };
  }

  return {
    mode: "ready",
    canInvite: input.ownerAccounts.length > 0,
    invitableAccounts: input.ownerAccounts,
    defaultInviteAccountIds: input.ownerAccounts.some((a) => a.id === input.activeAccountId)
      ? [input.activeAccountId]
      : [],
    callerIsLastOwner,
  };
}

/**
 * Decide whether the caller should see role-changing controls for a given
 * member row. Owners can act on everyone except themselves when they are the
 * last owner.
 */
export function canActOnMember(args: {
  isCallerOwner: boolean;
  target: MemberSummary;
  currentUserId: string | null;
  callerIsLastOwner: boolean;
}): boolean {
  if (!args.isCallerOwner) return false;
  if (args.target.userId === args.currentUserId && args.callerIsLastOwner) {
    return false;
  }
  return true;
}

export function validateInviteForm(input: {
  email: string;
  accountIds: string[];
  role: MemberRole;
}): { ok: true } | { ok: false; error: string } {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Email invalide." };
  }
  if (input.accountIds.length === 0) {
    return { ok: false, error: "Sélectionne au moins un compte à partager." };
  }
  return { ok: true };
}
