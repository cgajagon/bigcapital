import * as R from 'ramda';
import { ILedger } from '@/modules/Ledger/types/Ledger.types';
import { AccountNormal } from '@/modules/Accounts/Accounts.types';
import { ILedgerEntry } from '@/modules/Ledger/types/Ledger.types';
import { ItemEntry } from '@/modules/TransactionItemEntry/models/ItemEntry';
import { Ledger } from '@/modules/Ledger/Ledger';
import {
  getLargestLedgerEntry,
  roundToLedgerPrecision,
} from '@/modules/Ledger/LedgerPrecision';
import { getDocumentLineTaxes } from '@/modules/TaxRates/utils';
import { buildTaxLedgerEntries } from '@/modules/TaxRates/TaxLedgerEntries';
import { SaleInvoice } from '../models/SaleInvoice';
import { AccountingBasis } from '@/common/types/AccountingBasis';

export class InvoiceAccrualGL {
  private saleInvoice: SaleInvoice;
  private ARAccountId: number;
  private taxPayableAccountId: number;
  private discountAccountId: number;
  private otherChargesAccountId: number;

  /**
   * Constructor method.
   * @param {SaleInvoice} saleInvoice - Sale invoice.
   */
  constructor(saleInvoice: SaleInvoice) {
    this.saleInvoice = saleInvoice;
  }

  /**
   * Set the receivable account id.
   * @param {number} ARAccountId - Receivable account id.
   */
  setARAccountId(ARAccountId: number) {
    this.ARAccountId = ARAccountId;
  }

  /**
   * Set the tax payable account id.
   * @param {number} taxPayableAccountId - Tax payable account id.
   */
  setTaxPayableAccountId(taxPayableAccountId: number) {
    this.taxPayableAccountId = taxPayableAccountId;
  }

  /**
   * Set the discount account id.
   * @param {number} discountAccountId - Discount account id.
   */
  setDiscountAccountId(discountAccountId: number) {
    this.discountAccountId = discountAccountId;
  }

  /**
   * Set the other charges account id.
   * @param {number} otherChargesAccountId - Other charges account id.
   */
  setOtherChargesAccountId(otherChargesAccountId: number) {
    this.otherChargesAccountId = otherChargesAccountId;
  }

  /**
   * Retrieves the invoice GL common entry.
   */
  private get invoiceGLCommonEntry() {
    return {
      credit: 0,
      debit: 0,

      currencyCode: this.saleInvoice.currencyCode,
      exchangeRate: this.saleInvoice.exchangeRate,

      transactionType: 'SaleInvoice',
      transactionId: this.saleInvoice.id,

      date: this.saleInvoice.invoiceDate,
      userId: this.saleInvoice.userId,

      transactionNumber: this.saleInvoice.invoiceNo,
      referenceNumber: this.saleInvoice.referenceNo,

      createdAt: this.saleInvoice.createdAt,
      indexGroup: 10,

      branchId: this.saleInvoice.branchId,

      basis: AccountingBasis.Accrual,
    };
  }

  /**
   * Retrieve receivable entry of the invoice.
   * @returns {ILedgerEntry}
   */
  public get invoiceReceivableEntry(): ILedgerEntry {
    const commonEntry = this.invoiceGLCommonEntry;

    return {
      ...commonEntry,
      debit: this.saleInvoice.totalLocal,
      accountId: this.ARAccountId,
      contactId: this.saleInvoice.customerId,
      accountNormal: AccountNormal.DEBIT,
      index: 1,
    };
  }

