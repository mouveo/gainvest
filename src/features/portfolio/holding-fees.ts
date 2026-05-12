// Heuristic rules for the V0 attribution of "droits de garde" (foreign custody
// fees) across active positions.
//
// - `isForeignIsin` infers nationality from the ISIN country prefix. FR / NL /
//   BE / LU instruments are not subject to French custody fees at Bourse
//   Direct and are treated as non-foreign. Everything else is considered
//   foreign and therefore eligible for fee allocation. No user override exists
//   in V0; if a customer disputes the classification of an exotic ISIN they
//   would need to edit the row manually.
// - `isHoldingFee` detects the two French labels we have seen in real Bourse
//   Direct exports ("Droits de garde", "Frais de conservation"). It is the
//   single source of truth used by the replay to decide whether a fee row
//   should be attributed across foreign positions.
//
// Fees that hit a date without any eligible foreign position (qty > 0,
// totalCost > 0) are dropped: we never carry an un-attributable fee on the
// books, since there is no anchor to amortize it against.

const HOLDING_FEE_PATTERNS: RegExp[] = [
  /droits?\s+de\s+garde/i,
  /frais\s+de\s+conservation/i,
];

const NON_FOREIGN_PREFIXES = new Set(["FR", "NL", "BE", "LU"]);

export function isForeignIsin(isin: string | null | undefined): boolean {
  if (!isin) return false;
  if (isin.length < 2) return false;
  const prefix = isin.slice(0, 2).toUpperCase();
  return !NON_FOREIGN_PREFIXES.has(prefix);
}

export function isHoldingFee(notes: string | null | undefined): boolean {
  if (!notes) return false;
  for (const re of HOLDING_FEE_PATTERNS) {
    if (re.test(notes)) return true;
  }
  return false;
}
