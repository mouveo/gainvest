"use client";

import { Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  cancelInvitation,
  revokeMember,
  updateMemberRole,
  type MemberRole,
  type MemberSummary,
  type OwnerAccount,
  type PendingInvitation,
} from "../actions";

import { InviteMemberDialog } from "./invite-member-dialog";
import { buildSharingViewModel, canActOnMember } from "./view-model";

const ROLE_LABEL: Record<MemberRole, string> = {
  owner: "Propriétaire",
  editor: "Éditeur",
  viewer: "Lecteur",
};

const ROLE_VARIANT: Record<MemberRole, "default" | "secondary" | "outline"> = {
  owner: "default",
  editor: "secondary",
  viewer: "outline",
};

type Props = {
  currentUserId: string | null;
  activeAccountId: string | null;
  activeAccountName: string | null;
  isCallerOwner: boolean;
  members: MemberSummary[];
  pending: PendingInvitation[];
  membersError: string | null;
  ownerAccounts: OwnerAccount[];
};

export function SharingManager(props: Props) {
  const vm = buildSharingViewModel({
    activeAccountId: props.activeAccountId,
    currentUserId: props.currentUserId,
    isCallerOwner: props.isCallerOwner,
    members: props.members,
    ownerAccounts: props.ownerAccounts,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs uppercase tracking-wide">
            Compte actif
          </span>
          <span className="font-medium">
            {props.activeAccountName ?? "Tous les comptes"}
          </span>
        </div>
        {vm.canInvite ? (
          <InviteMemberDialog
            invitableAccounts={vm.invitableAccounts}
            defaultAccountIds={vm.defaultInviteAccountIds}
          />
        ) : null}
      </div>

      {vm.mode === "no-active-account" ? (
        <p className="text-muted-foreground rounded-md border bg-muted/30 p-3 text-sm">
          Sélectionne un compte spécifique pour voir ses membres. En mode
          “Tous les comptes”, choisis un compte dans le sélecteur en haut.
        </p>
      ) : null}

      {props.membersError ? (
        <p className="text-danger rounded-md border border-danger/20 bg-danger/5 p-3 text-sm">
          {props.membersError}
        </p>
      ) : null}

      {vm.mode === "ready" && props.activeAccountId ? (
        <>
          <MembersTable
            accountId={props.activeAccountId}
            members={props.members}
            currentUserId={props.currentUserId}
            isCallerOwner={props.isCallerOwner}
            callerIsLastOwner={vm.callerIsLastOwner}
          />
          {props.isCallerOwner ? (
            <PendingTable
              pending={props.pending}
            />
          ) : null}
        </>
      ) : null}

      {!vm.canInvite && vm.mode !== "no-active-account" ? (
        <p className="text-muted-foreground text-xs">
          Tu n&apos;es pas propriétaire de ce compte — l&apos;invitation et la
          gestion des accès sont réservées aux propriétaires.
        </p>
      ) : null}
    </div>
  );
}

function MembersTable({
  accountId,
  members,
  currentUserId,
  isCallerOwner,
  callerIsLastOwner,
}: {
  accountId: string;
  members: MemberSummary[];
  currentUserId: string | null;
  isCallerOwner: boolean;
  callerIsLastOwner: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold tracking-tight">Membres</h2>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead>Ajouté le</TableHead>
              <TableHead className="w-32 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-muted-foreground text-center text-sm"
                >
                  Aucun membre — invite quelqu&apos;un pour démarrer.
                </TableCell>
              </TableRow>
            ) : (
              members.map((member) => (
                <MemberRow
                  key={member.userId}
                  accountId={accountId}
                  member={member}
                  isCallerOwner={isCallerOwner}
                  isSelf={member.userId === currentUserId}
                  callerIsLastOwner={callerIsLastOwner}
                  canAct={canActOnMember({
                    isCallerOwner,
                    target: member,
                    currentUserId,
                    callerIsLastOwner,
                  })}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function MemberRow({
  accountId,
  member,
  isCallerOwner,
  isSelf,
  callerIsLastOwner,
  canAct,
}: {
  accountId: string;
  member: MemberSummary;
  isCallerOwner: boolean;
  isSelf: boolean;
  callerIsLastOwner: boolean;
  canAct: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleRoleChange = (next: string | null) => {
    if (!next) return;
    setError(null);
    startTransition(async () => {
      const res = await updateMemberRole(accountId, member.userId, next as MemberRole);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const handleRevoke = () => {
    setError(null);
    startTransition(async () => {
      const res = await revokeMember(accountId, member.userId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <>
      <TableRow>
        <TableCell>
          <span className="font-medium">{member.email ?? "(email inconnu)"}</span>
          {isSelf ? (
            <span className="text-muted-foreground ml-2 text-xs">(toi)</span>
          ) : null}
        </TableCell>
        <TableCell>
          {isCallerOwner && canAct ? (
            <Select
              value={member.role}
              onValueChange={handleRoleChange}
              disabled={pending}
            >
              <SelectTrigger size="sm" aria-label={`Rôle de ${member.email ?? member.userId}`}>
                <SelectValue>
                  {(v: string) => ROLE_LABEL[v as MemberRole] ?? v}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">Propriétaire</SelectItem>
                <SelectItem value="editor">Éditeur</SelectItem>
                <SelectItem value="viewer">Lecteur</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Badge variant={ROLE_VARIANT[member.role]}>{ROLE_LABEL[member.role]}</Badge>
          )}
        </TableCell>
        <TableCell className="text-muted-foreground tabular-nums">
          {new Date(member.createdAt).toLocaleDateString("fr-FR")}
        </TableCell>
        <TableCell className="text-right">
          {isCallerOwner && canAct ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleRevoke}
              disabled={pending}
              aria-label={`Retirer ${member.email ?? member.userId}`}
              title={
                isSelf && callerIsLastOwner
                  ? "Tu es le dernier propriétaire — impossible de te retirer."
                  : "Retirer le membre"
              }
            >
              <Trash2 className="size-4" />
            </Button>
          ) : null}
        </TableCell>
      </TableRow>
      {error ? (
        <TableRow>
          <TableCell colSpan={4} className="text-danger text-xs">
            {error}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function PendingTable({ pending }: { pending: PendingInvitation[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold tracking-tight">Invitations en attente</h2>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead>Envoyée le</TableHead>
              <TableHead>Expire le</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pending.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-muted-foreground text-center text-sm"
                >
                  Aucune invitation en attente.
                </TableCell>
              </TableRow>
            ) : (
              pending.map((row) => <PendingRow key={row.id} row={row} />)
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function PendingRow({ row }: { row: PendingInvitation }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleCancel = () => {
    setError(null);
    startTransition(async () => {
      const res = await cancelInvitation(row.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <>
      <TableRow>
        <TableCell className="font-medium">{row.email}</TableCell>
        <TableCell>
          <Badge variant={ROLE_VARIANT[row.role]}>{ROLE_LABEL[row.role]}</Badge>
        </TableCell>
        <TableCell className="text-muted-foreground tabular-nums">
          {new Date(row.invitedAt).toLocaleDateString("fr-FR")}
        </TableCell>
        <TableCell className="text-muted-foreground tabular-nums">
          {new Date(row.expiresAt).toLocaleDateString("fr-FR")}
        </TableCell>
        <TableCell className="text-right">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleCancel}
            disabled={pending}
            aria-label={`Annuler l'invitation pour ${row.email}`}
            title="Annuler l'invitation"
          >
            <X className="size-4" />
          </Button>
        </TableCell>
      </TableRow>
      {error ? (
        <TableRow>
          <TableCell colSpan={5} className="text-danger text-xs">
            {error}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

