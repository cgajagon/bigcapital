import * as moment from 'moment';
import { defaultTo } from 'lodash';
import { roundHalfAwayFromZero } from '@bigcapital/utils';
import { ILedgerEntry } from '@/modules/Ledger/types/Ledger.types';
import { Ledger } from '@/modules/Ledger/Ledger';
import {
  getLargestLedgerEntry,
  LEDGER_DECIMALS,
  roundToLedgerPrecision,
} from '@/modules/Ledger/LedgerPrecision';
import { getDocumentLineTaxes } from '@/modules/TaxRates/utils';
import { buildTaxLedgerEntries } from '@/modules/TaxRates/TaxLedgerEntries';
import { AccountNormal } from '@/interfaces/Account';
import { ItemEntry } from '@/modules/TransactionItemEntry/models/ItemEntry';
import { Bill } from '@/modules/Bills/models/Bill';
import { AccountingBasis } from '@/common/types/AccountingBasis';
import { BillPayment } from '../models/BillPayment';
import { BillPaymentEntry } from '../models/BillPaymentEntry';

/**
 * Records the cash basis journal entries of the bill payment.
 * The cash basis recognizes the purchase expenses of the associated bill(s)
 * once the payment is made instead of the accounts payable.
 *
 * The entries mirror the expense composition of the bill (the cost/inventory
 * accounts, tax payable, discount, and other charges) scaled by the paid
 * proportion of the bill.
 *
 * The tax of each line is recognized to the cent in the bill currency,
 * cumulatively: a payment posts the increase in the line tax rounded on the
 * amount paid so far, so the payments of a fully paid bill post exactly the
 * tax of the bill journal. The expense of the line carries the rest of its
 * share, and the entries of each bill are
 * rounded to the ledger precision with the remainder on the largest expense
 * entry.
 */
export class BillPaymentCashGL {
  private readonly billPayment: BillPayment;
  private readonly paidBeforeByBillId: Record<number, number>;

  private taxPayableAccountId: number;
  private purchaseDiscountAccountId: number;
  private otherExpensesAccountId: number;

  /**
   * Constructor method.
   * @param {BillPayment} billPayment - Bill payment.
   * @param {Record<number, number>} paidBeforeByBillId - Amount of each bill
   *   paid by earlier payments, in the bill currency.
   */
  constructor(
    billPayment: BillPayment,
    paidBeforeByBillId: Record<number, number>,
  ) {
    this.billPayment = billPayment;
    this.paidBeforeByBillId = paidBeforeByBillId;
  }

  /**
   * Sets the tax payable account id.
   * @param {number} taxPayableAccountId - Tax payable account id.
   * @returns {BillPaymentCashGL}
   */
  setTaxPayableAccountId(taxPayableAccountId: number) {
    this.taxPayableAccountId = taxPayableAccountId;
    return this;
  }

  /**
   * Sets the purchase discount account id.
   * @param {number} purchaseDiscountAccountId - Purchase discount account id.
   * @returns {BillPaymentCashGL}
   */
  setPurchaseDiscountAccountId(purchaseDiscountAccountId: number) {
    this.purchaseDiscountAccountId = purchaseDiscountAccountId;
    return this;
  }

  /**
   * Sets the other expenses account id.
   * @param {number} otherExpensesAccountId - Other expenses account id.
   * @returns {BillPaymentCashGL}
   */
  setOtherExpensesAccountId(otherExpensesAccountId: number) {
    this.otherExpensesAccountId = otherExpensesAccountId;
    return this;
  }

  /**
   * Retrieves the common journal entry of the cash basis entries.
   */
  private get cashEntriesCommonEntry() {
    return {
      credit: 0,
      debit: 0,

      currencyCode: this.billPayment.currencyCode,
      exchangeRate: this.billPayment.exchangeRate,

      transactionId: this.billPayment.id,
      transactionType: 'BillPayment',

      transactionNumber: this.billPayment.paymentNumber,
      referenceNumber: this.billPayment.reference,

      date: moment(this.billPayment.paymentDate).format('YYYY-MM-DD'),
      createdAt: this.billPayment.createdAt,

      branchId: this.billPayment.branchId,

      indexGroup: 50,

      basis: AccountingBasis.Cash,
    };
  }

  /**
   * Retrieves the paid amount of the given payment entry in local currency.
   * @param {BillPaymentEntry} entry - Bill payment entry.
   * @returns {number}
   */
  private getPaymentEntryLocalAmount = (entry: BillPaymentEntry): number => {
    return entry.paymentAmount * defaultTo(this.billPayment.exchangeRate, 1);
  };

  /**
   * Retrieves the paid proportion of the associated bill.
   * The paid amount in local currency over the bill total in local currency
   * keeps the cash basis entries balanced for partial payments.
   * It is 0 when the bill total is not positive, so the entry posts nothing.
   * @param {BillPaymentEntry} entry - Bill payment entry.
   * @returns {number}
   */
  private getPaymentEntryRatio = (entry: BillPaymentEntry): number => {
    const billTotalLocal = defaultTo(entry.bill?.totalLocal, 0);
    const paidLocalAmount = this.getPaymentEntryLocalAmount(entry);

    if (billTotalLocal <= 0) {
      return 0;
    }
    return paidLocalAmount / billTotalLocal;
  };

