import type { Support } from "../../types";
import type { FeeBreakdown, FeeCalculatorArgs, Market } from "../types";

// Barème Bourse Direct (conditions tarifaires applicables au 06/01/2026).
// Référence : /tmp/bd_tarifs.txt extrait du PDF officiel.

// Euronext Paris / Amsterdam / Bruxelles — paliers fixes puis pourcentage.
const EURONEXT_TIER_1_MAX = 500; // ≤ 500 € → 0,99 €
const EURONEXT_TIER_2_MAX = 1000; // ]500, 1000] → 1,90 €
const EURONEXT_TIER_3_MAX = 2000; // ]1000, 2000] → 2,90 €
const EURONEXT_TIER_4_MAX = 4400; // ]2000, 4400] → 3,80 €
const EURONEXT_FEE_1 = 0.99;
const EURONEXT_FEE_2 = 1.9;
const EURONEXT_FEE_3 = 2.9;
const EURONEXT_FEE_4 = 3.8;
const EURONEXT_PCT_ABOVE_4400 = 0.0009; // > 4400 € → 0,09 % sur la totalité

// US (NYSE / NASDAQ) — forfait 8,50 € puis pourcentage au-delà.
const US_FLAT = 8.5;
const US_FLAT_MAX = 10000;
const US_PCT_ABOVE = 0.0009; // > 10000 € → 0,09 % sur la totalité

// Marchés étrangers — min de bracket.
const LSE_XETRA_PCT = 0.0015;
const LSE_XETRA_MIN = 15;
const MADRID_SWX_LISBON_PCT = 0.002;
const MADRID_SWX_LISBON_MIN = 18;
const OTHER_PCT = 0.0048;
const OTHER_MIN = 41.9;

// Plafond PEA / PEA-PME pour les ordres en ligne : 0,5 % du montant.
// Ne s'applique PAS hors UE/EEE (donc pas US, pas SWX (CH)).
const PEA_CAP_PCT = 0.005;
const PEA_CAPPED_MARKETS: ReadonlySet<Market> = new Set([
  "euronext",
  "lse",
  "xetra",
  "madrid",
  "borsa-italiana",
  "lisbon",
]);

// Taxe sur les Transactions Financières — 0,3 % sur les achats d'actions FR
// éligibles (capitalisation > 1 Md€, liste mise à jour annuellement par l'État).
const TTF_PCT = 0.003;

// Tolérance de réconciliation total ↔ gross+frais (centime).
const RECON_EPS = 0.015;

type BracketFormula =
  | { kind: "fixed"; fee: number; gMin: number; gMax: number; label: string }
  | { kind: "pct"; pct: number; gMin: number; gMax: number; label: string }
  | { kind: "min"; pct: number; minFee: number; gMin: number; gMax: number; label: string };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isPeaEligible(market: Market, support: Support): boolean {
  if (support !== "PEA" && support !== "PEA-PME") return false;
  return PEA_CAPPED_MARKETS.has(market);
}

