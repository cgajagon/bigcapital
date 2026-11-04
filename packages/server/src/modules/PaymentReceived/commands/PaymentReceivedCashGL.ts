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
import { PaymentReceived } from '../models/PaymentReceived';
import { PaymentReceivedEntry } from '../models/PaymentReceivedEntry';
import { SaleInvoice } from '@/modules/SaleInvoices/models/SaleInvoice';
import { AccountingBasis } from '@/common/types/AccountingBasis';

/**
 * Records the cash basis journal entries of the payment received.
 * The cash basis recognizes the income of the associated invoice(s)
 * once the payment is received instead of the account receivable.
 *
 * The entries mirror the income composition of the invoice (the income
 * accounts, tax payable, discount, and other charges) scaled by the paid
 * proportion of the invoice.
 *
 * The tax of each line is recognized to the cent in the invoice currency,
 * cumulatively: a payment posts the increase in the line tax rounded on the
 * amount paid so far, so the payments of a fully paid invoice post exactly
 * the tax of the invoice journal. The income of the line carries the rest
 * of its share, and the entries of each invoice
 * are rounded to the ledger precision with the remainder on the largest
 * income entry.
 */
export class PaymentReceivedCashGL {
  private readonly paymentReceived: PaymentReceived;
  private readonly paidBeforeByInvoiceId: Record<number, number>;

  private taxPayableAccountId: number;
  private discountAccountId: number;
  private otherChargesAccountId: number;

  /**
   * Constructor method.
   * @param {PaymentReceived} paymentReceived - Payment received.
   * @param {Record<number, number>} paidBeforeByInvoiceId - Amount of each
   *   invoice paid by earlier payments, in the invoice currency.
   */
  constructor(
    paymentReceived: PaymentReceived,
    paidBeforeByInvoiceId: Record<number, number>,
  ) {
    this.paymentReceived = paymentReceived;
    this.paidBeforeByInvoiceId = paidBeforeByInvoiceId;
  }

  /**
   * Sets the tax payable account id.
   * @param {number} taxPayableAccountId - Tax payable account id.
   * @returns {PaymentReceivedCashGL}
   */
  setTaxPayableAccountId(taxPayableAccountId: number) {
    this.taxPayableAccountId = taxPayableAccountId;
    return this;
  }

  /**
   * Sets the discount account id.
   * @param {number} discountAccountId - Discount account id.
   * @returns {PaymentReceivedCashGL}
   */
  setDiscountAccountId(discountAccountId: number) {
    this.discountAccountId = discountAccountId;
    return this;
  }

  /**
   * Sets the other charges account id.
   * @param {number} otherChargesAccountId - Other charges account id.
   * @returns {PaymentReceivedCashGL}
   */
  setOtherChargesAccountId(otherChargesAccountId: number) {
    this.otherChargesAccountId = otherChargesAccountId;
    return this;
  }

  /**
   * Retrieves the common journal entry of the cash basis entries.
   */
  private get cashEntriesCommonEntry() {
    return {
      credit: 0,
      debit: 0,

      currencyCode: this.paymentReceived.currencyCode,
      exchangeRate: this.paymentReceived.exchangeRate,

      transactionId: this.paymentReceived.id,
      transactionType: 'PaymentReceive',

      transactionNumber: this.paymentReceived.paymentReceiveNo,
      referenceNumber: this.paymentReceived.referenceNo,

      date: this.paymentReceived.paymentDate,
      userId: this.paymentReceived.userId,
      createdAt: this.paymentReceived.createdAt,

      branchId: this.paymentReceived.branchId,

      indexGroup: 50,
      basis: AccountingBasis.Cash,
    };
  }

  /**
   * Retrieves the paid amount of the given payment entry in local currency.
   * @param {PaymentReceivedEntry} entry - Payment received entry.
   * @returns {number}
   */
  private getPaymentEntryLocalAmount = (
    entry: PaymentReceivedEntry,
  ): number => {
    return (
      entry.paymentAmount * defaultTo(this.paymentReceived.exchangeRate, 1)
    );
  };

  /**
   * Retrieves the paid proportion of the associated invoice.
   * The paid amount in local currency over the invoice total in local
   * currency keeps the cash basis entries balanced for partial payments.
   * It is 0 when the invoice total is not positive, so the entry posts nothing.
   * @param {PaymentReceivedEntry} entry - Payment received entry.
   * @returns {number}
   */
  private getPaymentEntryRatio = (entry: PaymentReceivedEntry): number => {
    const invoiceTotalLocal = defaultTo(entry.invoice?.totalLocal, 0);
    const paidLocalAmount = this.getPaymentEntryLocalAmount(entry);

    if (invoiceTotalLocal <= 0) {
      return 0;
    }
    return paidLocalAmount / invoiceTotalLocal;
  };

