import { roundHalfAwayFromZero, computeLineTaxAmount } from '@bigcapital/utils';

describe('roundHalfAwayFromZero', () => {
  it.each([
    [0.615, 0.62],
    [1.005, 1.01],
    [2.675, 2.68],
    [5.615625, 5.62],
    [3.29175, 3.29],
    [-0.225, -0.23],
    [-1.005, -1.01],
    [0.004, 0],
  ])('%p -> %p', (value, expected) =>
    expect(roundHalfAwayFromZero(value)).toBe(expected),
  );
  it('never returns -0', () =>
    expect(Object.is(roundHalfAwayFromZero(-0.004), 0)).toBe(true));
  it('rounds to 3 decimals when asked', () =>
    expect(roundHalfAwayFromZero(1.0005, 3)).toBe(1.001));
});

describe('computeLineTaxAmount', () => {
  it.each([
    [37.5, 14.975, false, 5.62],
    [-4.5, 14.975, false, -0.67],
    [37.5, 5, false, 1.88],
    [-4.5, 5, false, -0.23],
    [12.3, 5, false, 0.62],
    [37.5, 9.975, false, 3.74],
    [-4.5, 9.975, false, -0.45],
    [1000, 10, false, 100],
    [1100, 10, true, 100],
    [-114.975, 14.975, true, -14.98],
    [100, 0, false, 0],
  ])('(%p, %p, %p) -> %p', (amount, rate, inclusive, expected) =>
    expect(computeLineTaxAmount(amount, rate, inclusive)).toBe(expected),
  );
});
