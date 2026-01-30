/**
 * BENJI / OYE math for tokens available to mint.
 * See docs/BENJI.md and docs/economic_engine.md.
 * Once the BENJI API is connected, principal and yield will come from the API;
 * this module provides the pure math so we can plug values in.
 */

/** Token value in USD (redemption amount). */
export const TOKEN_VALUE_USD = 25;

/**
 * Tokens available to mint from student share of yield (e.g. monthly).
 * Formula: (principal × (annualRate/12) × studentShare) / TOKEN_VALUE_USD
 * Use the student share for the current economic zone (e.g. 0.63 Normal, 1.0 Efficient).
 *
 * @param principalUSD - Invested principal (e.g. from BENJI AUM)
 * @param annualYieldRatePercent - Annual yield rate (e.g. 3.6 for 3.6%)
 * @param studentShare - Student share of yield (0–1), from OYE waterfall (e.g. 0.63)
 * @param periodMonths - Period for yield (default 1 = monthly)
 * @returns Number of tokens that can be minted in that period (floor)
 */
export function tokensAvailableToMint(
  principalUSD: number,
  annualYieldRatePercent: number,
  studentShare: number,
  periodMonths: number = 1
): number {
  if (
    !Number.isFinite(principalUSD) ||
    !Number.isFinite(annualYieldRatePercent) ||
    !Number.isFinite(studentShare) ||
    principalUSD <= 0 ||
    TOKEN_VALUE_USD <= 0
  ) {
    return 0;
  }
  const rateDecimal = annualYieldRatePercent / 100;
  const periodYield = principalUSD * (rateDecimal / 12) * periodMonths;
  const studentPortion = periodYield * Math.max(0, Math.min(1, studentShare));
  return Math.floor(studentPortion / TOKEN_VALUE_USD);
}
