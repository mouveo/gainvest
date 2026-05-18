export const PREFERENCE_SCOPES = [
  "positions",
  "realizations",
  "movements",
  "global",
] as const;

export type PreferenceScope = (typeof PREFERENCE_SCOPES)[number];

export type PreferencePayload = Record<string, unknown>;

export function isPreferenceScope(value: unknown): value is PreferenceScope {
  return (
    typeof value === "string" && (PREFERENCE_SCOPES as readonly string[]).includes(value)
  );
}
