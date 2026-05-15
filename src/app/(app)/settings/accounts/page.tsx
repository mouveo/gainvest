import type { Metadata } from "next";

import { AccountsManager } from "@/features/accounts/components/accounts-manager";
import { listAccountsWithTransactionCounts } from "@/features/accounts/queries";

export const metadata: Metadata = {
  title: "Comptes",
};

export const dynamic = "force-dynamic";

export default async function AccountsSettingsPage() {
  const accounts = await listAccountsWithTransactionCounts();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Comptes</h1>
        <p className="text-muted-foreground text-sm">
          Ajoute, renomme ou supprime tes comptes. Un compte avec des transactions ne
          peut pas être supprimé tant qu&apos;elles existent.
        </p>
      </header>
      <AccountsManager accounts={accounts} />
    </div>
  );
}
