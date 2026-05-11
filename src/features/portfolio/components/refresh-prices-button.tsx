"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";

import { refreshPrices } from "../actions";

export function RefreshPricesButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    startTransition(async () => {
      try {
        await refreshPrices({ force: true });
        router.refresh();
      } catch {
        // best-effort: silently swallow, user can retry
      }
    });
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={pending}
      aria-label="Rafraîchir les cours"
    >
      <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} />
      {pending ? "Mise à jour…" : "Rafraîchir"}
    </Button>
  );
}
