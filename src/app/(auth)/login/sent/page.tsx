import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Lien envoyé",
};

export default async function SentPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Lien envoyé</CardTitle>
          <CardDescription>
            On vient d&apos;envoyer un lien à <strong>{email ?? "ton email"}</strong>. Clique dessus
            pour te connecter.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            En dev local, le mail arrive dans Mailpit :{" "}
            <a href="http://127.0.0.1:54324" target="_blank" rel="noreferrer" className="underline">
              http://127.0.0.1:54324
            </a>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
