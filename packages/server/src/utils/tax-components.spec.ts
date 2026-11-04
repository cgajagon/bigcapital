import {
  aggregateComponentTaxes,
  computeLineComponentTaxes,
  computeLineTaxAmount,
} from '@bigcapital/utils';

const TPS = { taxRateId: 1, rate: 5 };
const TVQ = { taxRateId: 2, rate: 9.975 };

describe('computeLineComponentTaxes', () => {
  it.each([
    ['exclusive 37.5', 37.5, [TPS, TVQ], false, [1.88, 3.74]],
    ['exclusive -4.5', -4.5, [TPS, TVQ], false, [-0.23, -0.45]],
    ['inclusive 114.975', 114.975, [TPS, TVQ], true, [5, 9.98]],
    ['inclusive -114.975', -114.975, [TPS, TVQ], true, [-5, -9.98]],
    [
      'single component inclusive',
      1100,
      [{ taxRateId: 3, rate: 10 }],
      true,
      [100],
    ],
    [
      'zero-rate component',
      100,
      [TPS, { taxRateId: 4, rate: 0 }],
      false,
      [5, 0],
    ],
    ['no components', 100, [], false, []],
  ])('%s', (_name, amount, components, inclusive, expected) => {
    const result = computeLineComponentTaxes(
      amount as number,
      components as any,
      inclusive as boolean,
    );
    expect(result.map((c) => c.amount)).toEqual(expected);
    expect(
      result.map((c) => ({ taxRateId: c.taxRateId, rate: c.rate })),
    ).toEqual(components);
  });

  it('matches computeLineTaxAmount for a single component', () => {
    const [c] = computeLineComponentTaxes(
      1100,
      [{ taxRateId: 3, rate: 10 }],
      true,
    );
    expect(c.amount).toBe(computeLineTaxAmount(1100, 10, true));
  });
});

describe('aggregateComponentTaxes', () => {
  it('sums per taxRateId in order of first appearance', () => {
    const a = computeLineComponentTaxes(37.5, [TPS, TVQ], false);
    const b = computeLineComponentTaxes(-4.5, [TPS, TVQ], false);
    expect(aggregateComponentTaxes([a, b])).toEqual([
      { taxRateId: 1, rate: 5, amount: 1.65 },
      { taxRateId: 2, rate: 9.975, amount: 3.29 },
    ]);
  });
});