  /**
   * Retrieves the payment account (cash/bank) credit entry of the paid amount.
   * @param {BillPaymentEntry} entry - Bill payment entry.
   * @returns {ILedgerEntry}
   */
  private getPaymentEntryPaymentAccountEntry = (
    entry: BillPaymentEntry,
  ): ILedgerEntry => {
    return {
      ...this.cashEntriesCommonEntry,
      credit: this.getPaymentEntryLocalAmount(entry),
      accountId: this.billPayment.paymentAccountId,
      index: 1,
      accountNormal: AccountNormal.DEBIT,
    };
  };

  /**
   * Retrieves the tax of each bill line recognized by the given payment
   * entry, in local currency.
   * The tax recognized once `x` of the bill is paid is rounded to the cent
   * in the bill currency, then converted to the ledger precision:
   * `cum(x) = round3(round2(lineTax × x / bill total) × exchangeRate)`.
   * The entry posts `cum(paidBefore + paymentAmount) − cum(paidBefore)`, so
   * the payments of a fully paid bill post `round3(lineTax × exchangeRate)`,
   * the bill journal's tax entry.
   * @param {Bill} bill - Bill, with a non-zero total.
   * @param {number[]} lineTaxes - Line taxes, allocated to the stored bill tax.
   * @param {number} paidBefore - Amount of the bill paid before the entry.
   * @param {number} paymentAmount - Amount of the bill paid by the entry.
   * @returns {number[]}
   */
  private getPaymentEntryLineTaxes = (
    bill: Bill,
    lineTaxes: number[],
    paidBefore: number,
    paymentAmount: number,
  ): number[] => {
    const billExchangeRate = defaultTo(bill.exchangeRate, 1);
    const cumulativeTax = (lineTax: number, paidAmount: number) =>
      roundHalfAwayFromZero(
        roundHalfAwayFromZero((lineTax * paidAmount) / bill.total, 2) *
          billExchangeRate,
        LEDGER_DECIMALS,
      );

    return lineTaxes.map((lineTax) =>
      lineTax === 0
        ? 0
        : roundHalfAwayFromZero(
            cumulativeTax(lineTax, paidBefore + paymentAmount) -
              cumulativeTax(lineTax, paidBefore),
            LEDGER_DECIMALS,
          ),
    );
  };

  /**
   * Retrieves the cost/inventory accounts debit entries mirroring the bill items.
   * @param {Bill} bill - Bill.
   * @param {number} ratio - Paid proportion of the bill.
   * @param {number[]} lineTaxes - Line taxes, allocated to the stored bill tax.
   * @param {number[]} paymentLineTaxes - Line taxes recognized by the payment.
   * @returns {ILedgerEntry[]}
   */
  private getPaymentEntryItemEntries = (
    bill: Bill,
    ratio: number,
    lineTaxes: number[],
    paymentLineTaxes: number[],
  ): ILedgerEntry[] => {
    const billEntries = bill.entries || [];
    const billExchangeRate = defaultTo(bill.exchangeRate, 1);

    return billEntries.map((item, index) =>
      this.getBillItemCashEntry(
        item,
        index,
        ratio,
        billExchangeRate,
        lineTaxes[index],
        paymentLineTaxes[index],
      ),
    );
  };

  /**
   * Retrieves the tax payable debit entries mirroring the bill taxes, one per
   * taxed line; negative tax posts as a negative debit.
   * @param {Bill} bill - Bill.
   * @param {number[]} paymentLineTaxes - Line taxes recognized by the payment.
   * @returns {ILedgerEntry[]}
   */
  private getPaymentEntryTaxEntries = (
    bill: Bill,
    paymentLineTaxes: number[],
  ): ILedgerEntry[] => {
    const billEntries = bill.entries || [];

    return buildTaxLedgerEntries({
      taxes: billEntries.map((item, index) => ({
        amount: paymentLineTaxes[index],
        taxRateId: item.taxRateId,
        taxRate: item.taxRate,
      })),
      side: 'debit',
      taxPayableAccountId: this.taxPayableAccountId,
      commonEntry: this.cashEntriesCommonEntry,
      indexGroup: 50,
      startIndex: billEntries.length + 2,
    });
  };

  /**
   * Retrieves the discount entry mirroring the bill discount.
   * @param {Bill} bill - Bill.
   * @param {number} ratio - Paid proportion of the bill.
   * @returns {ILedgerEntry[]}
   */
  private getPaymentEntryDiscountEntry = (
    bill: Bill,
    ratio: number,
  ): ILedgerEntry[] => {
    return bill.discountAmountLocal
      ? [
          {
            ...this.cashEntriesCommonEntry,
            credit: bill.discountAmountLocal * ratio,
            accountId: this.purchaseDiscountAccountId,
            accountNormal: AccountNormal.DEBIT,
            index: 1,
          },
        ]
      : [];
  };

