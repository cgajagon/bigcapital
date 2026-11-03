import * as moment from 'moment';
import { ILedgerEntry } from '@/modules/Ledger/types/Ledger.types';
import { ItemEntry } from '@/modules/TransactionItemEntry/models/ItemEntry';
import { Bill } from '../models/Bill';
import { AccountNormal } from '@/modules/Accounts/Accounts.types';
import { Ledger } from '@/modules/Ledger/Ledger';
import {
  getLargestLedgerEntry,
  roundToLedgerPrecision,
} from '@/modules/Ledger/LedgerPrecision';
import { getDocumentLineTaxes } from '@/modules/TaxRates/utils';
import { buildTaxLedgerEntries } from '@/modules/TaxRates/TaxLedgerEntries';
import {
  IBillItemAllocatedCost,
  IBillLandedCostLedgerEntry,
} from '../integrations/BillLandedCostsBridge';
import { AccountingBasis } from '@/common/types/AccountingBasis';

export class BillGL {
  private bill: Bill;
  private itemAllocatedCosts: Map<number, number>;
  private landedCostLedgerEntries: IBillLandedCostLedgerEntry[];
  private payableAccountId: number;
  private taxPayableAccountId: number;
  private purchaseDiscountAccountId: number;
  private otherExpensesAccountId: number;

  constructor(
    bill: Bill,
    itemAllocatedCosts: IBillItemAllocatedCost[] = [],
    landedCostLedgerEntries: IBillLandedCostLedgerEntry[] = [],
  ) {
    this.bill = bill;
    this.itemAllocatedCosts = new Map(
      itemAllocatedCosts.map((item) => [item.entryId, item.amount]),
    );
    this.landedCostLedgerEntries = landedCostLedgerEntries;
  }

  setPayableAccountId(payableAccountId: number) {
    this.payableAccountId = payableAccountId;
    return this;
  }

  setTaxPayableAccountId(taxPayableAccountId: number) {
    this.taxPayableAccountId = taxPayableAccountId;
    return this;
  }

  setPurchaseDiscountAccountId(purchaseDiscountAccountId: number) {
    this.purchaseDiscountAccountId = purchaseDiscountAccountId;
    return this;
  }

  setOtherExpensesAccountId(otherExpensesAccountId: number) {
    this.otherExpensesAccountId = otherExpensesAccountId;
    return this;
  }

  /**
   * Retrieves the bill common entry.
   * @returns {ILedgerEntry}
   */
  private get billCommonEntry() {
    return {
      basis: AccountingBasis.Accrual,

      debit: 0,
      credit: 0,

      currencyCode: this.bill.currencyCode,
      exchangeRate: this.bill.exchangeRate || 1,

      transactionId: this.bill.id,
      transactionType: 'Bill',

      date: moment(this.bill.billDate).format('YYYY-MM-DD'),
      userId: this.bill.userId,

      referenceNumber: this.bill.referenceNo,
      transactionNumber: this.bill.billNumber,

      branchId: this.bill.branchId,
      projectId: this.bill.projectId,

      createdAt: this.bill.createdAt,
    };
  }

  /**
   * Retrieves the bill item inventory/cost entry.
   * A tax-inclusive line's expense excludes its allocated line tax.
   * @param {ItemEntry} entry - Item entry.
   * @param {number} lineTax - The line tax, allocated to the stored document tax.
   * @param {number} index - Index.
   */
  private getBillItemEntry(
    entry: ItemEntry,
    lineTax: number,
    index: number,
  ): ILedgerEntry {
    const commonJournalMeta = this.billCommonEntry;
    const includedTax = entry.isInclusiveTax ? lineTax : 0;
    const totalLocal =
      this.bill.exchangeRate *
      (entry.amount - includedTax - entry.discountAmount);
    const landedCostAmount = this.itemAllocatedCosts.get(entry.id) ?? 0;

    return {
      ...commonJournalMeta,
      debit: totalLocal + landedCostAmount,
      accountId:
        ['inventory'].indexOf(entry.item.type) !== -1
          ? entry.item.inventoryAccountId
          : entry.costAccountId,
      index: index + 1,
      indexGroup: 10,
      itemId: entry.itemId,
      accountNormal: AccountNormal.DEBIT,
    };
  }

