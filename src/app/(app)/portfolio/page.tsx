import type { Metadata } from "next";

import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Portefeuille",
};

export default async function PortfolioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Portefeuille</h1>
        <p className="text-muted-foreground text-sm">Connecté en tant que {user?.email}.</p>
      </header>
      <p className="text-muted-foreground">
        Aucune ligne pour l&apos;instant — c&apos;est ici qu&apos;on construira la suite (comptes,
        transactions, valuations).
      </p>
    </div>
  );
}
