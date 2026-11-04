import { haveSameComponents, sumComponentRates } from './TaxRateGroups';

describe('sumComponentRates', () => {
  it.each([
    [[5, 9.975], 14.975],
    [[5, 9.975, 0.0001], 14.9751],
  ])('%j sums to %j', (rates, expected) => {
    expect(sumComponentRates(rates)).toBe(expected);
  });
});

describe('haveSameComponents', () => {
  it.each([
    [[1, 2], [1, 2], true],
    [[1, 2], [2, 1], false],
    [[1, 2], [1, 2, 3], false],
  ])('%j and %j gives %j', (a, b, expected) => {
    expect(haveSameComponents(a, b)).toBe(expected);
  });
});