function brokersForMarket(market: Market): BracketFormula[] {
  switch (market) {
    case "euronext":
      return [
        {
          kind: "fixed",
          fee: EURONEXT_FEE_1,
          gMin: 0,
          gMax: EURONEXT_TIER_1_MAX,
          label: "Euronext ≤ 500 €",
        },
        {
          kind: "fixed",
          fee: EURONEXT_FEE_2,
          gMin: EURONEXT_TIER_1_MAX,
          gMax: EURONEXT_TIER_2_MAX,
          label: "Euronext 500-1000 €",
        },
        {
          kind: "fixed",
          fee: EURONEXT_FEE_3,
          gMin: EURONEXT_TIER_2_MAX,
          gMax: EURONEXT_TIER_3_MAX,
          label: "Euronext 1000-2000 €",
        },
        {
          kind: "fixed",
          fee: EURONEXT_FEE_4,
          gMin: EURONEXT_TIER_3_MAX,
          gMax: EURONEXT_TIER_4_MAX,
          label: "Euronext 2000-4400 €",
        },
        {
          kind: "pct",
          pct: EURONEXT_PCT_ABOVE_4400,
          gMin: EURONEXT_TIER_4_MAX,
          gMax: Infinity,
          label: "Euronext > 4400 € (0,09 %)",
        },
      ];
    case "us":
      return [
        { kind: "fixed", fee: US_FLAT, gMin: 0, gMax: US_FLAT_MAX, label: "US ≤ 10 000 €" },
        {
          kind: "pct",
          pct: US_PCT_ABOVE,
          gMin: US_FLAT_MAX,
          gMax: Infinity,
          label: "US > 10 000 € (0,09 %)",
        },
      ];
    case "lse":
    case "xetra":
      return [
        {
          kind: "min",
          pct: LSE_XETRA_PCT,
          minFee: LSE_XETRA_MIN,
          gMin: 0,
          gMax: Infinity,
          label: `${market === "lse" ? "LSE" : "Xetra"} 0,15 % (min 15 €)`,
        },
      ];
    case "madrid":
    case "swx":
    case "lisbon":
      return [
        {
          kind: "min",
          pct: MADRID_SWX_LISBON_PCT,
          minFee: MADRID_SWX_LISBON_MIN,
          gMin: 0,
          gMax: Infinity,
          label: `${market === "madrid" ? "Madrid" : market === "swx" ? "SWX" : "Lisbon"} 0,20 % (min 18 €)`,
        },
      ];
    case "borsa-italiana":
    case "other":
      return [
        {
          kind: "min",
          pct: OTHER_PCT,
          minFee: OTHER_MIN,
          gMin: 0,
          gMax: Infinity,
          label: market === "borsa-italiana" ? "Borsa Italiana 0,48 % (min 41,90 €)" : "Autres 0,48 % (min 41,90 €)",
        },
      ];
  }
}

function brokerageRaw(
  gross: number,
  market: Market,
): { fee: number; tierLabel: string } {
  const brackets = brokersForMarket(market);
  for (const b of brackets) {
    if (gross > b.gMin && gross <= b.gMax) {
      if (b.kind === "fixed") return { fee: b.fee, tierLabel: b.label };
      if (b.kind === "pct") return { fee: gross * b.pct, tierLabel: b.label };
      return { fee: Math.max(gross * b.pct, b.minFee), tierLabel: b.label };
    }
  }
  // Cas dégénéré : gross ≤ 0 ou aucun bracket — utiliser le premier.
  const first = brackets[0]!;
  if (first.kind === "fixed") return { fee: first.fee, tierLabel: first.label };
  if (first.kind === "pct") return { fee: gross * first.pct, tierLabel: first.label };
  return { fee: Math.max(gross * first.pct, first.minFee), tierLabel: first.label };
}

export function computeBourseDirectFees(
  grossAmount: number,
  args: FeeCalculatorArgs,
): FeeBreakdown {
  const { market, support, isFREquity, isBuy } = args;

  const raw = brokerageRaw(grossAmount, market);
  let brokerage = raw.fee;
  let capped = false;
  if (isPeaEligible(market, support)) {
    const cap = grossAmount * PEA_CAP_PCT;
    if (brokerage > cap) {
      brokerage = cap;
      capped = true;
    }
  }

  const ttf = isBuy && isFREquity ? grossAmount * TTF_PCT : 0;

  const brokerageR = round2(brokerage);
  const ttfR = round2(ttf);
  const total = round2(brokerageR + ttfR);

  const parts = [`${raw.tierLabel} → ${brokerageR.toFixed(2)} €`];
  if (capped) parts.push(`plafond PEA 0,5 % → ${brokerageR.toFixed(2)} €`);
  if (ttfR > 0) parts.push(`TTF 0,3 % (FR equity) → ${ttfR.toFixed(2)} €`);
  parts.push(`total ${total.toFixed(2)} €`);

  return {
    brokerage: brokerageR,
    ttf: ttfR,
    total,
    rationale: parts.join(" + ").replace(" + total", " = "),
  };
}

