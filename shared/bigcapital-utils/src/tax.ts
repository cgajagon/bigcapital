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
  // Decimal columns can reach the client as strings ("5.0000"); a string rate
  // would turn `100 + rate` into a concatenation.
  amount = Number(amount);
  ratePercent = Number(ratePercent);
  if (!ratePercent) return 0;

  const raw = isInclusive
    ? (amount * ratePercent) / (100 + ratePercent)
    : (amount * ratePercent) / 100;

  return roundHalfAwayFromZero(raw);
};

export interface TaxComponentRate {
  taxRateId: number;
  rate: number;
}

export interface TaxComponentAmount extends TaxComponentRate {
  amount: number;
}

/**
 * Tax of one line split per group component, each rounded on its own (half
 * away from zero). Inclusive: amount * rate_i / (100 + R), R = sum of rates.
 */
export const computeLineComponentTaxes = (
  amount: number,
  components: TaxComponentRate[],
  isInclusive: boolean,
): TaxComponentAmount[] => {
  amount = Number(amount);
  const rated = components.map((c) => ({ ...c, rate: Number(c.rate) }));
  const totalRate = rated.reduce((sum, c) => sum + c.rate, 0);

  return rated.map(({ taxRateId, rate }) => ({
    taxRateId,
    rate,
    amount: !rate
      ? 0
      : isInclusive
        ? roundHalfAwayFromZero((amount * rate) / (100 + totalRate))
        : computeLineTaxAmount(amount, rate, false),
  }));
};

/**
 * Sums component taxes per taxRateId, in order of first appearance, keeping
 * the first-seen rate.
 */
export const aggregateComponentTaxes = (
  lines: TaxComponentAmount[][],
): TaxComponentAmount[] => {
  const byId = new Map<number, TaxComponentAmount>();

  for (const line of lines) {
    for (const c of line) {
      const found = byId.get(c.taxRateId);
      if (found) found.amount += c.amount;
      else byId.set(c.taxRateId, { ...c });
    }
  }
  return [...byId.values()].map((c) => ({
    ...c,
    amount: roundHalfAwayFromZero(c.amount),
  }));
};
