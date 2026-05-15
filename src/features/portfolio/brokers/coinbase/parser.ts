import { randomUUID } from "node:crypto";

import type { Support } from "../../types";
import { splitCsvLine } from "../bourse-direct/parser";
import type { FileParseResult, ParsedKind, ParsedRow } from "../types";

// Coinbase exports come in two flavours (Tax/Cost-basis CSV and Transaction
// History). Both share the same column anatomy: a timestamp + transaction
// type + asset + quantity, plus a spot price + subtotal/total/fees + a free
// "Notes" field that's the only place the conversion source/destination are
// recorded. We tolerate column reordering and US-vs-FR number formats.

const KIND_MAP: Record<string, ParsedKind> = {
  Buy: "buy",
  "Advanced Trade Buy": "buy",
  Sell: "sell",
  "Advanced Trade Sell": "sell",
  "Staking Reward": "interest",
  "Coinbase Earn": "interest",
  "Learning Reward": "interest",
  "Inflation Reward": "interest",
  "Rewards Income": "interest",
  Send: "withdrawal",
  Receive: "deposit",
};

// "Converted 0,5 BTC to 10 ETH" (the "at $X" suffix is optional).
const CONVERT_NOTES_RE =
  /Converted\s+([\d.,  \s]+)\s+([A-Z0-9]+)\s+to\s+([\d.,  \s]+)\s+([A-Z0-9]+)/i;

const SPACES_RE = /[\s  ]+/g;

function parseNumber(s: string): number {
  if (!s) return NaN;
  let cleaned = s.replace(SPACES_RE, "").replace(/€|\$|£/g, "");
  // FR uses "1.234,56" — if the string has both, drop the thousands dot.
  if (cleaned.includes(",") && cleaned.includes(".")) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (cleaned.includes(",")) {
    cleaned = cleaned.replace(",", ".");
  }
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(SPACES_RE, " ")
    .trim()
    .toLowerCase();
}

type ColumnMap = {
  timestamp: number;
  type: number;
  asset: number;
  quantity: number;
  spotCurrency: number;
  eurSpotPrice: number;
  usdSpotPrice: number;
  subtotal: number;
  total: number;
  fees: number;
  notes: number;
  count: number;
};

function detectColumns(headerLine: string): ColumnMap | null {
  const cells = splitCsvLine(headerLine).map(normalizeHeader);
  const findIndex = (predicate: (c: string) => boolean): number => cells.findIndex(predicate);

  const timestamp = findIndex((c) => c === "timestamp");
  const type = findIndex((c) => c === "transaction type");
  const asset = findIndex((c) => c === "asset");
  const quantity = findIndex((c) => c === "quantity transacted");
  if (timestamp < 0 || type < 0 || asset < 0 || quantity < 0) return null;

  return {
    timestamp,
    type,
    asset,
    quantity,
    spotCurrency: findIndex((c) => c === "spot price currency"),
    eurSpotPrice: findIndex(
      (c) =>
        c === "eur spot price at transaction" || c.startsWith("eur spot price"),
    ),
    usdSpotPrice: findIndex(
      (c) =>
        c === "usd spot price at transaction" || c.startsWith("usd spot price"),
    ),
    subtotal: findIndex((c) => c === "subtotal"),
    total: findIndex((c) =>
      c === "total" ||
      c.startsWith("total (inclusive of fees") ||
      c.startsWith("total inclusive of fees"),
    ),
    fees: findIndex((c) =>
      c === "fees" || c.startsWith("fees and/or spread") || c === "fee",
    ),
    notes: findIndex((c) => c === "notes"),
    count: cells.length,
  };
}

function locateHeader(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!).map(normalizeHeader);
    const hasTimestamp = cells.includes("timestamp");
    const hasType = cells.includes("transaction type");
    const hasAsset = cells.includes("asset");
    const hasQty = cells.includes("quantity transacted");
    if (hasTimestamp && hasType && hasAsset && hasQty) return i;
  }
  return -1;
}

