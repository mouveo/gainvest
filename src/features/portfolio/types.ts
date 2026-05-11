// Domain types for the portfolio feature.
// These mirror the public schema in db/schema.sql and will be regenerated
// from Supabase via `supabase gen types typescript` once the project is up.

export type AccountType =
  | "pea"
  | "pea_pme"
  | "cto"
  | "av"
  | "per"
  | "livret"
  | "crypto"
  | "real_estate"
  | "other";

export type AssetClass = "equity" | "etf" | "fund" | "bond" | "crypto" | "real_estate" | "cash";

export type TransactionKind =
  | "buy"
  | "sell"
  | "dividend"
  | "interest"
  | "fee"
  | "tax"
  | "deposit"
  | "withdrawal";

export interface Account {
  id: string;
  user_id: string;
  name: string;
  type: AccountType;
  broker: string | null;
  currency: string;
  opened_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Instrument {
  id: string;
  symbol: string;
  isin: string | null;
  mic: string | null;
  name: string;
  asset_class: AssetClass;
  currency: string;
  country: string | null;
  created_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  account_id: string;
  instrument_id: string | null;
  kind: TransactionKind;
  trade_date: string;
  settlement_date: string | null;
  quantity: number | null;
  price: number | null;
  gross_amount: number;
  fees: number;
  tax: number;
  currency: string;
  fx_rate: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Price {
  instrument_id: string;
  date: string;
  close: number;
  currency: string;
  source: string | null;
}
