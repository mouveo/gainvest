// Pure aggregator combining cashflow generation and YTM solver into the
// numbers the bond detail view needs: remaining coupon count, native/EUR
// totals, YTM at purchase + current, and the cashflow schedule itself.

import { generateBondCashflows, type BondCashflow } from "./cashflows";
import { computeYtm } from "./ytm";

export type BondProjection = {
  remainingCoupons: number;
  totalCouponsNative: number;
  totalCouponsEur: number;
  capitalGainAtMaturityNative: number;
  capitalGainAtMaturityEur: number;
  totalReturnEur: number;
  ytmAtPurchase: number;
  ytmCurrent: number;
  cashflows: BondCashflow[];
};

export function computeBondProjection(args: {
  today: Date;
  maturity: Date;
  couponRatePct: number;
  frequency: 1 | 2 | 4;
  faceValue: number;
  purchasePricePctPar: number;
  currentPricePctPar: number;
  fxToEur: number;
}): BondProjection {
  const {
    today,
    maturity,
    couponRatePct,
    frequency,
    faceValue,
    purchasePricePctPar,
    currentPricePctPar,
    fxToEur,
  } = args;

  const cashflows = generateBondCashflows({
    today,
    maturity,
    couponRatePct,
    faceValue,
    frequency,
  });

  let remainingCoupons = 0;
  let totalCouponsNative = 0;
  for (const cf of cashflows) {
    if (cf.couponAmount > 0) {
      remainingCoupons += 1;
      totalCouponsNative += cf.couponAmount;
    }
  }

  const totalCouponsEur = totalCouponsNative * fxToEur;

  const capitalGainAtMaturityNative =
    faceValue - (purchasePricePctPar * faceValue) / 100;
  const capitalGainAtMaturityEur = capitalGainAtMaturityNative * fxToEur;
  const totalReturnEur = totalCouponsEur + capitalGainAtMaturityEur;

  const ytmAtPurchase = computeYtm({
    pricePctPar: purchasePricePctPar,
    cashflows,
    today,
    faceValue,
    frequency,
  });
  const ytmCurrent = computeYtm({
    pricePctPar: currentPricePctPar,
    cashflows,
    today,
    faceValue,
    frequency,
  });

  return {
    remainingCoupons,
    totalCouponsNative,
    totalCouponsEur,
    capitalGainAtMaturityNative,
    capitalGainAtMaturityEur,
    totalReturnEur,
    ytmAtPurchase,
    ytmCurrent,
    cashflows,
  };
}