function parseDateFromTimestamp(timestamp: string): string | null {
  const trimmed = timestamp.trim();
  if (!trimmed) return null;
  // Coinbase uses ISO-8601 with a "Z" or offset (e.g. "2024-03-12T08:42:11Z").
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Some exports use "MM/DD/YYYY HH:mm:ss"; accept that too.
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    const mo = us[1]!.padStart(2, "0");
    const d = us[2]!.padStart(2, "0");
    return `${us[3]}-${mo}-${d}`;
  }
  return null;
}

export function parseCoinbaseCsv(
  csvText: string,
  _options: { support: Support },
): FileParseResult {
  const lines = csvText.replace(/\r\n/g, "\n").split("\n");
  const out: ParsedRow[] = [];
  const warnings: string[] = [];

  const headerIdx = locateHeader(lines);
  if (headerIdx < 0) {
    warnings.push(
      "Header CSV Coinbase non reconnu — colonnes Timestamp / Transaction Type / Asset / Quantity Transacted requises.",
    );
    return { rows: out, warnings };
  }

  const cols = detectColumns(lines[headerIdx]!);
  if (!cols) {
    warnings.push("Colonnes Coinbase manquantes.");
    return { rows: out, warnings };
  }

  // Both legs of one Convert share a synthetic key built from the timestamp
  // and the asset/quantity pair (sorted, so SRC->DST and DST->SRC orderings
  // collide on the same key).
  const pairIds = new Map<string, string>();
  function pairIdFor(
    timestamp: string,
    src: string,
    dst: string,
    srcQty: number,
    dstQty: number,
  ): string {
    const sortedAssets = [src, dst].sort();
    const quantitiesByAsset = new Map<string, number>([
      [src, srcQty],
      [dst, dstQty],
    ]);
    const orderedQtys = sortedAssets.map((a) => (quantitiesByAsset.get(a) ?? 0).toFixed(10));
    const key = `${timestamp}|${sortedAssets.join("-")}|${orderedQtys.join("|")}`;
    let id = pairIds.get(key);
    if (!id) {
      id = randomUUID();
      pairIds.set(key, id);
    }
    return id;
  }

  for (let idx = headerIdx + 1; idx < lines.length; idx++) {
    const raw = lines[idx]!;
    const rawLine = idx + 1;
    if (raw.trim() === "") continue;
    const fields = splitCsvLine(raw);
    if (fields.length < cols.timestamp + 1) continue;

    const timestamp = (fields[cols.timestamp] ?? "").trim();
    const typeRaw = (fields[cols.type] ?? "").trim();
    const asset = (fields[cols.asset] ?? "").trim().toUpperCase();
    const qtyRaw = (fields[cols.quantity] ?? "").trim();
    const subtotalRaw = cols.subtotal >= 0 ? (fields[cols.subtotal] ?? "") : "";
    const totalRaw = cols.total >= 0 ? (fields[cols.total] ?? "") : "";
    const feesRaw = cols.fees >= 0 ? (fields[cols.fees] ?? "") : "";
    const eurPriceRaw = cols.eurSpotPrice >= 0 ? (fields[cols.eurSpotPrice] ?? "") : "";
    const usdPriceRaw = cols.usdSpotPrice >= 0 ? (fields[cols.usdSpotPrice] ?? "") : "";
    const spotCcyRaw =
      cols.spotCurrency >= 0 ? (fields[cols.spotCurrency] ?? "").trim().toUpperCase() : "";
    const notesRaw = cols.notes >= 0 ? (fields[cols.notes] ?? "").trim() : "";

    const date = parseDateFromTimestamp(timestamp);
    const description = typeRaw || asset || raw;

    const quantityParsed = parseNumber(qtyRaw);
    const eurPrice = parseNumber(eurPriceRaw);
    const usdPrice = parseNumber(usdPriceRaw);
    const total = parseNumber(totalRaw);
    const subtotal = parseNumber(subtotalRaw);
    const fees = parseNumber(feesRaw);

    const usdMode =
      spotCcyRaw === "USD" ||
      (!Number.isFinite(eurPrice) && Number.isFinite(usdPrice));
    const currency = usdMode ? "USD" : "EUR";
    const price = usdMode ? usdPrice : eurPrice;
    const subtotalAbs = Number.isFinite(subtotal) ? Math.abs(subtotal) : NaN;
    const totalAbs = Number.isFinite(total) ? Math.abs(total) : NaN;
    const feesAbs = Number.isFinite(fees) ? Math.abs(fees) : 0;
    const priceQtyGross =
      Number.isFinite(price) && Number.isFinite(quantityParsed)
        ? Math.abs(price * quantityParsed)
        : NaN;
    const grossAmount = Number.isFinite(subtotalAbs)
      ? subtotalAbs
      : Number.isFinite(totalAbs)
        ? totalAbs - feesAbs
        : Number.isFinite(priceQtyGross)
          ? priceQtyGross
          : 0;
    const totalAmount = Number.isFinite(totalAbs)
      ? totalAbs
      : grossAmount + feesAbs;

    const base: Omit<ParsedRow, "kind"> = {
      rawLine,
      date: date ?? "",
      isin: null,
      symbol: asset || null,
      name: asset || null,
      description,
      quantity: Number.isFinite(quantityParsed) ? Math.abs(quantityParsed) : null,
      totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
      grossAmount: Number.isFinite(grossAmount) ? grossAmount : 0,
      price: Number.isFinite(price) ? Math.abs(price) : undefined,
      fees: feesAbs,
      currency,
      fxRate: currency === "EUR" ? 1 : null,
      assetClass: "crypto",
      notes: notesRaw || null,
      broker: "Coinbase",
      needsAttention: false,
    };

    if (!date) {
      out.push({
        ...base,
        kind: "fee",
        needsAttention: true,
        attentionReason: `Timestamp invalide : "${timestamp}"`,
      });
      continue;
    }

    if (!asset) {
      out.push({
        ...base,
        kind: "fee",
        needsAttention: true,
        attentionReason: "Asset Coinbase manquant",
      });
      continue;
    }

    const usdAttention =
      currency === "USD"
        ? "CSV Coinbase en USD — taux FX USD/EUR à fournir avant import"
        : null;

    // Convert: emit one ParsedRow per leg, sharing the same convertPairId.
    if (typeRaw === "Convert") {
      const match = notesRaw.match(CONVERT_NOTES_RE);
      if (!match) {
        out.push({
          ...base,
          kind: "fee",
          needsAttention: true,
          attentionReason: `Convert sans notes parsables : "${notesRaw}"`,
        });
        continue;
      }
      const srcQty = parseNumber(match[1]!);
      const src = match[2]!.toUpperCase();
      const dstQty = parseNumber(match[3]!);
      const dst = match[4]!.toUpperCase();
      let kind: ParsedKind;
      if (asset === src) kind = "sell";
      else if (asset === dst) kind = "buy";
      else {
        out.push({
          ...base,
          kind: "fee",
          needsAttention: true,
          attentionReason: `Convert : asset "${asset}" inconnu dans la note "${notesRaw}"`,
        });
        continue;
      }
      const convertPairId = pairIdFor(timestamp, src, dst, srcQty, dstQty);
      out.push({
        ...base,
        kind,
        convertPairId,
        needsAttention: usdAttention != null,
        attentionReason: usdAttention ?? undefined,
      });
      continue;
    }

    const mappedKind = KIND_MAP[typeRaw];
    if (!mappedKind) {
      out.push({
        ...base,
        kind: "fee",
        needsAttention: true,
        attentionReason: `Type Coinbase inconnu : "${typeRaw}"`,
      });
      continue;
    }

    // Receive: incoming crypto with an unknown external cost basis; import
    // succeeds, but the user must complete the acquisition cost later.
    const receiveAttention =
      typeRaw === "Receive"
        ? "Receive externe : coût d'acquisition à compléter manuellement"
        : null;

    const attentionReason = usdAttention ?? receiveAttention;
    out.push({
      ...base,
      kind: mappedKind,
      needsAttention: attentionReason != null,
      attentionReason: attentionReason ?? undefined,
    });
  }

  return { rows: out, warnings };
}
