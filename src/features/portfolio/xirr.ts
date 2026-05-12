// Internal Rate of Return for irregular cash flows.
//
// XIRR finds the rate r solving sum(amount_i / (1+r)^t_i) = 0 where t_i is
// the year-fraction between the i-th flow date and the earliest flow date
// (365.25-day basis). Only NPV is linear in the amounts; the root itself is
// not — concatenating cash flows from independent positions and re-solving
// is correct, but a weighted average of per-position rates is not.

export type Flow = { date: string; amount: number };

const MS_PER_DAY = 86_400_000;
const YEAR_DAYS = 365.25;
const TOL = 1e-6;
const MAX_NEWTON_ITER = 100;
const MAX_BISECTION_ITER = 200;

function parseISODate(s: string): number {
  return Date.parse(`${s}T00:00:00Z`);
}

export function xirr(flows: Flow[], guess: number = 0.1): number {
  if (flows.length < 2) return NaN;

  let hasPos = false;
  let hasNeg = false;
  let earliest = Number.POSITIVE_INFINITY;
  for (const f of flows) {
    if (f.amount > 0) hasPos = true;
    else if (f.amount < 0) hasNeg = true;
    const ms = parseISODate(f.date);
    if (Number.isFinite(ms) && ms < earliest) earliest = ms;
  }
  if (!hasPos || !hasNeg) return NaN;
  if (!Number.isFinite(earliest)) return NaN;

  const ts: { amount: number; t: number }[] = flows.map((f) => ({
    amount: f.amount,
    t: (parseISODate(f.date) - earliest) / MS_PER_DAY / YEAR_DAYS,
  }));

  const npv = (r: number): number => {
    let s = 0;
    for (const { amount, t } of ts) s += amount / Math.pow(1 + r, t);
    return s;
  };
  const dnpv = (r: number): number => {
    let s = 0;
    for (const { amount, t } of ts) s += (-amount * t) / Math.pow(1 + r, t + 1);
    return s;
  };

  // Newton-Raphson.
  let r = guess;
  for (let i = 0; i < MAX_NEWTON_ITER; i++) {
    if (!Number.isFinite(r) || r <= -1) break;
    const f = npv(r);
    if (!Number.isFinite(f)) break;
    if (Math.abs(f) < TOL) return r;
    const df = dnpv(r);
    if (!Number.isFinite(df) || df === 0) break;
    const next = r - f / df;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - r) < TOL) {
      if (next > -1 && Math.abs(npv(next)) < TOL * 1e2) return next;
      break;
    }
    r = next;
  }

  // Bisection fallback on [-0.9999, 100].
  let lo = -0.9999;
  let hi = 100;
  let flo = npv(lo);
  let fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return NaN;
  if (Math.abs(flo) < TOL) return lo;
  if (Math.abs(fhi) < TOL) return hi;
  if (flo > 0 === fhi > 0) return NaN;

  for (let i = 0; i < MAX_BISECTION_ITER; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
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
