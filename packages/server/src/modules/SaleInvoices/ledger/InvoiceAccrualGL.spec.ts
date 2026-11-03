import { roundHalfAwayFromZero } from '@bigcapital/utils';
import { ILedgerEntry } from '@/modules/Ledger/types/Ledger.types';
import { DiscountType } from '@/common/types/Discount';
import { SaleInvoice } from '../models/SaleInvoice';
import { InvoiceAccrualGL } from './InvoiceAccrualGL';

const AR_ACCOUNT = 1000;
const TAX_PAYABLE_ACCOUNT = 2000;
const DISCOUNT_ACCOUNT = 3000;
const OTHER_CHARGES_ACCOUNT = 4000;
const INCOME_ACCOUNT = 5000;

interface TestLine {
  amount: number;
  taxRate?: number;
  isInclusiveTax?: boolean;
  discount?: number;
}

const buildInvoice = (
  lines: TestLine[],
  overrides: Record<string, any> = {},
): SaleInvoice => {
  const isInclusiveTax = overrides.isInclusiveTax ?? false;

  return SaleInvoice.fromJson({
    id: 1,
    invoiceNo: 'INV-00001',
    referenceNo: 'REF-00001',
    invoiceDate: '2026-11-03',
    currencyCode: 'CAD',
    exchangeRate: 1,
    customerId: 5,
    userId: 1,
    branchId: 1,
    createdAt: '2026-11-03',
    balance: lines.reduce((total, line) => total + line.amount, 0),
    discount: 0,
    discountType: DiscountType.Amount,
    adjustment: 0,
    isInclusiveTax,
    entries: lines.map((line, index) => ({
      index: index + 1,
      itemId: 1,
      description: `Line ${index + 1}`,
      sellAccountId: INCOME_ACCOUNT,
      quantity: 1,
      rate: line.amount,
      discount: line.discount ?? 0,
      discountType: DiscountType.Amount,
      taxRateId: line.taxRate ? 7 : null,
      taxRate: line.taxRate ?? 0,
      isInclusiveTax: line.isInclusiveTax ?? isInclusiveTax,
    })),
    ...overrides,
  });
};

const getGLEntries = (invoice: SaleInvoice): ILedgerEntry[] => {
  const gl = new InvoiceAccrualGL(invoice);

  gl.setARAccountId(AR_ACCOUNT);
  gl.setTaxPayableAccountId(TAX_PAYABLE_ACCOUNT);
  gl.setDiscountAccountId(DISCOUNT_ACCOUNT);
  gl.setOtherChargesAccountId(OTHER_CHARGES_ACCOUNT);

  return gl.getInvoiceGLEntries();
};

const legsOf = (legs: ILedgerEntry[], accountId: number) =>
  legs.filter((leg) => leg.accountId === accountId);

const receivable = (legs: ILedgerEntry[]) =>
  legsOf(legs, AR_ACCOUNT).map((leg) => leg.debit);

const income = (legs: ILedgerEntry[]) =>
  legsOf(legs, INCOME_ACCOUNT).map((leg) => leg.credit);

const tax = (legs: ILedgerEntry[]) =>
  legsOf(legs, TAX_PAYABLE_ACCOUNT).map((leg) => leg.credit);

// Σdebit and Σcredit agree in thousandths, the precision of accounts_transactions.
const balanced = (legs: ILedgerEntry[]) =>
  Math.round(legs.reduce((sum, leg) => sum + (leg.debit || 0), 0) * 1000) ===
  Math.round(legs.reduce((sum, leg) => sum + (leg.credit || 0), 0) * 1000);

// Every leg is already at the stored precision, so the database stores it as is.
const atStoredPrecision = (legs: ILedgerEntry[]) =>
  legs.every(
    (leg) =>
      roundHalfAwayFromZero(leg.debit || 0, 3) === (leg.debit || 0) &&
      roundHalfAwayFromZero(leg.credit || 0, 3) === (leg.credit || 0),
  );

