import {
  DEFAULT_VIEW_PAYLOAD,
  MAX_VIEW_NAME_LENGTH,
  VIEW_PAYLOAD_VERSION,
  VIEW_SCOPES,
  type ViewPagination,
  type ViewPayload,
  type ViewScope,
  type ViewSort,
  type ViewToggles,
} from "./types";

export function isViewScope(value: unknown): value is ViewScope {
  return typeof value === "string" && (VIEW_SCOPES as readonly string[]).includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeColumns(input: unknown): Record<string, boolean> {
  if (!isPlainObject(input)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, val] of Object.entries(input)) {
    if (typeof val === "boolean") out[key] = val;
  }
  return out;
}

function normalizeFilters(input: unknown): Record<string, unknown> {
  if (!isPlainObject(input)) return {};
  return { ...input };
}

function normalizeToggles(input: unknown): ViewToggles {
  if (!isPlainObject(input)) return {};
  const out: ViewToggles = {};
  if (typeof input.withDividends === "boolean") out.withDividends = input.withDividends;
  if (typeof input.netOfFees === "boolean") out.netOfFees = input.netOfFees;
  if (typeof input.inflationAdjusted === "boolean") {
    out.inflationAdjusted = input.inflationAdjusted;
  }
  return out;
}

function normalizeSort(input: unknown): ViewSort[] {
  if (!Array.isArray(input)) return [];
  const out: ViewSort[] = [];
  for (const entry of input) {
    if (!isPlainObject(entry)) continue;
    if (typeof entry.id !== "string" || entry.id.length === 0) continue;
    out.push({ id: entry.id, desc: entry.desc === true });
  }
  return out;
}

function normalizePagination(input: unknown): ViewPagination | undefined {
  if (!isPlainObject(input)) return undefined;
  const pageIndex = Number(input.pageIndex);
  const pageSize = Number(input.pageSize);
  if (!Number.isFinite(pageIndex) || !Number.isFinite(pageSize)) return undefined;
  if (pageIndex < 0 || pageSize <= 0) return undefined;
  return {
    pageIndex: Math.floor(pageIndex),
    pageSize: Math.floor(pageSize),
  };
}

/**
 * Coerce any stored payload (legacy, partial, or wrong-shape) into a valid
 * `ViewPayload`. Unknown keys are dropped, missing keys fall back to the
 * built-in defaults, and version mismatches are upgraded to the current
 * version (we only have v1 today, but old rows without `version` are also
 * accepted and stamped with v1).
 */
export function normalizeViewPayload(input: unknown): ViewPayload {
  const source = isPlainObject(input) ? input : {};
  const versionRaw = source.version;
  const version =
    typeof versionRaw === "number" && versionRaw === VIEW_PAYLOAD_VERSION
      ? versionRaw
      : VIEW_PAYLOAD_VERSION;

  const pagination = normalizePagination(source.pagination);
  const payload: ViewPayload = {
    version,
    columns: normalizeColumns(source.columns),
    filters: normalizeFilters(source.filters),
    search: typeof source.search === "string" ? source.search : "",
    toggles: normalizeToggles(source.toggles),
    sort: normalizeSort(source.sort),
  };
  if (pagination) payload.pagination = pagination;
  return payload;
}

/**
 * Merge a (possibly incomplete) payload with a defaults payload. Defaults
 * fill gaps without overriding values the user explicitly set. Used when
 * loading an old/partial saved view into a UI that has gained new columns
 * or toggles since the view was created.
 */
export function mergeViewPayloadWithDefaults(
  payload: ViewPayload,
  defaults: ViewPayload,
): ViewPayload {
  const merged: ViewPayload = {
    version: VIEW_PAYLOAD_VERSION,
    columns: { ...defaults.columns, ...payload.columns },
    filters: { ...defaults.filters, ...payload.filters },
    search: payload.search !== "" ? payload.search : defaults.search,
    toggles: { ...defaults.toggles, ...payload.toggles },
    sort: payload.sort.length > 0 ? payload.sort : defaults.sort,
  };
  const pagination = payload.pagination ?? defaults.pagination;
  if (pagination) merged.pagination = pagination;
  return merged;
}

export type ViewNameValidation =
  | { ok: true; name: string }
  | { ok: false; error: "name_empty" | "name_too_long" };

export function validateViewName(input: unknown): ViewNameValidation {
  const trimmed = typeof input === "string" ? input.trim() : "";
  if (trimmed.length === 0) return { ok: false, error: "name_empty" };
  if (trimmed.length > MAX_VIEW_NAME_LENGTH) return { ok: false, error: "name_too_long" };
  return { ok: true, name: trimmed };
}

export { DEFAULT_VIEW_PAYLOAD };
