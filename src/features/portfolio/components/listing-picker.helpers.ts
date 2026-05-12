export function formatPreferredLabel(
  mic: string | null | undefined,
  currency: string | null | undefined,
): string {
  if (!mic) return "Auto";
  if (!currency) return mic;
  return `${mic} / ${currency}`;
}

export function listingKey(mic: string, currency: string): string {
  return `${mic}\x01${currency}`;
}
