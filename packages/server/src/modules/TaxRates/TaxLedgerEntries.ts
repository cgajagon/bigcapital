import { AccountNormal } from '@/modules/Accounts/Accounts.types';
import { ILedgerEntry } from '@/modules/Ledger/types/Ledger.types';

/**
 * Builds the tax payable ledger entries of a document, one per tax amount.
 * Amounts of 0 post no entry; negative amounts post as negative entries on
 * the same side, so the tax reports count them unchanged.
 * @param params.taxes - Tax amounts, already in the organization's currency.
 * @param params.side - `credit` for sales documents, `debit` for purchases.
 * @param params.taxPayableAccountId - The default tax payable account.
 * @param params.payableAccountIdByTaxRateId - The payable account of each tax
 *   rate that has one; a rate missing from it posts to the default account.
 * @returns {ILedgerEntry[]}
 */
export function buildTaxLedgerEntries(params: {
  taxes: Array<{ amount: number; taxRateId: number; taxRate: number }>;
  side: 'credit' | 'debit';
  taxPayableAccountId: number;
  payableAccountIdByTaxRateId?: Record<number, number>;
  commonEntry: Partial<ILedgerEntry>;
  indexGroup: number;
  startIndex: number;
}): ILedgerEntry[] {
  const {
    taxes,
    side,
    taxPayableAccountId,
    payableAccountIdByTaxRateId = {},
    commonEntry,
    indexGroup,
    startIndex,
  } = params;

  return taxes
    .filter((tax) => tax.amount !== 0)
    .map(
      (tax, index) =>
        ({
          ...commonEntry,
          debit: side === 'debit' ? tax.amount : 0,
          credit: side === 'credit' ? tax.amount : 0,
          accountId:
            payableAccountIdByTaxRateId[tax.taxRateId] ?? taxPayableAccountId,
          accountNormal: AccountNormal.CREDIT,
          index: startIndex + index,
          indexGroup,
          taxRateId: tax.taxRateId,
          taxRate: tax.taxRate,
        }) as ILedgerEntry,
    );
}
