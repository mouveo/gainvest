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
  broker?: string;
};

export type FeeCalculatorArgs = {
  market: Market;
  support: Support;
  isFREquity: boolean;
  isBuy: boolean;
};

export type BrokerProfile = {
  id: string;
  name: string;
  fileParser: (fileText: string, options: { support: Support }) => ParsedRow[];
  feeCalculator?: (grossAmount: number, args: FeeCalculatorArgs) => FeeBreakdown;
  inferMarket?: (isin: string) => Market;
};
