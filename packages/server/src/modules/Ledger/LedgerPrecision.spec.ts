import { ILedgerEntry } from './types/Ledger.types';
import { roundToLedgerPrecision } from './LedgerPrecision';

const leg = (debit: number, credit: number) =>
  ({ debit, credit, accountId: 1 }) as ILedgerEntry;

describe('roundToLedgerPrecision', () => {
  it('throws when the carrier is not one of the entries', () => {
    const deposit = leg(1, 0);
    const incomes = [leg(0, 1 / 3), leg(0, 1 / 3), leg(0, 1 / 3)];
    // A copy of an entry is not the entry: the remainder would be lost.
    const copy = { ...incomes[0] };

    expect(() =>
      roundToLedgerPrecision([deposit, ...incomes], copy, 'credit'),
    ).toThrow('The rounding carrier is not one of the ledger entries.');
  });

  it('puts the remainder on the given side of the carrier', () => {
    const credit = leg(0, 1);
    const debits = [leg(1 / 3, 0), leg(1 / 3, 0), leg(1 / 3, 0)];

    const rounded = roundToLedgerPrecision(
      [credit, ...debits],
      debits[0],
      'debit',
    );

    expect(rounded.map((entry) => entry.debit)).toEqual([
      0, 0.334, 0.333, 0.333,
    ]);
    expect(rounded.map((entry) => entry.credit)).toEqual([1, 0, 0, 0]);
  });
});