describe('InvoiceAccrualGL', () => {
  it('(a) posts the negative line tax and balances', () => {
    const legs = getGLEntries(
      buildInvoice(
        [
          { amount: 37.5, taxRate: 14.975 },
          { amount: -4.5, taxRate: 14.975 },
        ],
        { taxAmountWithheld: 4.95 },
      ),
    );

    expect(receivable(legs)).toEqual([37.95]);
    expect(income(legs)).toEqual([37.5, -4.5]);
    expect(tax(legs)).toEqual([5.62, -0.67]);
    expect(balanced(legs)).toBe(true);
  });

  it('(b) posts both taxes of a zero-total invoice and balances', () => {
    const legs = getGLEntries(
      buildInvoice(
        [
          { amount: 3, taxRate: 14.975 },
          { amount: -3, taxRate: 14.975 },
        ],
        { taxAmountWithheld: 0 },
      ),
    );

    expect(tax(legs)).toEqual([0.45, -0.45]);
    expect(balanced(legs)).toBe(true);
  });

  it('(c) debits a negative receivable for a negative-total invoice and balances', () => {
    const legs = getGLEntries(
      buildInvoice(
        [
          { amount: 4.5, taxRate: 14.975 },
          { amount: -37.5, taxRate: 14.975 },
        ],
        { taxAmountWithheld: -4.95 },
      ),
    );

    expect(receivable(legs)).toEqual([-37.95]);
    expect(balanced(legs)).toBe(true);
  });

  it('(d) posts the stored tax of an old document, allocated over its lines', () => {
    const legs = getGLEntries(
      buildInvoice(
        [
          { amount: 37.5, taxRate: 5 },
          { amount: 12.3, taxRate: 5 },
        ],
        { taxAmountWithheld: 2.49 },
      ),
    );

    expect(tax(legs)).toEqual([1.87, 0.62]);
    expect(receivable(legs)).toEqual([52.29]);
    expect(balanced(legs)).toBe(true);
  });

  it('(e) balances in the organization currency at exchange rate 1.3567', () => {
    const legs = getGLEntries(
      buildInvoice(
        [
          { amount: 37.5, taxRate: 14.975 },
          { amount: -4.5, taxRate: 14.975 },
        ],
        { taxAmountWithheld: 4.95, exchangeRate: 1.3567 },
      ),
    );

    expect(balanced(legs)).toBe(true);
    expect(atStoredPrecision(legs)).toBe(true);
  });

  it('(f) posts no tax entry for a line without tax', () => {
    const legs = getGLEntries(
      buildInvoice([{ amount: 100 }], { taxAmountWithheld: 0 }),
    );

    expect(tax(legs)).toEqual([]);
    expect(balanced(legs)).toBe(true);
  });

  it('(g) splits a tax-inclusive line into income and tax', () => {
    const legs = getGLEntries(
      buildInvoice([{ amount: 1100, taxRate: 10 }], {
        taxAmountWithheld: 100,
        isInclusiveTax: true,
      }),
    );

    expect(income(legs)).toEqual([1000]);
    expect(tax(legs)).toEqual([100]);
    expect(balanced(legs)).toBe(true);
  });

  it('puts the rounding remainder of the converted entries on the largest income entry', () => {
    // At 1.3567 the entries round to 61.975 of credits against a 61.974 receivable.
    const legs = getGLEntries(
      buildInvoice(
        [
          { amount: 37.5, taxRate: 14.975 },
          { amount: 1.11, taxRate: 14.975 },
          { amount: 1.11, taxRate: 14.975 },
        ],
        { taxAmountWithheld: 5.96, exchangeRate: 1.3567 },
      ),
    );

    expect(receivable(legs)).toEqual([61.974]);
    expect(income(legs)).toEqual([50.875, 1.506, 1.506]);
    expect(tax(legs)).toEqual([7.625, 0.231, 0.231]);
    expect(balanced(legs)).toBe(true);
    expect(atStoredPrecision(legs)).toBe(true);
  });

  it('takes a tax-inclusive line income from the allocated line tax of an old document', () => {
    // Per-line rounding gives 1.79 + 0.59; the document stored 2.37.
    const legs = getGLEntries(
      buildInvoice(
        [
          { amount: 37.5, taxRate: 5 },
          { amount: 12.3, taxRate: 5 },
        ],
        { taxAmountWithheld: 2.37, isInclusiveTax: true },
      ),
    );

    expect(tax(legs)).toEqual([1.78, 0.59]);
    expect(income(legs)).toEqual([35.72, 11.71]);
    expect(receivable(legs)).toEqual([49.8]);
    expect(balanced(legs)).toBe(true);
  });

  it('keeps a line discount out of that line income', () => {
    // The invoice balance leaves line discounts out (a known issue, out of scope):
    // that difference is not a rounding remainder and must not move into income.
    const legs = getGLEntries(
      buildInvoice([{ amount: 100, taxRate: 14.975, discount: 10 }], {
        taxAmountWithheld: 14.98,
      }),
    );

    expect(income(legs)).toEqual([90]);
    expect(tax(legs)).toEqual([14.98]);
  });
});
