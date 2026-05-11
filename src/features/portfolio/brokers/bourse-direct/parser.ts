import type { Support } from "../../types";
import type { Market, ParsedKind, ParsedRow } from "../types";

import { solveBourseDirectGrossFromTotal } from "./fees";

// Espaces tolérés dans les nombres FR : normal, insécable, fine insécable.
const FR_SPACES_RE = /[\s  ]+/g;

const KIND_MAP: Record<string, ParsedKind> = {
  Achat: "buy",
  Vente: "sell",
  Coupons: "dividend",
  Frais: "fee",
};

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const QTY_FROM_DESC_RE = /\(([+-])(\d[\d\s  ]*)\)/;

export function inferBourseDirectMarket(isin: string): Market {
  if (!isin) return "other";
  const prefix = isin.slice(0, 2);
  switch (prefix) {
    case "FR":
    case "NL":
    case "BE":
      return "euronext";
    case "PT":
      return "lisbon";
    case "US":
    case "CA":
      return "us";
    case "GB":
      return "lse";
    case "DE":
    case "AT":
      return "xetra";
    case "ES":
      return "madrid";
    case "CH":
      return "swx";
    case "IT":
      return "borsa-italiana";
    default:
      return "other";
  }
}

export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseFr(s: string): number {
  const cleaned = s.replace(FR_SPACES_RE, "").replace(/€/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function parseDate(s: string): string | null {
  const m = s.trim().match(DATE_RE);
  if (!m) return null;
  const [, d, mo, y] = m;
  const day = d!.padStart(2, "0");
  const month = mo!.padStart(2, "0");
  return `${y}-${month}-${day}`;
}

function extractQuantityFromDescription(desc: string): number | null {
  const m = desc.match(QTY_FROM_DESC_RE);
  if (!m) return null;
  const n = parseFr(m[2]!);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Si une description non-quotée contient une virgule, splitCsvLine retourne
// plus de 6 colonnes. On recolle alors les colonnes du milieu (positions
// 3..N-2) dans la description.
function normalizeFields(fields: string[]): string[] {
  if (fields.length <= 6) return fields;
  const [date, quoi, isin, ...rest] = fields;
  const montant = rest.pop()!;
  const qte = rest.pop()!;
  const description = rest.join(",");
  return [date!, quoi!, isin!, description, qte, montant];
}

export function parseBourseDirectCsv(
  csvText: string,
  options: { support: Support },
): ParsedRow[] {
  const lines = csvText.replace(/\r\n/g, "\n").split("\n");
  const out: ParsedRow[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx]!;
    const rawLine = idx + 1;
    if (idx === 0) continue; // header
    if (raw.trim() === "") continue;

    const fields = normalizeFields(splitCsvLine(raw));
    if (fields.length < 6) {
      out.push({
        rawLine,
        date: "",
        kind: "fee",
        isin: null,
        description: raw,
        quantity: null,
        totalAmount: 0,
        needsAttention: true,
        attentionReason: "Ligne CSV invalide (colonnes manquantes)",
      });
      continue;
    }

    const [dateRaw, quoiRaw, isinRaw, descRaw, qteRaw, montantRaw] = fields;

    const date = parseDate(dateRaw!);
    const kind = KIND_MAP[quoiRaw!.trim()];
    const isin = isinRaw!.trim().toUpperCase() || null;
    const description = descRaw!.trim();
    const totalAmount = parseFr(montantRaw!);

    if (!kind) {
      out.push({
        rawLine,
        date: date ?? "",
        kind: "fee",
        isin,
        description,
        quantity: null,
        totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
        needsAttention: true,
        attentionReason: `Type d'opération inconnu : "${quoiRaw}"`,
      });
      continue;
    }

    if (!date) {
      out.push({
        rawLine,
        date: "",
        kind,
        isin,
        description,
        quantity: null,
        totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
        needsAttention: true,
        attentionReason: `Date invalide : "${dateRaw}"`,
      });
      continue;
    }

    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      out.push({
        rawLine,
        date,
        kind,
        isin,
        description,
        quantity: null,
        totalAmount: 0,
        needsAttention: true,
        attentionReason: `Montant invalide : "${montantRaw}"`,
      });
      continue;
    }

    if (kind === "dividend" || kind === "fee") {
      out.push({
        rawLine,
        date,
        kind,
        isin,
        description,
        quantity: null,
        totalAmount,
        grossAmount: totalAmount,
        needsAttention: false,
      });
      continue;
    }

    // buy / sell
    let quantity: number | null = null;
    const qteStr = qteRaw!.trim();
    if (qteStr) {
      const q = parseFr(qteStr);
      if (Number.isFinite(q) && q > 0) quantity = q;
    }
    if (quantity == null) quantity = extractQuantityFromDescription(description);

    if (quantity == null) {
      out.push({
        rawLine,
        date,
        kind,
        isin,
        description,
        quantity: null,
        totalAmount,
        needsAttention: true,
        attentionReason: "Quantité introuvable",
      });
      continue;
    }

    if (!isin || !ISIN_RE.test(isin)) {
      out.push({
        rawLine,
        date,
        kind,
        isin,
        description,
        quantity,
        totalAmount,
        needsAttention: true,
        attentionReason: "ISIN manquant ou invalide",
      });
      continue;
    }

    const market = inferBourseDirectMarket(isin);
    const isFREquity = isin.startsWith("FR");
    const { grossAmount, fees } = solveBourseDirectGrossFromTotal(totalAmount, {
      market,
      support: options.support,
      isFREquity,
      isBuy: kind === "buy",
    });

    const price = quantity > 0 ? Math.round((grossAmount / quantity) * 10000) / 10000 : undefined;

    out.push({
      rawLine,
      date,
      kind,
      isin,
      description,
      quantity,
      totalAmount,
      computedFees: fees,
      grossAmount,
      price,
      needsAttention: false,
      inferredMarket: market,
    });
  }

  return out;
}
