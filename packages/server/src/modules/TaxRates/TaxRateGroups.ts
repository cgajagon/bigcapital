import { roundHalfAwayFromZero } from '@bigcapital/utils';

/**
 * A tax group's rate: the sum of its components' rates, rounded to the 4
 * decimals the `tax_rates.rate` column keeps.
 * @param {number[]} rates - The component rates.
 * @returns {number}
 */
export const sumComponentRates = (rates: number[]): number =>
  roundHalfAwayFromZero(
    rates.reduce((sum, rate) => sum + Number(rate), 0),
    4,
  );

/**
 * Whether two lists of component ids are the same, in the same order.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {boolean}
 */
export const haveSameComponents = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);
