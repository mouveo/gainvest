import { describe, expect, it } from "vitest";

import type { MemberSummary, OwnerAccount } from "../actions";

import {
  buildSharingViewModel,
  canActOnMember,
  validateInviteForm,
} from "./view-model";

const ACC_PERSO = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ACC_MOUVEO = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_ALICE = "11111111-1111-1111-1111-111111111111";
const USER_BOB = "22222222-2222-2222-2222-222222222222";

function member(
  overrides: Partial<MemberSummary> & Pick<MemberSummary, "userId" | "role">,
): MemberSummary {
  return {
    email: `${overrides.userId.slice(0, 4)}@example.com`,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function owner(id: string, name: string): OwnerAccount {
  return { id, name };
}

describe("buildSharingViewModel", () => {
  it("returns no-active-account mode when no account is selected", () => {
    const vm = buildSharingViewModel({
      activeAccountId: null,
      currentUserId: USER_ALICE,
      isCallerOwner: false,
      members: [],
      ownerAccounts: [owner(ACC_PERSO, "Perso")],
    });
    expect(vm.mode).toBe("no-active-account");
    expect(vm.canInvite).toBe(true);
    expect(vm.invitableAccounts).toHaveLength(1);
  });

  it("hides the invite CTA for callers that are not owner anywhere", () => {
    const vm = buildSharingViewModel({
      activeAccountId: ACC_PERSO,
      currentUserId: USER_BOB,
      isCallerOwner: false,
      members: [
        member({ userId: USER_ALICE, role: "owner" }),
        member({ userId: USER_BOB, role: "viewer" }),
      ],
      ownerAccounts: [],
    });
    expect(vm.mode).toBe("ready");
    expect(vm.canInvite).toBe(false);
    expect(vm.invitableAccounts).toHaveLength(0);
  });

  it("flags the caller as the last owner when they are the only owner row", () => {
    const vm = buildSharingViewModel({
      activeAccountId: ACC_PERSO,
      currentUserId: USER_ALICE,
      isCallerOwner: true,
      members: [
        member({ userId: USER_ALICE, role: "owner" }),
        member({ userId: USER_BOB, role: "viewer" }),
      ],
      ownerAccounts: [owner(ACC_PERSO, "Perso")],
    });
    expect(vm.callerIsLastOwner).toBe(true);
    expect(vm.defaultInviteAccountIds).toEqual([ACC_PERSO]);
  });

  it("does not flag last-owner when a second owner exists", () => {
    const vm = buildSharingViewModel({
      activeAccountId: ACC_PERSO,
      currentUserId: USER_ALICE,
      isCallerOwner: true,
      members: [
        member({ userId: USER_ALICE, role: "owner" }),
        member({ userId: USER_BOB, role: "owner" }),
      ],
      ownerAccounts: [owner(ACC_PERSO, "Perso")],
    });
    expect(vm.callerIsLastOwner).toBe(false);
  });

  it("pre-checks only the active account when it sits in the owner list", () => {
    const vm = buildSharingViewModel({
      activeAccountId: ACC_PERSO,
      currentUserId: USER_ALICE,
      isCallerOwner: true,
      members: [member({ userId: USER_ALICE, role: "owner" })],
      ownerAccounts: [owner(ACC_PERSO, "Perso"), owner(ACC_MOUVEO, "Mouveo")],
    });
    expect(vm.defaultInviteAccountIds).toEqual([ACC_PERSO]);
    expect(vm.invitableAccounts.map((a) => a.id)).toEqual([ACC_PERSO, ACC_MOUVEO]);
  });
});

describe("canActOnMember", () => {
  it("returns false when the caller is not an owner", () => {
    expect(
      canActOnMember({
        isCallerOwner: false,
        target: member({ userId: USER_BOB, role: "viewer" }),
        currentUserId: USER_ALICE,
        callerIsLastOwner: false,
      }),
    ).toBe(false);
  });

  it("forbids self-action when the caller is the last owner", () => {
    expect(
      canActOnMember({
        isCallerOwner: true,
        target: member({ userId: USER_ALICE, role: "owner" }),
        currentUserId: USER_ALICE,
        callerIsLastOwner: true,
      }),
    ).toBe(false);
  });

  it("allows owners to act on other members", () => {
    expect(
      canActOnMember({
        isCallerOwner: true,
        target: member({ userId: USER_BOB, role: "viewer" }),
        currentUserId: USER_ALICE,
        callerIsLastOwner: true,
      }),
    ).toBe(true);
  });
});

describe("validateInviteForm", () => {
  it("rejects an invalid email", () => {
    expect(
      validateInviteForm({ email: "not-an-email", accountIds: [ACC_PERSO], role: "viewer" }),
    ).toEqual({ ok: false, error: "Email invalide." });
  });

  it("requires at least one account", () => {
    expect(
      validateInviteForm({
        email: "alice@example.com",
        accountIds: [],
        role: "viewer",
      }),
    ).toEqual({ ok: false, error: expect.stringContaining("au moins un") });
  });

  it("accepts a valid form", () => {
    expect(
      validateInviteForm({
        email: "alice@example.com",
        accountIds: [ACC_PERSO],
        role: "owner",
      }),
    ).toEqual({ ok: true });
  });
});