  /**
   * Retrieves the bill landed cost entry.
   * @param {IBillLandedCostLedgerEntry} landedCost - Landed cost
   * @param {number} index - Index
   */
  private getBillLandedCostEntry(
    landedCost: IBillLandedCostLedgerEntry,
    _index: number,
  ): ILedgerEntry {
    const commonJournalMeta = this.billCommonEntry;

    return {
      ...commonJournalMeta,
      credit: landedCost.amount,
      accountId: landedCost.costAccountId,
      accountNormal: AccountNormal.DEBIT,
      index: 1,
      indexGroup: 20,
    };
  }

  /**
   * Retrieves the bill payable entry.
   * @returns {ILedgerEntry}
   */
  private get billPayableEntry(): ILedgerEntry {
    const commonJournalMeta = this.billCommonEntry;

    return {
      ...commonJournalMeta,
      credit: this.bill.totalLocal,
      accountId: this.payableAccountId,
      contactId: this.bill.vendorId,
      accountNormal: AccountNormal.CREDIT,
      index: 1,
      indexGroup: 5,
    };
  }

  /**
   * Retrieves the bill tax GL entries, one per taxed line.
   * @param {number[]} lineTaxes - Line taxes, allocated to the stored document tax.
   * @returns {ILedgerEntry[]}
   */
  private getBillTaxEntries = (lineTaxes: number[]): ILedgerEntry[] => {
    const exchangeRate = this.bill.exchangeRate || 1;

    return buildTaxLedgerEntries({
      taxes: this.bill.entries.map((entry, index) => ({
        amount: lineTaxes[index] * exchangeRate,
        taxRateId: entry.taxRateId,
        taxRate: entry.taxRate,
      })),
      side: 'debit',
      taxPayableAccountId: this.taxPayableAccountId,
      commonEntry: this.billCommonEntry,
      indexGroup: 30,
      startIndex: 0,
    });
  };

  /**
   * Retrieves the purchase discount GL entry.
   * @returns {ILedgerEntry}
   */
  private get purchaseDiscountEntry(): ILedgerEntry {
    const commonEntry = this.billCommonEntry;

    return {
      ...commonEntry,
      credit: this.bill.discountAmountLocal,
      accountId: this.purchaseDiscountAccountId,
      accountNormal: AccountNormal.DEBIT,
      index: 1,
      indexGroup: 40,
    };
  }

  /**
   * Retrieves the purchase other charges GL entry.
   * @returns {ILedgerEntry}
   */
  private get adjustmentEntry(): ILedgerEntry {
    const commonEntry = this.billCommonEntry;
    const adjustmentAmount = Math.abs(this.bill.adjustmentLocal);

    return {
      ...commonEntry,
      debit: this.bill.adjustmentLocal > 0 ? adjustmentAmount : 0,
      credit: this.bill.adjustmentLocal < 0 ? adjustmentAmount : 0,
      accountId: this.otherExpensesAccountId,
      accountNormal: AccountNormal.DEBIT,
      index: 1,
      indexGroup: 40,
    };
  }

  /**
   * Retrieves the given bill GL entries, rounded to the ledger precision.
   * The rounding remainder goes on the largest expense entry.
   * @returns {ILedgerEntry[]}
   */
  private getBillGLEntries = (): ILedgerEntry[] => {
    const payableEntry = this.billPayableEntry;
    const lineTaxes = getDocumentLineTaxes(this.bill);

    const itemsEntries = this.bill.entries.map((entry, index) =>
      this.getBillItemEntry(entry, lineTaxes[index], index),
    );
    const landedCostEntries = this.landedCostLedgerEntries.map(
      (landedCost, index) => this.getBillLandedCostEntry(landedCost, index),
    );
    // The largest expense entry by absolute amount, the first one on a tie.
    const largestDebitEntry = getLargestLedgerEntry(itemsEntries, 'debit');

    return roundToLedgerPrecision(
      [
        payableEntry,
        ...itemsEntries,
        ...landedCostEntries,
        ...this.getBillTaxEntries(lineTaxes),
        this.purchaseDiscountEntry,
        this.adjustmentEntry,
      ],
      largestDebitEntry,
      'debit',
    );
  };

  /**
   * Retrieves the given bill ledger.
   * @returns {Ledger}
   */
  public getBillLedger = () => {
    const entries = this.getBillGLEntries();

    return new Ledger(entries);
  };
}
