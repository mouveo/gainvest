"use client";

import { Settings, Share2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { ALL_ACCOUNTS, type ActiveAccount } from "./constants";
import type { Account } from "./queries";

type Props = {
  accounts: Account[];
  currentId: ActiveAccount;
};

export function AccountSwitcher({ accounts, currentId }: Props) {
  const router = useRouter();
  const [value, setValue] = useState<string>(currentId);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const labelByValue = new Map<string, string>([
    [ALL_ACCOUNTS, "Tous les comptes"],
    ...accounts.map((a) => [a.id, a.name] as const),
  ]);

  const onValueChange = (next: string | null) => {
    if (!next || next === value) return;
    setError(null);
    const previous = value;
    setValue(next);
    startTransition(async () => {
      try {
        const res = await fetch("/api/active-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: next }),
        });
        const json = (await res.json()) as { ok: boolean; error?: string };
        if (!json.ok) {
          setValue(previous);
          setError(json.error ?? "Erreur");
          return;
        }
        router.refresh();
      } catch {
        setValue(previous);
        setError("Réseau indisponible.");
      }
    });
  };

  return (
    <div className="flex items-center gap-1.5">
      <Select value={value} onValueChange={onValueChange} disabled={pending}>
        <SelectTrigger size="sm" aria-label="Compte actif" className="min-w-44">
          <SelectValue>
            {(v: string) => labelByValue.get(v) ?? v}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_ACCOUNTS}>
            <span>Tous les comptes</span>
          </SelectItem>
          {accounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              <span className="flex flex-col">
                <span className="text-sm">{account.name}</span>
                <span className="text-muted-foreground text-xs">
                  {account.type.toUpperCase()} · {account.currency}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Link
        href="/settings/accounts"
        aria-label="Gérer les comptes"
        title="Gérer les comptes"
        className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
      >
        <Settings className="size-4" />
      </Link>
      <Link
        href="/settings/sharing"
        aria-label="Partager le compte"
        title="Partager le compte"
        className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
      >
        <Share2 className="size-4" />
      </Link>
      {error ? (
        <span role="alert" className="text-danger text-xs">
          {error}
        </span>
      ) : null}
    </div>
  );
}
