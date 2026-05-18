"use server";

import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

import {
  isViewScope,
  mergeViewPayloadWithDefaults,
  normalizeViewPayload,
  validateViewName,
} from "./helpers";
import {
  DEFAULT_VIEW_PAYLOAD,
  type ViewPayload,
  type ViewScope,
} from "./types";

// Postgres unique-violation SQLSTATE — surfaced by Supabase as `error.code`.
// We map it to a UX-friendly message so the dialog can flag the name field.
const PG_UNIQUE_VIOLATION = "23505";

const ERR_AUTH = "Non authentifié.";
const ERR_SCOPE = "Scope invalide.";
const ERR_NAME_EMPTY = "Le nom de la vue est requis.";
const ERR_NAME_TOO_LONG = "Le nom ne peut pas dépasser 80 caractères.";
const ERR_NAME_TAKEN = "Une vue porte déjà ce nom dans ce scope.";
const ERR_NOT_FOUND = "Vue introuvable.";
const ERR_ONLY_DEFAULT = "Impossible de supprimer la dernière vue (par défaut).";

export type SavedViewRow = {
  id: string;
  name: string;
  is_default: boolean;
  payload: ViewPayload;
  updated_at: string;
};

export type ActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

export async function listViews(scope: ViewScope): Promise<SavedViewRow[]> {
  if (!isViewScope(scope)) return [];

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("saved_views")
    .select("id, name, is_default, payload, updated_at")
    .eq("user_id", user.id)
    .eq("scope", scope)
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("listViews: read failed", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    is_default: row.is_default,
    payload: normalizeViewPayload(row.payload),
    updated_at: row.updated_at,
  }));
}

export async function saveAsNewView(input: {
  scope: ViewScope;
  name: string;
  payload: ViewPayload;
}): Promise<ActionResult<{ id: string }>> {
  if (!isViewScope(input.scope)) return { ok: false, error: ERR_SCOPE };

  const nameCheck = validateViewName(input.name);
  if (!nameCheck.ok) {
    return {
      ok: false,
      error: nameCheck.error === "name_empty" ? ERR_NAME_EMPTY : ERR_NAME_TOO_LONG,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: ERR_AUTH };

  // First view in this scope wins the default slot. We check existence
  // (cheap thanks to the (user_id, scope) index) before insert — the
  // partial unique index on is_default guarantees we cannot end up with
  // two defaults even if a race slips through.
  const { data: existing, error: countErr } = await supabase
    .from("saved_views")
    .select("id")
    .eq("user_id", user.id)
    .eq("scope", input.scope)
    .limit(1);
  if (countErr) return { ok: false, error: countErr.message };

  const isFirst = (existing ?? []).length === 0;
  const payload = normalizeViewPayload(input.payload);

  const { data: inserted, error: insertErr } = await supabase
    .from("saved_views")
    .insert({
      user_id: user.id,
      scope: input.scope,
      name: nameCheck.name,
      payload: payload as unknown as Json,
      is_default: isFirst,
    })
    .select("id")
    .single();

  if (insertErr) {
    if ((insertErr as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: ERR_NAME_TAKEN };
    }
    return { ok: false, error: insertErr.message };
  }

  return { ok: true, id: inserted.id };
}

export async function updateView(
  id: string,
  input: { name?: string; payload?: ViewPayload },
): Promise<ActionResult> {
  if (!id || typeof id !== "string") return { ok: false, error: ERR_NOT_FOUND };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: ERR_AUTH };

  const patch: { name?: string; payload?: Json } = {};
  if (input.name !== undefined) {
    const nameCheck = validateViewName(input.name);
    if (!nameCheck.ok) {
      return {
        ok: false,
        error: nameCheck.error === "name_empty" ? ERR_NAME_EMPTY : ERR_NAME_TOO_LONG,
      };
    }
    patch.name = nameCheck.name;
  }
  if (input.payload !== undefined) {
    patch.payload = normalizeViewPayload(input.payload) as unknown as Json;
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error: updateErr, count } = await supabase
    .from("saved_views")
    .update(patch, { count: "exact" })
    .eq("id", id)
    .eq("user_id", user.id);

  if (updateErr) {
    if ((updateErr as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: ERR_NAME_TAKEN };
    }
    return { ok: false, error: updateErr.message };
  }
  if (count !== null && count === 0) return { ok: false, error: ERR_NOT_FOUND };

  return { ok: true };
}

/**
 * Deletion rules:
 *  - Non-default view: always allowed.
 *  - Default view, but other views exist: deletion is allowed and the
 *    most-recently-updated remaining view is promoted to default — keeps
 *    a deterministic "always one default" invariant per (user, scope).
 *  - Default view AND it is the only view in the scope: refused, so the
 *    user cannot end up with zero views. They must rename or replace it.
 */
