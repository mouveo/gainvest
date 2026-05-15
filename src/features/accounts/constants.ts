export const ACTIVE_ACCOUNT_COOKIE = "gainvest_active_account";

export const ALL_ACCOUNTS = "ALL" as const;

export type ActiveAccount = string | typeof ALL_ACCOUNTS;

export const ACCOUNT_TYPES = [
  "pea",
  "pea_pme",
  "cto",
  "av",
  "per",
  "livret",
  "crypto",
  "real_estate",
  "other",
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];
