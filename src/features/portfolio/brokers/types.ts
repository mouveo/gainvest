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

export type ParsedKind = "buy" | "sell" | "dividend" | "fee";

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
  csvParser: (csvText: string, options: { support: Support }) => ParsedRow[];
  feeCalculator: (grossAmount: number, args: FeeCalculatorArgs) => FeeBreakdown;
  inferMarket: (isin: string) => Market;
};