  /**
   * Retrieves the other charges (adjustment) entry mirroring the bill adjustment.
   * @param {Bill} bill - Bill.
   * @param {number} ratio - Paid proportion of the bill.
   * @returns {ILedgerEntry[]}
   */
  private getPaymentEntryAdjustmentEntry = (
    bill: Bill,
    ratio: number,
  ): ILedgerEntry[] => {
    const adjustmentAmount = defaultTo(bill.adjustmentLocal, 0);

    return bill.adjustmentLocal
      ? [
          {
            ...this.cashEntriesCommonEntry,
            debit: adjustmentAmount > 0 ? adjustmentAmount * ratio : 0,
            credit:
              adjustmentAmount < 0 ? Math.abs(adjustmentAmount) * ratio : 0,
            accountId: this.otherExpensesAccountId,
            accountNormal: AccountNormal.DEBIT,
            index: 1,
          },
        ]
      : [];
  };

  /**
   * Retrieves the cash basis entries of the given payment entry (bill
   * allocation), rounded to the ledger precision. The rounding remainder goes
   * on the largest expense entry.
   * @param {BillPaymentEntry} entry - Bill payment entry.
   * @param {number} paidBefore - Amount of the bill paid before the entry.
   * @returns {ILedgerEntry[]}
   */
  private getPaymentEntryCashEntries = (
    entry: BillPaymentEntry,
    paidBefore: number,
  ): ILedgerEntry[] => {
    const bill = entry.bill;
    // A zero bill total gives a zero ratio, so nothing divides by it.
    const ratio = this.getPaymentEntryRatio(entry);

    if (!bill || ratio <= 0) {
      return [];
    }
    const lineTaxes = getDocumentLineTaxes(bill);
    const paymentLineTaxes = this.getPaymentEntryLineTaxes(
      bill,
      lineTaxes,
      paidBefore,
      entry.paymentAmount,
    );
    const itemEntries = this.getPaymentEntryItemEntries(
      bill,
      ratio,
      lineTaxes,
      paymentLineTaxes,
    );
    // The largest expense entry by absolute amount, the first one on a tie.
    const largestItemEntry = getLargestLedgerEntry(itemEntries, 'debit');

    return roundToLedgerPrecision(
      [
        this.getPaymentEntryPaymentAccountEntry(entry),
        ...itemEntries,
        ...this.getPaymentEntryTaxEntries(bill, paymentLineTaxes),
        ...this.getPaymentEntryDiscountEntry(bill, ratio),
        ...this.getPaymentEntryAdjustmentEntry(bill, ratio),
      ],
      largestItemEntry,
      'debit',
    );
  };

  /**
   * Retrieves the cash basis entry of the given bill item.
   * The line's share of the payment is its expense plus its tax; the entry
   * carries the share less the tax the payment recognizes on the line.
   * @param {ItemEntry} item - Bill item entry.
   * @param {number} index - Item entry index.
   * @param {number} ratio - Paid proportion of the bill.
   * @param {number} billExchangeRate - Bill exchange rate.
   * @param {number} lineTax - The line tax, allocated to the stored bill tax.
   * @param {number} paymentLineTax - The line tax recognized by the payment.
   * @returns {ILedgerEntry}
   */
  private getBillItemCashEntry = (
    item: ItemEntry,
    index: number,
    ratio: number,
    billExchangeRate: number,
    lineTax: number,
    paymentLineTax: number,
  ): ILedgerEntry => {
    // A tax-inclusive line's amount already includes its tax.
    const lineTotal =
      item.totalExcludingTax + (item.isInclusiveTax ? item.taxAmount : lineTax);

    return {
      ...this.cashEntriesCommonEntry,
      debit: lineTotal * billExchangeRate * ratio - paymentLineTax,
      accountId:
        ['inventory'].indexOf(item.item.type) !== -1
          ? item.item.inventoryAccountId
          : item.costAccountId,
      index: index + 2,
      itemId: item.itemId,
      accountNormal: AccountNormal.DEBIT,
    };
  };

  /**
   * Retrieves the bill payment cash basis GL entries.
   * @returns {ILedgerEntry[]}
   */
  public GLEntries(): ILedgerEntry[] {
    // An earlier entry of this payment on the same bill is paid before too.
    const paidBefore = { ...this.paidBeforeByBillId };

    return this.billPayment.entries.flatMap((entry) => {
      const entryPaidBefore = defaultTo(paidBefore[entry.billId], 0);
      paidBefore[entry.billId] = entryPaidBefore + entry.paymentAmount;

      return this.getPaymentEntryCashEntries(entry, entryPaidBefore);
    });
  }

  /**
   * Retrieves the bill payment cash basis ledger.
   * @returns {Ledger}
   */
  public getLedger = (): Ledger => {
    return new Ledger(this.GLEntries());
  };
}
