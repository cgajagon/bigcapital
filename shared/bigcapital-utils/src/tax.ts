/**
 * Rounds a number to `decimals` places, with halves rounded away from zero.
 * Binary float noise is stripped first (15 significant digits) so that values
 * such as 1.005 or 2.675 round the way their decimal notation suggests.
 * Never returns -0.
 */
export const roundHalfAwayFromZero = (value: number, decimals = 2): number => {
  if (!Number.isFinite(value)) return value;

  const magnitude = Math.abs(value);
  // Shift the decimal point through exponent notation to avoid float multiplication.
  const [mantissa, exponent] = magnitude.toExponential(14).split('e');
  const shifted = Number(`${mantissa}e${Number(exponent) + decimals}`);
  const rounded = Number(`${Math.floor(shifted + 0.5)}e-${decimals}`);

  return value < 0 && rounded !== 0 ? -rounded : rounded;
};

/**
 * Tax amount of a single line, rounded to cents (half away from zero).
 * Exclusive: amount * rate / 100. Inclusive: amount * rate / (100 + rate).
 */
export const computeLineTaxAmount = (
  amount: number,
  ratePercent: number,
  isInclusive: boolean,
): number => {
  if (!ratePercent) return 0;

  const raw = isInclusive
    ? (amount * ratePercent) / (100 + ratePercent)
    : (amount * ratePercent) / 100;

  return roundHalfAwayFromZero(raw);
};
