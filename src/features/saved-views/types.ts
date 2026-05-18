export const VIEW_SCOPES = ["positions", "realizations", "movements"] as const;

export type ViewScope = (typeof VIEW_SCOPES)[number];

export const VIEW_PAYLOAD_VERSION = 1 as const;

export const MAX_VIEW_NAME_LENGTH = 80;

export type ViewSort = { id: string; desc: boolean };

export type ViewPagination = {
  pageIndex: number;
  pageSize: number;
};

export type ViewToggles = {
  withDividends?: boolean;
  netOfFees?: boolean;
  inflationAdjusted?: boolean;
};

export type ViewPayloadV1 = {
  version: 1;
  columns: Record<string, boolean>;
  filters: Record<string, unknown>;
  search: string;
  toggles: ViewToggles;
  sort: ViewSort[];
  pagination?: ViewPagination;
};

export type ViewPayload = ViewPayloadV1;

export const DEFAULT_VIEW_PAYLOAD: ViewPayload = {
  version: VIEW_PAYLOAD_VERSION,
  columns: {},
  filters: {},
  search: "",
  toggles: {},
  sort: [],
};
