"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

import { signOut } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" size="sm" disabled={pending}>
      {pending ? "Déconnexion…" : "Se déconnecter"}
    </Button>
  );
}

export function LogoutButton({ email }: { email: string | null | undefined }) {
  return (
    <form action={signOut} className="flex items-center gap-3">
      {email ? <span className="text-muted-foreground text-sm">{email}</span> : null}
      <SubmitButton />
    </form>
  );
}
