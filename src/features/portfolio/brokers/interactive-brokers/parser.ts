import { XMLParser } from "fast-xml-parser";

import type { Support } from "../../types";
import type { AssetClass } from "../../types";
import type { ParsedKind, ParsedRow } from "../types";

type RawAttrs = Record<string, string | number | undefined>;

function attrs(node: unknown): RawAttrs {
  if (node && typeof node === "object") return node as RawAttrs;
  return {};
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

const CASH_TYPE_MAP: Record<string, ParsedKind> = {
  Dividends: "dividend",
  "Bond Interest Paid": "interest",
  "Broker Interest Received": "interest",
  "Withholding Tax": "tax",
};

export function parseIbkrFlexXml(
  xmlText: string,
  { support: _support }: { support: Support },
): ParsedRow[] {
  void _support; // currently unused; reserved for support-aware logic later
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false,
  });
  const doc = parser.parse(xmlText);

  const stmt = doc?.FlexQueryResponse?.FlexStatements?.FlexStatement;
  if (!stmt) {
    throw new Error("XML invalide : <FlexStatement> introuvable");
  }

  const rows: ParsedRow[] = [];
  let lineNo = 1;

  // Indexed by IBKR tradeID so we can fold a BOND `PURCHASE ACCRUED` cash
  // entry back into its originating buy (capitalised cost basis, no synthetic
  // interest row).
  const buysByTradeId = new Map<string, ParsedRow>();

  const trades = toArray(stmt.Trades?.Trade).map(attrs);
  for (const t of trades) {
    const buySell = str(t.buySell).toUpperCase();
    if (buySell !== "BUY" && buySell !== "SELL") continue;
    const kind: ParsedKind = buySell === "BUY" ? "buy" : "sell";
    const isin = str(t.isin);
    if (!isin) continue;

    const nativeCurrency = str(t.currency) || "EUR";
    const fx = num(t.fxRateToBase) || 1;
    const quantity = Math.abs(num(t.quantity));
    const price = Math.abs(num(t.tradePrice));
    const grossNative = Math.abs(num(t.proceeds));
    const feesNative = Math.abs(num(t.ibCommission));
    const symbol = str(t.symbol);
    const description = str(t.description) || symbol;
    const assetClass = classifyIbkrAsset(str(t.assetCategory), str(t.subCategory));
    const tradeId = str(t.tradeID) || null;

    const row: ParsedRow = {
      rawLine: lineNo++,
      date: parseDate(str(t.tradeDate) || str(t.dateTime)),
      kind,
      isin,
      description,
      quantity,
      // totalAmount stays in native currency; fxRate ferries the EUR projection.
      totalAmount: grossNative + feesNative,
      grossAmount: grossNative,
      price,
      needsAttention: false,
      externalId: str(t.ibExecID) || str(t.transactionID) || tradeId || null,
      symbol,
      name: description,
      currency: nativeCurrency,
      fees: feesNative,
      fxRate: fx,
      broker: "Interactive Brokers",
      assetClass,
      tradeId,
    };

    rows.push(row);

    if (kind === "buy" && tradeId) {
      buysByTradeId.set(tradeId, row);
    }
  }

  const cash = toArray(stmt.CashTransactions?.CashTransaction).map(attrs);
  for (const c of cash) {
    const rawType = str(c.type);
    let kind: ParsedKind | null = CASH_TYPE_MAP[rawType] ?? null;
    const amount = num(c.amount);

    if (rawType === "Deposits/Withdrawals") {
      kind = amount >= 0 ? "deposit" : "withdrawal";
    }
    if (!kind) continue;

    const nativeCurrency = str(c.currency) || "EUR";
    const fx = num(c.fxRateToBase) || 1;
    const grossNative = Math.abs(amount);
    const isin = str(c.isin);
    const symbol = str(c.symbol) || null;
    const description = str(c.description) || rawType;

    // BOND purchase accrued interest: a "Bond Interest Paid" entry with a
    // negative amount and `PURCHASE ACCRUED` in the description, attached to
    // the trade via tradeID. IBKR books it as cash interest, but it's really
    // part of the buy's cost basis — capitalise it onto the buy and skip
    // emitting an interest row (which would otherwise show up as negative
    // coupon revenue).
    const cashTradeId = str(c.tradeID) || null;
    if (
      rawType === "Bond Interest Paid" &&
      amount < 0 &&
      /PURCHASE ACCRUED/i.test(description) &&
      cashTradeId
    ) {
      const buy = buysByTradeId.get(cashTradeId);
      if (buy) {
        // Amounts are kept in native currency on the parsed row; the buy's
        // fxRate already maps the whole position to EUR downstream.
        buy.grossAmount = (buy.grossAmount ?? 0) + grossNative;
        buy.totalAmount = buy.totalAmount + grossNative;
        continue;
      }
    }
    // Keep the IBKR raw type in `notes` so we can audit
    // "Broker Interest Received" vs "Bond Interest Paid" downstream.
    const notes = rawType ? `${rawType}${description ? ` — ${description}` : ""}` : description;

    rows.push({
      rawLine: lineNo++,
      date: parseDate(str(c.dateTime) || str(c.settleDate) || str(c.reportDate)),
      kind,
      isin: isin || null,
      description,
      quantity: null,
      totalAmount: grossNative,
      grossAmount: grossNative,
      needsAttention: false,
      externalId: str(c.transactionID) || null,
      symbol,
      name: description,
      currency: nativeCurrency,
      fees: 0,
      fxRate: fx,
      broker: "Interactive Brokers",
      notes,
    });
  }

  return rows;
}

function parseDate(s: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1]!;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
}

export function classifyIbkrAsset(category: string, sub: string): AssetClass {
  if (category === "BOND") return "bond";
  if (sub === "ETF") return "etf";
  if (category === "STK") return "equity";
  return "equity";
}
