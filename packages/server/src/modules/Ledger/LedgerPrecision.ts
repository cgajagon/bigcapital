import { roundHalfAwayFromZero } from '@bigcapital/utils';
import { ILedgerEntry } from './types/Ledger.types';

// `accounts_transactions` stores debit and credit as decimal(13,3).
export const LEDGER_DECIMALS = 3;
const LEDGER_UNITS = 10 ** LEDGER_DECIMALS;

export type LedgerSide = 'debit' | 'credit';

const toLedgerPrecision = (amount: number | null | undefined): number =>
  roundHalfAwayFromZero(amount || 0, LEDGER_DECIMALS);

const toLedgerUnits = (amount: number): number =>
  Math.round(amount * LEDGER_UNITS);

const getNetDebit = (entries: ILedgerEntry[]): number =>
  entries.reduce(
    (sum, entry) => sum + (entry.debit || 0) - (entry.credit || 0),
    0,
  );

/**
 * Retrieves the entry with the largest amount on the given side, by absolute
 * amount, the first one on a tie. It is the usual carrier of a rounding
 * remainder.
 * @param {ILedgerEntry[]} entries
 * @param {LedgerSide} side - The side whose amount is compared.
 * @returns {ILedgerEntry | undefined}
 */
export const getLargestLedgerEntry = (
  entries: ILedgerEntry[],
  side: LedgerSide,
): ILedgerEntry | undefined =>
  entries.reduce(
    (largest, entry) =>
      !largest || Math.abs(entry[side] || 0) > Math.abs(largest[side] || 0)
        ? entry
        : largest,
    undefined as ILedgerEntry | undefined,
  );

/**
 * Rounds the entries to the ledger precision. The remainder that rounding
 * leaves between debits and credits goes on the carrier, on its `carrierSide`,
 * so a journal that balances before rounding balances exactly once stored.
 * A difference the entries already had before rounding is not a rounding
 * remainder and is left as is.
 * @param {ILedgerEntry[]} entries - Entries, in the organization's currency.
 * @param {ILedgerEntry} carrier - One of `entries`, takes the remainder.
 * @param {LedgerSide} carrierSide - The side of the carrier that is adjusted.
 * @returns {ILedgerEntry[]} Rounded copies, in the same order.
 */
export const roundToLedgerPrecision = (
  entries: ILedgerEntry[],
  carrier?: ILedgerEntry,
  carrierSide: LedgerSide = 'credit',
): ILedgerEntry[] => {
  const rounded = entries.map((entry) => ({
    ...entry,
    debit: toLedgerPrecision(entry.debit),
    credit: toLedgerPrecision(entry.credit),
  }));
  // Net debit the rounding added; the carrier takes it back.
  const remainder =
    toLedgerUnits(getNetDebit(rounded)) - toLedgerUnits(getNetDebit(entries));
  const carrierIndex = entries.indexOf(carrier);

  if (remainder !== 0 && carrierIndex >= 0) {
    const carrierEntry = rounded[carrierIndex];
    const adjustment = carrierSide === 'credit' ? remainder : -remainder;

    rounded[carrierIndex] = {
      ...carrierEntry,
      [carrierSide]:
        (toLedgerUnits(carrierEntry[carrierSide]) + adjustment) / LEDGER_UNITS,
    };
  }
  return rounded;
};
