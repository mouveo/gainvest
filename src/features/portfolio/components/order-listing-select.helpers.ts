import type { Listing } from "@/lib/quotes";
import { micLabel } from "@/lib/quotes/mic";

import { listingKey } from "./listing-picker.helpers";

export function orderListingKey(mic: string, currency: string): string {
  return listingKey(mic, currency);
}

export function parseOrderListingKey(
  value: string,
): { mic: string; currency: string } | null {
  const [mic, currency] = value.split("\x01");
  if (!mic || !currency) return null;
  return { mic, currency };
}

export function formatOrderListingLabel(listing: Listing): string {
  const head = `${listing.mic} · ${micLabel(listing.mic)} · ${listing.currency}`;
  if (listing.previousClose == null) return head;
  return `${head} · ${formatPrice(listing.previousClose)}`;
}

function formatPrice(n: number): string {
  return n.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
