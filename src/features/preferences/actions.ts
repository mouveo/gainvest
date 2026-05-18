"use server";

import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

import {
  isPreferenceScope,
  type PreferencePayload,
  type PreferenceScope,
} from "./constants";

/**
 * Read the current user's preference payload for a given scope. Returns
 * `null` when the user has no row yet (so the caller can fall back to a
 * default / migrate from localStorage), or the parsed JSON payload.
 *
 * RLS already restricts the SELECT to the caller's own row — we still
 * pass `auth.uid()` through the session, no admin client needed.
 */
export async function getUserPreference(
  scope: PreferenceScope,
): Promise<PreferencePayload | null> {
  if (!isPreferenceScope(scope)) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("user_preferences")
    .select("payload")
    .eq("user_id", user.id)
    .eq("scope", scope)
    .maybeSingle();
  if (error) {
    console.error("getUserPreference: read failed", error);
    return null;
  }
  if (!data) return null;
  const payload = data.payload as PreferencePayload | null;
  if (!payload || typeof payload !== "object") return null;
  return payload;
}

/**
 * Merge `patch` into the user's payload for `scope`. Other keys in the
 * same scope are preserved — a patch on `columns` won't drop a stored
 * `filters` / `toggles` / `search`. Implemented as read-modify-write so we
 * stay portable across deployments that don't expose `jsonb_set`-style RPC.
 *
 * Two near-simultaneous writes can still race (last-write-wins on the
 * upsert). The debounce on the client side mitigates the typical case;
 * cross-tab racing is treated as a known limitation.
 */
export async function setUserPreference(
  scope: PreferenceScope,
  patch: PreferencePayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isPreferenceScope(scope)) {
    return { ok: false, error: "Scope invalide." };
  }
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { ok: false, error: "Patch invalide." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Non authentifié." };

  const { data: existing, error: readErr } = await supabase
    .from("user_preferences")
    .select("payload")
    .eq("user_id", user.id)
    .eq("scope", scope)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };

  const existingPayload: PreferencePayload =
    existing?.payload && typeof existing.payload === "object" && !Array.isArray(existing.payload)
      ? (existing.payload as PreferencePayload)
      : {};

  const merged: PreferencePayload = { ...existingPayload, ...patch };

  const { error: upsertErr } = await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: user.id,
        scope,
        // PreferencePayload is structurally `Record<string, unknown>` so it
        // is narrower than Supabase's recursive `Json` — the cast is safe
        // because the values we ship are JSON-serialisable by construction
        // (toggles, column maps, filter strings, search text).
        payload: merged as unknown as Json,
      },
      { onConflict: "user_id,scope" },
    );
  if (upsertErr) return { ok: false, error: upsertErr.message };

  return { ok: true };
}
