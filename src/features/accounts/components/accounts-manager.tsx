"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  createAccount,
  deleteAccount,
  renameAccount,
  updateAccount,
} from "../actions";
import { ACCOUNT_TYPES, type AccountType } from "../constants";
import type { AccountWithTransactionCount } from "../queries";

const TYPE_LABELS: Record<AccountType, string> = {
  pea: "PEA",
  pea_pme: "PEA-PME",
  cto: "CTO",
  av: "Assurance vie",
  per: "PER",
  livret: "Livret",
  crypto: "Crypto",
  real_estate: "Immobilier",
  other: "Autre",
};

type Props = {
  accounts: AccountWithTransactionCount[];
};

export function AccountsManager({ accounts }: Props) {
  const isLastAccount = accounts.length <= 1;

  return (
    <div className="flex flex-col gap-6">
      <NewAccountForm />
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Opérateur</TableHead>
              <TableHead>Devise</TableHead>
              <TableHead className="text-right">Transactions</TableHead>
              <TableHead className="w-32 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground text-center text-sm">
                  Aucun compte pour l&apos;instant.
                </TableCell>
              </TableRow>
            ) : (
              accounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  isLastAccount={isLastAccount}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function NewAccountForm() {
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("cto");
  const [broker, setBroker] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createAccount({ name, type, broker, currency });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
      setBroker("");
      setType("cto");
      setCurrency("EUR");
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-muted/30 flex flex-col gap-3 rounded-lg border p-4"
    >
      <h2 className="text-sm font-semibold tracking-tight">Nouveau compte</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-account-name">Nom</Label>
          <Input
            id="new-account-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Société Mouveo"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-account-type">Type</Label>
          <Select value={type} onValueChange={(v) => v && setType(v as AccountType)}>
            <SelectTrigger id="new-account-type">
              <SelectValue>{(v: string) => TYPE_LABELS[v as AccountType] ?? v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ACCOUNT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-account-broker">Opérateur</Label>
          <Input
            id="new-account-broker"
            value={broker}
            onChange={(e) => setBroker(e.target.value)}
            placeholder="Bourse Direct"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-account-currency">Devise</Label>
          <Input
            id="new-account-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            placeholder="EUR"
            maxLength={3}
            className="font-mono"
            required
          />
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          <Plus className="size-4" />
          {pending ? "Ajout…" : "Ajouter le compte"}
        </Button>
      </div>
    </form>
  );
}

type AccountRowProps = {
  account: AccountWithTransactionCount;
  isLastAccount: boolean;
};

function AccountRow({ account, isLastAccount }: AccountRowProps) {
  const [name, setName] = useState(account.name);
  const [type, setType] = useState<AccountType>(account.type as AccountType);
  const [broker, setBroker] = useState(account.broker ?? "");
  const [currency, setCurrency] = useState(account.currency);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty =
    name !== account.name ||
    type !== (account.type as AccountType) ||
    (broker || "") !== (account.broker ?? "") ||
    currency !== account.currency;

  const hasTransactions = account.transaction_count > 0;
  const deleteDisabled = isLastAccount || hasTransactions;
  const deleteHint = isLastAccount
    ? "Impossible : c'est le dernier compte."
    : hasTransactions
      ? "Impossible : ce compte a des transactions liées."
      : "Supprimer le compte";

  const saveRename = () => {
    setError(null);
    startTransition(async () => {
      const result = await renameAccount(account.id, name);
      if (!result.ok) setError(result.error);
    });
  };

  const saveAll = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateAccount(account.id, { name, type, broker, currency });
      if (!result.ok) setError(result.error);
    });
  };

  const remove = () => {
    setError(null);
    startTransition(async () => {
      const result = await deleteAccount(account.id);
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <>
      <TableRow>
        <TableCell>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name !== account.name && name.trim()) saveRename();
            }}
            className="h-8"
            aria-label={`Renommer ${account.name}`}
          />
        </TableCell>
        <TableCell>
          <Select value={type} onValueChange={(v) => v && setType(v as AccountType)}>
            <SelectTrigger size="sm">
              <SelectValue>
                {(v: string) => TYPE_LABELS[v as AccountType] ?? v}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ACCOUNT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell>
          <Input
            value={broker}
            onChange={(e) => setBroker(e.target.value)}
            placeholder="—"
            className="h-8"
          />
        </TableCell>
        <TableCell>
          <Input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            className="h-8 w-20 font-mono"
          />
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {account.transaction_count}
        </TableCell>
        <TableCell className="flex justify-end gap-1">
          {dirty ? (
            <Button type="button" size="sm" onClick={saveAll} disabled={pending}>
              {pending ? "…" : "Enregistrer"}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={remove}
            disabled={deleteDisabled || pending}
            title={deleteHint}
            aria-label={deleteHint}
          >
            <Trash2 className="size-4" />
          </Button>
        </TableCell>
      </TableRow>
      {error ? (
        <TableRow>
          <TableCell colSpan={6} className="text-danger text-xs">
            {error}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
