"use client";

import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { inviteMember, type MemberRole, type OwnerAccount } from "../actions";

import { validateInviteForm } from "./view-model";

type Props = {
  invitableAccounts: OwnerAccount[];
  defaultAccountIds: string[];
};

const ROLE_LABEL: Record<MemberRole, string> = {
  owner: "Propriétaire",
  editor: "Éditeur",
  viewer: "Lecteur",
};

export function InviteMemberDialog({ invitableAccounts, defaultAccountIds }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("viewer");
  const [accountIds, setAccountIds] = useState<string[]>(defaultAccountIds);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleAccount = (id: string) => {
    setAccountIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const reset = () => {
    setEmail("");
    setRole("viewer");
    setAccountIds(defaultAccountIds);
    setError(null);
    setStatus(null);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setStatus(null);

    const localValidation = validateInviteForm({ email, accountIds, role });
    if (!localValidation.ok) {
      setError(localValidation.error);
      return;
    }

    startTransition(async () => {
      const res = await inviteMember({ email, accountIds, role });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const summary = `${res.created} invitation(s) créée(s), ${res.alreadyOpen} déjà ouverte(s)${
        res.emailSent ? " — email envoyé." : " — email non envoyé."
      }`;
      setStatus(summary);
      router.refresh();
    });
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={<Button size="sm" variant="default" />}
      >
        <UserPlus className="size-4" />
        Inviter
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Inviter un membre</DialogTitle>
          <DialogDescription>
            Un email avec un lien magique sera envoyé. L&apos;invitation est
            matérialisée à la prochaine connexion du destinataire.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="prenom@example.com"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-role">Rôle</Label>
            <Select value={role} onValueChange={(v) => v && setRole(v as MemberRole)}>
              <SelectTrigger id="invite-role">
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
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Comptes à partager</legend>
            {invitableAccounts.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Aucun compte où tu peux inviter — tu dois être propriétaire.
              </p>
            ) : (
              invitableAccounts.map((account) => {
                const checked = accountIds.includes(account.id);
                return (
                  <label
                    key={account.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={checked}
                      onChange={() => toggleAccount(account.id)}
                      aria-label={`Partager ${account.name}`}
                    />
                    <span>{account.name}</span>
                  </label>
                );
              })
            )}
          </fieldset>
          {error ? (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          ) : null}
          {status ? (
            <p className="text-success text-sm">{status}</p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={pending || invitableAccounts.length === 0}>
              {pending ? "Envoi…" : "Envoyer l'invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
