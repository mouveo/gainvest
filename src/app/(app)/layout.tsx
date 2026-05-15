import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { LogoutButton } from "./logout-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-border border-b">
        <div className="mx-auto flex w-full items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/portfolio" className="text-sm font-medium tracking-tight">
              Gainvest
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link
                href="/portfolio"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Portefeuille
              </Link>
              <Link
                href="/settings/accounts"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Comptes
              </Link>
            </nav>
          </div>
          <LogoutButton email={user.email} />
        </div>
      </header>
      <main className="mx-auto w-full flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
