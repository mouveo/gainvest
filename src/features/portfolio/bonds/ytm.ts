// Yield-to-maturity solver. Uses periodic compounding `(1 + r/m)^(m·t)` where
// `m` is the coupon frequency and `t` the year-fraction from `today` on a
// 365.25-day basis (consistent with xirr.ts). Newton-Raphson with a bisection
// fallback. Solves `sum(CF_i · DF_i) = price` for `r`.

import type { BondCashflow } from "./cashflows";

const MS_PER_DAY = 86_400_000;
const YEAR_DAYS = 365.25;
const TOL = 1e-8;
const MAX_NEWTON_ITER = 100;
const MAX_BISECTION_ITER = 200;

function parseISODate(s: string): number {
  return Date.parse(`${s}T00:00:00Z`);
}

export function computeYtm(args: {
  pricePctPar: number;
  cashflows: BondCashflow[];
  today: Date;
  faceValue: number;
  frequency: 1 | 2 | 4;
}): number {
  const { pricePctPar, cashflows, today, faceValue, frequency } = args;

  if (!Number.isFinite(pricePctPar) || pricePctPar <= 0) return NaN;
  if (!Number.isFinite(faceValue) || faceValue <= 0) return NaN;
  if (cashflows.length === 0) return NaN;

  const price = (pricePctPar * faceValue) / 100;
  const todayMs = today.getTime();

  const points: { amount: number; t: number }[] = [];
  for (const cf of cashflows) {
    const ms = parseISODate(cf.date);
    if (!Number.isFinite(ms)) return NaN;
    const t = (ms - todayMs) / MS_PER_DAY / YEAR_DAYS;
    if (t <= 0) continue;
    points.push({ amount: cf.amount, t });
  }
  if (points.length === 0) return NaN;

  const m = frequency;

  // NPV at rate `r` net of price (positive r means yield).
  const f = (r: number): number => {
    let s = -price;
    const base = 1 + r / m;
    for (const { amount, t } of points) s += amount / Math.pow(base, m * t);
    return s;
  };
  const df = (r: number): number => {
    let s = 0;
    const base = 1 + r / m;
    for (const { amount, t } of points) {
      s += (-amount * t) / Math.pow(base, m * t + 1);
    }
    return s;
  };

  // Newton-Raphson. Guess: current yield based on coupon ratio.
  let r = 0.05;
  for (let i = 0; i < MAX_NEWTON_ITER; i++) {
    if (!Number.isFinite(r) || 1 + r / m <= 0) break;
    const fr = f(r);
    if (!Number.isFinite(fr)) break;
    if (Math.abs(fr) < TOL) return r;
    const dr = df(r);
    if (!Number.isFinite(dr) || dr === 0) break;
    const next = r - fr / dr;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - r) < TOL) {
      if (1 + next / m > 0 && Math.abs(f(next)) < TOL * 1e2) return next;
      break;
    }
    r = next;
  }

  // Bisection fallback on a wide bracket. Lower bound just above -m (where
  // `1 + r/m` would hit zero), upper bound very large for stressed prices.
  let lo = -m + 1e-6;
  let hi = 100;
  let flo = f(lo);
  let fhi = f(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return NaN;
  if (Math.abs(flo) < TOL) return lo;
  if (Math.abs(fhi) < TOL) return hi;
  if (flo > 0 === fhi > 0) return NaN;

  for (let i = 0; i < MAX_BISECTION_ITER; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (!Number.isFinite(fm)) return NaN;
    if (Math.abs(fm) < TOL || hi - lo < TOL) return mid;
    if (fm > 0 === flo > 0) {
      lo = mid;
      flo = fm;
    } else {
      hi = mid;
      fhi = fm;
    }
  }
  return NaN;
}
