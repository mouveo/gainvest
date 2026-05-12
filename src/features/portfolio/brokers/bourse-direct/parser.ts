import type { Support } from "../../types";
import type { FeeBreakdown, FileParseResult, Market, ParsedKind, ParsedRow } from "../types";

import { computeBourseDirectFees, solveBourseDirectGrossFromTotal } from "./fees";

// Espaces tolérés dans les nombres FR : normal, insécable, fine insécable.
const FR_SPACES_RE = /[\s  ]+/g;

const KIND_MAP: Record<string, ParsedKind> = {
  Achat: "buy",
  Vente: "sell",
  Coupons: "dividend",
  Frais: "fee",
  Liquidation: "sell",
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

// Normalise un nom de colonne : minuscules sans accents ni espaces ni point.
function normalizeHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s  ]+/g, "")
    .toLowerCase();
}

type ColumnMap = {
  date: number;
  quoi: number;
  isin: number;
  description: number;
  quantite: number;
  montant: number;
  commission: number | null;
  count: number;
};

function detectColumns(headerLine: string): ColumnMap {
  const cells = splitCsvLine(headerLine).map(normalizeHeader);
  const idx = (...names: string[]) => {
    for (const n of names) {
      const i = cells.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };

  const date = idx("date");
  const quoi = idx("quoi", "type", "operation");
  const isin = idx("isin");
  const description = idx("description", "libelle");
  const quantite = idx("quantite", "qte");
  const montant = idx("montant");
  const commission = idx("commission", "frais", "courtage");

  return {
    date,
    quoi,
    isin,
    description,
    quantite,
    montant,
    commission: commission === -1 ? null : commission,
    count: cells.length,
  };
}

// Si une description non-quotée contient une virgule, splitCsvLine retourne
// plus de colonnes que prévu. On recolle alors les colonnes du milieu
// (positions description..N-trailing) dans la description.
function normalizeFields(fields: string[], cols: ColumnMap): string[] {
  if (fields.length <= cols.count) return fields;
  const head = fields.slice(0, cols.description);
  const tail = fields.slice(fields.length - (cols.count - cols.description - 1));
  const middle = fields
    .slice(cols.description, fields.length - (cols.count - cols.description - 1))
    .join(",");
  return [...head, middle, ...tail];
}

export function parseBourseDirectCsv(
  csvText: string,
  options: { support: Support },
): FileParseResult {
  const lines = csvText.replace(/\r\n/g, "\n").split("\n");
  const out: ParsedRow[] = [];
  const warnings: string[] = [];

  if (lines.length === 0) return { rows: out, warnings };

  const cols = detectColumns(lines[0]!);
  if (cols.date < 0 || cols.quoi < 0 || cols.isin < 0 || cols.montant < 0 || cols.quantite < 0) {
    warnings.push("Header CSV non reconnu : colonnes Date / Quoi / ISIN / Quantité / Montant requises.");
    return { rows: out, warnings };
  }

  let skippedOrphanCoupons = 0;

  for (let idx = 1; idx < lines.length; idx++) {
    const raw = lines[idx]!;
    const rawLine = idx + 1;
    if (raw.trim() === "") continue;

    const fields = normalizeFields(splitCsvLine(raw), cols);
    if (fields.length < cols.count) {
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

    const dateRaw = fields[cols.date] ?? "";
    const quoiRaw = fields[cols.quoi] ?? "";
    const isinRaw = fields[cols.isin] ?? "";
    const descRaw = fields[cols.description] ?? "";
    const qteRaw = fields[cols.quantite] ?? "";
    const montantRaw = fields[cols.montant] ?? "";
    const commissionRaw = cols.commission != null ? (fields[cols.commission] ?? "") : "";

    const date = parseDate(dateRaw);
    const quoiTrimmed = quoiRaw.trim();
    const kind = KIND_MAP[quoiTrimmed];
    const isin = isinRaw.trim().toUpperCase() || null;
    const description = descRaw.trim();
    const totalAmountSigned = parseFr(montantRaw);
    const totalAmount = Math.abs(totalAmountSigned);
    const commission = commissionRaw.trim() ? parseFr(commissionRaw) : NaN;
    const hasCommission = Number.isFinite(commission) && commission > 0;

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

    // Coupons orphelins : pas d'ISIN identifiable ou description "??".
    // On skip silencieusement et on agrège dans un warning.
    if (kind === "dividend" && (!isin || description === "??" || description.includes("??"))) {
      skippedOrphanCoupons += 1;
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

    // Liquidation : kind=sell, quantité à inférer côté import action.
    if (quoiTrimmed === "Liquidation") {
      if (!isin || !ISIN_RE.test(isin)) {
        out.push({
          rawLine,
          date,
          kind,
          isin,
          description,
          quantity: null,
          totalAmount,
          needsAttention: true,
          attentionReason: "Liquidation : ISIN manquant ou invalide",
        });
        continue;
      }
      // Pour une liquidation : pas de commission, gross = total.
      const market = inferBourseDirectMarket(isin);
      const emptyFees: FeeBreakdown = {
        brokerage: 0,
        ttf: 0,
        total: 0,
        rationale: "Liquidation (frais ignorés)",
      };
      out.push({
        rawLine,
        date,
        kind,
        isin,
        description,
        quantity: null,
        totalAmount,
        grossAmount: totalAmount,
        // price calculé après inférence côté import action.
        price: undefined,
        computedFees: emptyFees,
        needsAttention: false,
        inferredMarket: market,
        inferQtyFromHoldings: true,
        notes: "Liquidation",
      });
      continue;
    }

    // buy / sell standard
    let quantity: number | null = null;
    const qteStr = qteRaw.trim();
    if (qteStr) {
      const q = parseFr(qteStr);
      if (Number.isFinite(q)) {
        // Quantités peuvent être signées dans la nouvelle version ; on prend la valeur absolue.
        const absQ = Math.abs(q);
        if (absQ > 0) quantity = absQ;
      }
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

    let grossAmount: number;
    let fees: FeeBreakdown;
    if (hasCommission) {
      // Commission lue directement dans le CSV. Le brut pur = |Montant| − Commission.
      // (Pour un achat, Montant = brut + commission ; pour une vente, Montant
      // = brut − commission. Dans les deux cas, |Montant - brut| = commission,
      // donc brut = |Montant| − commission côté achat, brut = |Montant| + commission
      // côté vente. On modélise comme : brut = |Montant| − commission pour la vue
      // capital + price ; les valeurs négatives sont impossibles ici car le CSV
      // BD donne déjà un Montant cohérent.)
      const isBuy = kind === "buy";
      const computedGross = isBuy ? totalAmount - commission : totalAmount + commission;
      grossAmount = Math.round(computedGross * 100) / 100;
      fees = {
        brokerage: Math.round(commission * 100) / 100,
        ttf: 0,
        total: Math.round(commission * 100) / 100,
        rationale: `Commission CSV ${commission.toFixed(2)} €`,
      };
      // Si le profil a un barème (TTF FR), le re-calculer puis prendre la TTF
      // pour la vue tax (et garder la commission CSV pour la brokerage).
      if (isBuy && isFREquity) {
        const computed = computeBourseDirectFees(grossAmount, {
          market,
          support: options.support,
          isFREquity,
          isBuy,
        });
        fees = {
          brokerage: Math.round(commission * 100) / 100,
          ttf: computed.ttf,
          total: Math.round((commission + computed.ttf) * 100) / 100,
          rationale: `Commission CSV ${commission.toFixed(2)} € + TTF ${computed.ttf.toFixed(2)} €`,
        };
      }
    } else {
      // Fallback : résolution du brut via le barème (ancien comportement).
      const solved = solveBourseDirectGrossFromTotal(totalAmount, {
        market,
        support: options.support,
        isFREquity,
        isBuy: kind === "buy",
      });
      grossAmount = solved.grossAmount;
      fees = solved.fees;
    }

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

  if (skippedOrphanCoupons > 0) {
    warnings.push(
      `${skippedOrphanCoupons} coupon${skippedOrphanCoupons > 1 ? "s" : ""} ignoré${skippedOrphanCoupons > 1 ? "s" : ""} faute d'ISIN identifiable.`,
    );
  }

  return { rows: out, warnings };
}
