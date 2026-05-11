import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const ctaHref = user ? "/portfolio" : "/login";
  const ctaLabel = user ? "Mon portefeuille" : "Se connecter";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start justify-center gap-6 px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">Gainvest</h1>
      <p className="text-muted-foreground max-w-prose text-lg">
        Suivi d&apos;investissements personnels. Bourse d&apos;abord, crypto et immobilier ensuite.
      </p>
      <Link href={ctaHref} className={buttonVariants()}>
        {ctaLabel}
      </Link>
    </main>
  );
}
