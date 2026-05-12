import type { Support } from "../types";

export type Market =
  | "euronext"
  | "us"
  | "lse"
  | "xetra"
  | "madrid"
  | "swx"
  | "borsa-italiana"
  | "lisbon"
  | "other";

export type ParsedKind =
  | "buy"
  | "sell"
  | "dividend"
  | "interest"
  | "fee"
  | "tax"
  | "deposit"
  | "withdrawal";

export type FeeBreakdown = {
  brokerage: number;
  ttf: number;
  total: number;
  rationale: string;
};

export type ParsedRow = {
  rawLine: number;
  date: string;
  kind: ParsedKind;
  isin: string | null;
  description: string;
  quantity: number | null;
  totalAmount: number;
  computedFees?: FeeBreakdown;
  // grossAmount, price, fees are expressed in the row's native `currency`.
  // Use fxRate (currency -> EUR) to project them onto EUR. EUR rows carry
  // fxRate = 1.
  grossAmount?: number;
  price?: number;
  needsAttention: boolean;
  attentionReason?: string;
  inferredMarket?: Market;
  // Optional fields populated by brokers providing richer data (IBKR, etc.).
  externalId?: string | null;
  symbol?: string | null;
  name?: string | null;
  currency?: string;
  fees?: number;
  fxRate?: number | null;
  broker?: string;
  notes?: string | null;
  // Liquidation rows (BD) do not carry a quantity in the CSV — the import
  // action infers it from the user's stock at the row's date.
  inferQtyFromHoldings?: boolean;
};

export type FileParseResult = { rows: ParsedRow[]; warnings: string[] };

export type FeeCalculatorArgs = {
  market: Market;
  support: Support;
  isFREquity: boolean;
  isBuy: boolean;
};

export type BrokerProfile = {
  id: string;
  name: string;
  fileParser: (
    fileText: string,
    options: { support: Support },
  ) => ParsedRow[] | FileParseResult;
  feeCalculator?: (grossAmount: number, args: FeeCalculatorArgs) => FeeBreakdown;
  inferMarket?: (isin: string) => Market;
};