export async function deleteView(id: string): Promise<ActionResult> {
  if (!id || typeof id !== "string") return { ok: false, error: ERR_NOT_FOUND };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: ERR_AUTH };

  const { data: target, error: readErr } = await supabase
    .from("saved_views")
    .select("id, scope, is_default")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!target) return { ok: false, error: ERR_NOT_FOUND };

  if (target.is_default) {
    const { data: siblings, error: sibErr } = await supabase
      .from("saved_views")
      .select("id")
      .eq("user_id", user.id)
      .eq("scope", target.scope)
      .neq("id", id)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (sibErr) return { ok: false, error: sibErr.message };

    const promotion = (siblings ?? [])[0];
    if (!promotion) return { ok: false, error: ERR_ONLY_DEFAULT };

    // Flip the new default first; the partial unique index would reject
    // two defaults simultaneously, but the target is about to be deleted
    // so we clear its flag in the same step before promoting.
    const { error: clearErr } = await supabase
      .from("saved_views")
      .update({ is_default: false })
      .eq("id", id)
      .eq("user_id", user.id);
    if (clearErr) return { ok: false, error: clearErr.message };

    const { error: promoErr } = await supabase
      .from("saved_views")
      .update({ is_default: true })
      .eq("id", promotion.id)
      .eq("user_id", user.id);
    if (promoErr) return { ok: false, error: promoErr.message };
  }

  const { error: delErr } = await supabase
    .from("saved_views")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (delErr) return { ok: false, error: delErr.message };

  return { ok: true };
}

export async function setDefaultView(id: string): Promise<ActionResult> {
  if (!id || typeof id !== "string") return { ok: false, error: ERR_NOT_FOUND };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: ERR_AUTH };

  // Atomic: the RPC clears the previous default and sets the new one in
  // a single statement, sidestepping the partial unique index's
  // "no two defaults" check.
  const { error } = await supabase.rpc("set_default_saved_view", { target_id: id });
  if (error) {
    if (error.message?.includes("saved_view_not_found")) {
      return { ok: false, error: ERR_NOT_FOUND };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

const SCOPED_PREFERENCE_KEYS = [
  "columns",
  "filters",
  "search",
  "sort",
  "pagination",
  "activeViewId",
] as const;

// View payloads use logical names (`withDividends`); `user_preferences.global`
// stores `pnlWithDividends` (the legacy key the toggle hook reads). Map both
// directions here so the server write stays consistent with what
// `usePnlMode()` / `useNetOfFeesMode()` / `useInflationMode()` reads back.
const GLOBAL_TOGGLE_KEY_MAP = {
  withDividends: "pnlWithDividends",
  netOfFees: "netOfFees",
  inflationAdjusted: "inflationAdjusted",
} as const satisfies Record<string, string>;

/**
 * Load a view and write its payload into `user_preferences`:
 *  - scoped row gets columns/filters/search/sort/pagination + activeViewId
 *  - global row gets the toggle subset (only the keys actually present)
 *
 * Returns `{ payload, scope }` so the caller can sync local state without
 * waiting on a refetch.
 */
export async function applyView(
  id: string,
): Promise<ActionResult<{ payload: ViewPayload; scope: ViewScope }>> {
  if (!id || typeof id !== "string") return { ok: false, error: ERR_NOT_FOUND };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: ERR_AUTH };

  const { data: view, error: readErr } = await supabase
    .from("saved_views")
    .select("scope, payload")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!view) return { ok: false, error: ERR_NOT_FOUND };
  if (!isViewScope(view.scope)) return { ok: false, error: ERR_SCOPE };

  const payload = mergeViewPayloadWithDefaults(
    normalizeViewPayload(view.payload),
    DEFAULT_VIEW_PAYLOAD,
  );

  const scopedPayload: Record<string, unknown> = {
    columns: payload.columns,
    filters: payload.filters,
    search: payload.search,
    sort: payload.sort,
    activeViewId: id,
  };
  if (payload.pagination) scopedPayload.pagination = payload.pagination;

  // Read-modify-write to preserve sibling keys not managed by views.
  const { data: existingScoped, error: existingErr } = await supabase
    .from("user_preferences")
    .select("payload")
    .eq("user_id", user.id)
    .eq("scope", view.scope)
    .maybeSingle();
  if (existingErr) return { ok: false, error: existingErr.message };

  const baseScoped: Record<string, unknown> =
    existingScoped?.payload && typeof existingScoped.payload === "object" && !Array.isArray(existingScoped.payload)
      ? (existingScoped.payload as Record<string, unknown>)
      : {};
  // Drop the keys we manage so a previously-applied view's leftovers
  // don't bleed into the new one (e.g. an old `pagination` when the new
  // view has none).
  const preservedScoped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(baseScoped)) {
    if (!SCOPED_PREFERENCE_KEYS.includes(k as (typeof SCOPED_PREFERENCE_KEYS)[number])) {
      preservedScoped[k] = v;
    }
  }

  const { error: scopedErr } = await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: user.id,
        scope: view.scope,
        payload: { ...preservedScoped, ...scopedPayload } as unknown as Json,
      },
      { onConflict: "user_id,scope" },
    );
  if (scopedErr) return { ok: false, error: scopedErr.message };

  // Only patch toggles that were actually persisted on the view payload —
  // a view that doesn't touch `netOfFees` must not clobber the user's
  // current toggle state.
  const togglePatch: Record<string, unknown> = {};
  for (const [logical, persisted] of Object.entries(GLOBAL_TOGGLE_KEY_MAP)) {
    const value = payload.toggles[logical as keyof typeof payload.toggles];
    if (typeof value === "boolean") togglePatch[persisted] = value;
  }

  if (Object.keys(togglePatch).length > 0) {
    const { data: existingGlobal, error: globalReadErr } = await supabase
      .from("user_preferences")
      .select("payload")
      .eq("user_id", user.id)
      .eq("scope", "global")
      .maybeSingle();
    if (globalReadErr) return { ok: false, error: globalReadErr.message };

    const baseGlobal: Record<string, unknown> =
      existingGlobal?.payload && typeof existingGlobal.payload === "object" && !Array.isArray(existingGlobal.payload)
        ? (existingGlobal.payload as Record<string, unknown>)
        : {};

    const { error: globalErr } = await supabase
      .from("user_preferences")
      .upsert(
        {
          user_id: user.id,
          scope: "global",
          payload: { ...baseGlobal, ...togglePatch } as unknown as Json,
        },
        { onConflict: "user_id,scope" },
      );
    if (globalErr) return { ok: false, error: globalErr.message };
  }

  return { ok: true, payload, scope: view.scope };
}

