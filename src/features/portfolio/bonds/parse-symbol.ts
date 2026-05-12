// Parses IBKR-style bond identifiers like "AMZN 4.65 11/20/35" into structured
// metadata. IBKR ships the coupon and maturity inside the description (and
// sometimes the symbol) for bonds — there is no dedicated field. We extract
// them at import so they can populate `instruments.bond_*` columns.

export type BondMetadata = {
  couponRate: number;
  maturityDate: string;
  frequency: 1 | 2 | 4;
};

const BOND_PATTERN = /(\d+(?:\.\d+)?)\s+(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s*$/;

export function parseBondSymbol(input: string): BondMetadata | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const match = BOND_PATTERN.exec(trimmed);
  if (!match) return null;

  const couponRate = parseFloat(match[1]!);
  if (!Number.isFinite(couponRate) || couponRate < 0 || couponRate >= 30) {
    return null;
  }

  const month = parseInt(match[2]!, 10);
  const day = parseInt(match[3]!, 10);
  const rawYear = match[4]!;
  const year = rawYear.length === 2 ? 2000 + parseInt(rawYear, 10) : parseInt(rawYear, 10);

  // Validate a real calendar date by round-tripping through Date.UTC.
  const ts = Date.UTC(year, month - 1, day);
  const d = new Date(ts);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }

  const maturityDate = `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;

  return { couponRate, maturityDate, frequency: 2 };
}