  /**
   * Retrieves the deposit account (cash/bank) debit entry of the given payment entry.
   * @param {PaymentReceivedEntry} entry - Payment received entry.
   * @returns {ILedgerEntry}
   */
  private getPaymentEntryDepositEntry = (
    entry: PaymentReceivedEntry,
  ): ILedgerEntry => {
    return {
      ...this.cashEntriesCommonEntry,
      debit: this.getPaymentEntryLocalAmount(entry),
      accountId: this.paymentReceived.depositAccountId,
      index: 1,
      accountNormal: AccountNormal.DEBIT,
    };
  };

  /**
   * Retrieves the tax of each invoice line recognized by the given payment
   * entry, in local currency.
   * The tax recognized once `x` of the invoice is paid is rounded to the cent
   * in the invoice currency, then converted to the ledger precision:
   * `cum(x) = round3(round2(lineTax × x / invoice total) × exchangeRate)`.
   * The entry posts `cum(paidBefore + paymentAmount) − cum(paidBefore)`, so
   * the payments of a fully paid invoice post `round3(lineTax × exchangeRate)`,
   * the invoice journal's tax entry.
   * @param {SaleInvoice} invoice - Sale invoice, with a non-zero total.
   * @param {number[]} lineTaxes - Line taxes, allocated to the stored invoice tax.
   * @param {number} paidBefore - Amount of the invoice paid before the entry.
   * @param {number} paymentAmount - Amount of the invoice paid by the entry.
   * @returns {number[]}
   */
  private getPaymentEntryLineTaxes = (
    invoice: SaleInvoice,
    lineTaxes: number[],
    paidBefore: number,
    paymentAmount: number,
  ): number[] => {
    const cumulativeTax = (lineTax: number, paidAmount: number) =>
      roundHalfAwayFromZero(
        roundHalfAwayFromZero((lineTax * paidAmount) / invoice.total, 2) *
          invoice.exchangeRate,
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
   * Retrieves the income accounts credit entries mirroring the invoice items.
   * Each line's share of the payment is its income plus its tax; the income
   * entry carries the share less the tax the payment recognizes on the line.
   * @param {SaleInvoice} invoice - Sale invoice.
   * @param {number} ratio - Paid proportion of the invoice.
   * @param {number[]} lineTaxes - Line taxes, allocated to the stored invoice tax.
   * @param {number[]} paymentLineTaxes - Line taxes recognized by the payment.
   * @returns {ILedgerEntry[]}
   */
  private getPaymentEntryIncomeEntries = (
    invoice: SaleInvoice,
    ratio: number,
    lineTaxes: number[],
    paymentLineTaxes: number[],
  ): ILedgerEntry[] => {
    const invoiceEntries = invoice.entries || [];

    return invoiceEntries.map((item, index) => {
      // A tax-inclusive line's amount already includes its tax.
      const lineTotal =
        item.totalExcludingTax +
        (item.isInclusiveTax ? item.taxAmount : lineTaxes[index]);

      return {
        ...this.cashEntriesCommonEntry,
        credit:
          lineTotal * invoice.exchangeRate * ratio - paymentLineTaxes[index],
        accountId: item.sellAccountId,
        note: item.description,
        index: index + 2,
        itemId: item.itemId,
        accountNormal: AccountNormal.CREDIT,
        taxRateId: item.taxRateId,
        taxRate: item.taxRate,
      };
    });
  };

  /**
   * Retrieves the tax payable credit entries mirroring the invoice taxes,
   * one per taxed line; negative tax posts as a negative credit.
   * @param {SaleInvoice} invoice - Sale invoice.
   * @param {number[]} paymentLineTaxes - Line taxes recognized by the payment.
   * @returns {ILedgerEntry[]}
   */
  private getPaymentEntryTaxEntries = (
    invoice: SaleInvoice,
    paymentLineTaxes: number[],
  ): ILedgerEntry[] => {
    const invoiceEntries = invoice.entries || [];

    return buildTaxLedgerEntries({
      taxes: invoiceEntries.map((item, index) => ({
        amount: paymentLineTaxes[index],
        taxRateId: item.taxRateId,
        taxRate: item.taxRate,
      })),
      side: 'credit',
      taxPayableAccountId: this.taxPayableAccountId,
      commonEntry: this.cashEntriesCommonEntry,
      indexGroup: 50,
      startIndex: invoiceEntries.length + 2,
    });
  };

  /**
   * Retrieves the discount entry mirroring the invoice discount.
   * @param {SaleInvoice} invoice - Sale invoice.
   * @param {number} ratio - Paid proportion of the invoice.
   * @returns {ILedgerEntry[]}
   */
  private getPaymentEntryDiscountEntry = (
    invoice: SaleInvoice,
    ratio: number,
  ): ILedgerEntry[] => {
    return invoice.discountAmountLocal
      ? [
          {
            ...this.cashEntriesCommonEntry,
            debit: invoice.discountAmountLocal * ratio,
            accountId: this.discountAccountId,
            accountNormal: AccountNormal.CREDIT,
            index: 1,
          },
        ]
      : [];
  };

  /**
   * Retrieves the other charges (adjustment) entry mirroring the invoice adjustment.
   * @param {SaleInvoice} invoice - Sale invoice.
   * @param {number} ratio - Paid proportion of the invoice.
   * @returns {ILedgerEntry[]}
   */
  private getPaymentEntryAdjustmentEntry = (
    invoice: SaleInvoice,
    ratio: number,
  ): ILedgerEntry[] => {
    const adjustmentAmount = defaultTo(invoice.adjustmentLocal, 0);

    return invoice.adjustmentLocal
      ? [
          {
            ...this.cashEntriesCommonEntry,
            debit:
              adjustmentAmount < 0 ? Math.abs(adjustmentAmount) * ratio : 0,
            credit: adjustmentAmount > 0 ? adjustmentAmount * ratio : 0,
            accountId: this.otherChargesAccountId,
            accountNormal: AccountNormal.CREDIT,
            index: 1,
          },
        ]
      : [];
  };

  /**
   * Retrieves the cash basis entries of the given payment entry (invoice
   * allocation), rounded to the ledger precision. The rounding remainder goes
   * on the largest income entry.
   * @param {PaymentReceivedEntry} entry - Payment received entry.
   * @param {number} paidBefore - Amount of the invoice paid before the entry.
   * @returns {ILedgerEntry[]}
   */
  private getPaymentEntryCashEntries = (
    entry: PaymentReceivedEntry,
    paidBefore: number,
  ): ILedgerEntry[] => {
    const invoice = entry.invoice;
    // A zero invoice total gives a zero ratio, so nothing divides by it.
    const ratio = this.getPaymentEntryRatio(entry);

    if (!invoice || ratio <= 0) {
      return [];
    }
    const lineTaxes = getDocumentLineTaxes(invoice);
    const paymentLineTaxes = this.getPaymentEntryLineTaxes(
      invoice,
      lineTaxes,
      paidBefore,
      entry.paymentAmount,
    );
    const incomeEntries = this.getPaymentEntryIncomeEntries(
      invoice,
      ratio,
      lineTaxes,
      paymentLineTaxes,
    );
    // The largest income entry by absolute amount, the first one on a tie.
    const largestIncomeEntry = getLargestLedgerEntry(incomeEntries, 'credit');

    return roundToLedgerPrecision(
      [
        this.getPaymentEntryDepositEntry(entry),
        ...incomeEntries,
        ...this.getPaymentEntryTaxEntries(invoice, paymentLineTaxes),
        ...this.getPaymentEntryDiscountEntry(invoice, ratio),
        ...this.getPaymentEntryAdjustmentEntry(invoice, ratio),
      ],
      largestIncomeEntry,
      'credit',
    );
  };

  /**
   * Retrieves the payment received cash basis GL entries.
   * @returns {ILedgerEntry[]}
   */
  public GLEntries(): ILedgerEntry[] {
    // An earlier entry of this payment on the same invoice is paid before too.
    const paidBefore = { ...this.paidBeforeByInvoiceId };

    return (this.paymentReceived.entries || []).flatMap((entry) => {
      const entryPaidBefore = defaultTo(paidBefore[entry.invoiceId], 0);
      paidBefore[entry.invoiceId] = entryPaidBefore + entry.paymentAmount;

      return this.getPaymentEntryCashEntries(entry, entryPaidBefore);
    });
  }

  /**
   * Retrieves the payment received cash basis ledger.
   * @returns {Ledger}
   */
  public getLedger = (): Ledger => {
    return new Ledger(this.GLEntries());
  };
}