// Pour un palier b et un côté isBuy / isFREquity, calcule le gross qui
// satisfait total = gross ± brokerage(gross) (+ ttf pour les achats).
function solveBracket(
  total: number,
  bracket: BracketFormula,
  isBuy: boolean,
  ttfRate: number,
  peaCap: boolean,
): number[] {
  const candidates: number[] = [];

  function pushSolutions(brokerageMode: "fee" | "pct" | "peaCap", fee: number, pct: number) {
    let g: number;
    if (brokerageMode === "fee") {
      // brokerage = fee (constante)
      if (isBuy) {
        // total = gross * (1 + ttfRate) + fee
        g = (total - fee) / (1 + ttfRate);
      } else {
        // total = gross - fee
        g = total + fee;
      }
    } else if (brokerageMode === "pct") {
      // brokerage = pct * gross
      if (isBuy) {
        // total = gross * (1 + pct + ttfRate)
        g = total / (1 + pct + ttfRate);
      } else {
        // total = gross * (1 - pct)
        g = total / (1 - pct);
      }
    } else {
      // PEA cap : brokerage = 0.005 * gross
      if (isBuy) {
        g = total / (1 + PEA_CAP_PCT + ttfRate);
      } else {
        g = total / (1 - PEA_CAP_PCT);
      }
    }
    if (Number.isFinite(g) && g > 0) candidates.push(g);
  }

  if (bracket.kind === "fixed") {
    pushSolutions("fee", bracket.fee, 0);
  } else if (bracket.kind === "pct") {
    pushSolutions("pct", 0, bracket.pct);
  } else {
    // min bracket : essayer les deux sous-régimes
    pushSolutions("pct", 0, bracket.pct);
    pushSolutions("fee", bracket.minFee, 0);
  }

  if (peaCap) pushSolutions("peaCap", 0, PEA_CAP_PCT);

  return candidates;
}

export function solveBourseDirectGrossFromTotal(
  totalAmount: number,
  args: FeeCalculatorArgs,
): { grossAmount: number; fees: FeeBreakdown } {
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    return { grossAmount: 0, fees: computeBourseDirectFees(0, args) };
  }

  const ttfRate = args.isBuy && args.isFREquity ? TTF_PCT : 0;
  const peaCap = isPeaEligible(args.market, args.support);

  const brackets = brokersForMarket(args.market);

  type Candidate = { gross: number; fees: FeeBreakdown; residual: number };
  const valid: Candidate[] = [];

  for (const b of brackets) {
    const candidates = solveBracket(totalAmount, b, args.isBuy, ttfRate, peaCap);
    for (const g of candidates) {
      if (g <= b.gMin && b.gMin > 0) continue;
      if (g > b.gMax) continue;
      const fees = computeBourseDirectFees(g, args);
      const reconstructed = args.isBuy ? g + fees.total : g - fees.brokerage;
      const residual = Math.abs(reconstructed - totalAmount);
      if (residual <= RECON_EPS) {
        valid.push({ gross: g, fees, residual });
      }
    }
  }

  if (valid.length === 0) {
    // Fallback : prendre le candidat avec le residual le plus faible parmi
    // toutes les solutions de palier (même hors range), afin de ne jamais
    // renvoyer un gross absurde.
    const all: Candidate[] = [];
    for (const b of brackets) {
      const candidates = solveBracket(totalAmount, b, args.isBuy, ttfRate, peaCap);
      for (const g of candidates) {
        if (!Number.isFinite(g) || g <= 0) continue;
        const fees = computeBourseDirectFees(g, args);
        const reconstructed = args.isBuy ? g + fees.total : g - fees.brokerage;
        all.push({ gross: g, fees, residual: Math.abs(reconstructed - totalAmount) });
      }
    }
    all.sort((a, b) => a.residual - b.residual);
    const best = all[0];
    if (!best) return { grossAmount: 0, fees: computeBourseDirectFees(0, args) };
    const grossAmount = round2(best.gross);
    return { grossAmount, fees: computeBourseDirectFees(grossAmount, args) };
  }

  // En cas de pluralité (ex. solution au bord d'un palier), préférer la
  // solution avec les frais les plus bas (interprétation favorable au client,
  // qui correspond au palier nominal du courtier dans 99 % des cas).
  valid.sort((a, b) => {
    if (a.fees.brokerage !== b.fees.brokerage) return a.fees.brokerage - b.fees.brokerage;
    return a.residual - b.residual;
  });

  const winner = valid[0]!;
  const grossAmount = round2(winner.gross);
  const fees = computeBourseDirectFees(grossAmount, args);
  return { grossAmount, fees };
}
