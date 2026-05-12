// Pure cashflow generator for a vanilla bullet bond with regular coupons.
// Walks back from maturity by `12 / frequency` months, keeps dates strictly
// in the future, and folds the principal into the last (maturity) flow.

export type BondCashflow = {
  date: string;
  amount: number;
  couponAmount: number;
  principalAmount: number;
  kind: "coupon" | "maturity";
};

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysInMonthUTC(year: number, monthZeroBased: number): number {
  return new Date(Date.UTC(year, monthZeroBased + 1, 0)).getUTCDate();
}

function addMonthsUTC(d: Date, months: number): Date {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const targetYear = year + Math.floor((month + months) / 12);
  const targetMonth = ((month + months) % 12 + 12) % 12;
  const clampedDay = Math.min(day, daysInMonthUTC(targetYear, targetMonth));
  return new Date(Date.UTC(targetYear, targetMonth, clampedDay));
}

export function generateBondCashflows(args: {
  today: Date;
  maturity: Date;
  couponRatePct: number;
  faceValue: number;
  frequency: 1 | 2 | 4;
}): BondCashflow[] {
  const { today, maturity, couponRatePct, faceValue, frequency } = args;

  if (maturity.getTime() <= today.getTime()) return [];
  if (!Number.isFinite(faceValue) || faceValue <= 0) return [];
  if (!Number.isFinite(couponRatePct) || couponRatePct < 0) return [];

  // Zero-coupon: one flow carrying only the principal at maturity.
  if (couponRatePct === 0) {
    return [
      {
        date: toISODate(maturity),
        amount: faceValue,
        couponAmount: 0,
        principalAmount: faceValue,
        kind: "maturity",
      },
    ];
  }

  const periodMonths = 12 / frequency;
  const couponAmount = (couponRatePct / 100) * faceValue / frequency;

  const dates: Date[] = [];
  let cursor = new Date(maturity.getTime());
  // Walk back by one period at a time until we cross today.
  while (cursor.getTime() > today.getTime()) {
    dates.push(new Date(cursor.getTime()));
    cursor = addMonthsUTC(cursor, -periodMonths);
  }

  // `dates` is currently maturity-first; flip it so the earliest coupon is first.
  dates.reverse();

  const flows: BondCashflow[] = dates.map((d) => ({
    date: toISODate(d),
    amount: couponAmount,
    couponAmount,
    principalAmount: 0,
    kind: "coupon",
  }));

  // Fold the principal into the last (maturity) flow.
  const last = flows[flows.length - 1]!;
  last.kind = "maturity";
  last.principalAmount = faceValue;
  last.amount = couponAmount + faceValue;

  return flows;
}
