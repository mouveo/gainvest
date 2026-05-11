"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { refreshPrices } from "../actions";

const TTL_MS = 5 * 60 * 1000;

type AutoRefreshPricesProps = {
  pricesUpdatedAt: string | null;
};

function isStale(pricesUpdatedAt: string | null): boolean {
  if (!pricesUpdatedAt) return true;
  const ts = Date.parse(pricesUpdatedAt);
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts >= TTL_MS;
}

export function AutoRefreshPrices({ pricesUpdatedAt }: AutoRefreshPricesProps) {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    if (!isStale(pricesUpdatedAt)) return;

    started.current = true;
    void (async () => {
      try {
        const result = await refreshPrices();
        if (result.refreshed > 0) router.refresh();
      } catch {
        // best-effort: silently ignore
      }
    })();
  }, [pricesUpdatedAt, router]);

  return null;
}