const SCOPED_VIEW_KEYS = [
  "columns",
  "filters",
  "search",
  "sort",
  "pagination",
  "activeViewId",
];

/**
 * Initial-view bootstrap for a table page. Three branches:
 *  1. `user_preferences[scope]` already has `activeViewId` → return it (no
 *     re-apply: the user may have diverged since last application and we
 *     want to respect their current state).
 *  2. `user_preferences[scope]` has NO view-managed keys (fresh slate) AND
 *     a default view exists → apply it and return `{ id, payload }`.
 *  3. Otherwise → return `null` (the table uses its own scoped state).
 */
export async function bootstrapView(scope: ViewScope): Promise<
  | { ok: true; result: null | { id: string; activeOnly: true } | { id: string; payload: ViewPayload; activeOnly: false } }
  | { ok: false; error: string }
> {
  if (!isViewScope(scope)) return { ok: false, error: ERR_SCOPE };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: true, result: null };

  const { data: prefs, error: prefErr } = await supabase
    .from("user_preferences")
    .select("payload")
    .eq("user_id", user.id)
    .eq("scope", scope)
    .maybeSingle();
  if (prefErr) return { ok: false, error: prefErr.message };

  const prefPayload: Record<string, unknown> =
    prefs?.payload && typeof prefs.payload === "object" && !Array.isArray(prefs.payload)
      ? (prefs.payload as Record<string, unknown>)
      : {};

  const existingActiveId =
    typeof prefPayload.activeViewId === "string" ? prefPayload.activeViewId : null;
  if (existingActiveId) {
    return { ok: true, result: { id: existingActiveId, activeOnly: true } };
  }

  const hasScopedState = SCOPED_VIEW_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(prefPayload, key),
  );
  if (hasScopedState) return { ok: true, result: null };

  const { data: defaultRow, error: defErr } = await supabase
    .from("saved_views")
    .select("id")
    .eq("user_id", user.id)
    .eq("scope", scope)
    .eq("is_default", true)
    .maybeSingle();
  if (defErr) return { ok: false, error: defErr.message };
  if (!defaultRow) return { ok: true, result: null };

  const applied = await applyView(defaultRow.id);
  if (!applied.ok) return { ok: false, error: applied.error };
  return {
    ok: true,
    result: { id: defaultRow.id, payload: applied.payload, activeOnly: false },
  };
}