  /**
   * Retrieve item income entry of the invoice.
   * A tax-inclusive line's income excludes its allocated line tax.
   * @param {ItemEntry} entry - Item entry.
   * @param {number} lineTax - The line tax, allocated to the stored document tax.
   * @param {number} index - Index.
   * @returns {ILedgerEntry}
   */
  private getInvoiceItemEntry = R.curry(
    (entry: ItemEntry, lineTax: number, index: number): ILedgerEntry => {
      const commonEntry = this.invoiceGLCommonEntry;
      const includedTax = entry.isInclusiveTax ? lineTax : 0;
      const localAmount =
        (entry.amount - includedTax - entry.discountAmount) *
        this.saleInvoice.exchangeRate;

      return {
        ...commonEntry,
        credit: localAmount,
        accountId: entry.sellAccountId,
        note: entry.description,
        index: index + 2,
        itemId: entry.itemId,
        accountNormal: AccountNormal.CREDIT,
        taxRateId: entry.taxRateId,
        taxRate: entry.taxRate,
      };
    },
  );

  /**
   * Retreives the GL entries of tax payable, one per taxed line.
   * @param {number[]} lineTaxes - Line taxes, allocated to the stored document tax.
   * @returns {ILedgerEntry[]}
   */
  private getInvoiceTaxEntries(lineTaxes: number[]): ILedgerEntry[] {
    return buildTaxLedgerEntries({
      taxes: this.saleInvoice.entries.map((entry, index) => ({
        amount: lineTaxes[index] * this.saleInvoice.exchangeRate,
        taxRateId: entry.taxRateId,
        taxRate: entry.taxRate,
      })),
      side: 'credit',
      taxPayableAccountId: this.taxPayableAccountId,
      commonEntry: this.invoiceGLCommonEntry,
      indexGroup: 30,
      startIndex: 1,
    });
  }

  /**
   * Retrieves the invoice discount GL entry.
   * @returns {ILedgerEntry}
   */
  private get invoiceDiscountEntry(): ILedgerEntry {
    const commonEntry = this.invoiceGLCommonEntry;

    return {
      ...commonEntry,
      debit: this.saleInvoice.discountAmountLocal,
      accountId: this.discountAccountId,
      accountNormal: AccountNormal.CREDIT,
      index: 1,
    } as ILedgerEntry;
  }

  /**
   * Retrieves the invoice adjustment GL entry.
   * @returns {ILedgerEntry}
   */
  private get adjustmentEntry(): ILedgerEntry {
    const commonEntry = this.invoiceGLCommonEntry;
    const adjustmentAmount = Math.abs(this.saleInvoice.adjustmentLocal);

    return {
      ...commonEntry,
      debit: this.saleInvoice.adjustmentLocal < 0 ? adjustmentAmount : 0,
      credit: this.saleInvoice.adjustmentLocal > 0 ? adjustmentAmount : 0,
      accountId: this.otherChargesAccountId,
      accountNormal: AccountNormal.CREDIT,
      index: 1,
    };
  }

  /**
   * Retrieves the invoice GL entries, rounded to the ledger precision.
   * The rounding remainder goes on the largest income entry.
   * @returns {ILedgerEntry[]}
   */
  public getInvoiceGLEntries = (): ILedgerEntry[] => {
    const lineTaxes = getDocumentLineTaxes(this.saleInvoice);
    const creditEntries = this.saleInvoice.entries.map((entry, index) =>
      this.getInvoiceItemEntry(entry, lineTaxes[index], index),
    );
    const taxEntries = this.getInvoiceTaxEntries(lineTaxes);

    // The largest income entry by absolute amount, the first one on a tie.
    const largestCreditEntry = getLargestLedgerEntry(creditEntries, 'credit');

    return roundToLedgerPrecision(
      [
        this.invoiceReceivableEntry,
        ...creditEntries,
        ...taxEntries,
        this.invoiceDiscountEntry,
        this.adjustmentEntry,
      ],
      largestCreditEntry,
      'credit',
    );
  };

  /**
   * Retrieves the invoice ledger.
   * @returns {ILedger}
   */
  public getInvoiceLedger = (): ILedger => {
    const entries = this.getInvoiceGLEntries();
    return new Ledger(entries);
  };
}
