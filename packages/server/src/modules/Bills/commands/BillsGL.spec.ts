import { AccountNormal } from '@/modules/Accounts/Accounts.types';
import { roundHalfAwayFromZero } from '@bigcapital/utils';
import { ILedgerEntry } from '@/modules/Ledger/types/Ledger.types';
import { DiscountType } from '@/common/types/Discount';
import { Bill } from '../models/Bill';
import { BillGL } from './BillsGL';

const buildBill = (overrides: Record<string, any> = {}) =>
  ({
    id: 1,
    exchangeRate: 1,
    currencyCode: 'USD',
    userId: 1,
    referenceNo: 'REF-1',
    billNumber: 'B-100',
    billDate: '2023-01-01',
    branchId: 1,
    projectId: null,
    createdAt: new Date('2023-01-01'),
    discountType: 'amount',
    discount: 0,
    adjustment: 0,
    entries: [
      {
        id: 1,
        itemId: 10,
        amount: 1000,
        discountAmount: 0,
        taxAmount: 0,
        costAccountId: null,
        item: { type: 'inventory', inventoryAccountId: 100 },
      },
      {
        id: 2,
        itemId: 11,
        amount: 500,
        discountAmount: 0,
        taxAmount: 0,
        costAccountId: 200,
        item: { type: 'service' },
      },
    ],
    ...overrides,
  }) as any;

const buildLedger = (
  bill: any,
  itemAllocatedCosts: any[] = [],
  landedCostLedgerEntries: any[] = [],
) =>
  new BillGL(bill, itemAllocatedCosts, landedCostLedgerEntries)
    .setPayableAccountId(1)
    .setTaxPayableAccountId(2)
    .setPurchaseDiscountAccountId(3)
    .setOtherExpensesAccountId(4)
    .getBillLedger();

describe('BillGL', () => {
  it('adds the allocated landed costs to the item entries debit', () => {
    const ledger = buildLedger(buildBill(), [{ entryId: 1, amount: 100 }], []);

    const entries = ledger.getEntries();
    const itemEntryOne = entries.find((entry) => entry.itemId === 10);
    const itemEntryTwo = entries.find((entry) => entry.itemId === 11);

    expect(itemEntryOne.debit).toBe(1100);
    expect(itemEntryOne.accountId).toBe(100);
    expect(itemEntryOne.indexGroup).toBe(10);
    expect(itemEntryOne.accountNormal).toBe(AccountNormal.DEBIT);

    expect(itemEntryTwo.debit).toBe(500);
    expect(itemEntryTwo.accountId).toBe(200);
  });

  it('appends the landed costs as credit ledger entries', () => {
    const ledger = buildLedger(
      buildBill(),
      [],
      [{ amount: 50, costAccountId: 300 }],
    );

    const entries = ledger.getEntries();
    const landedCostEntry = entries.find((entry) => entry.accountId === 300);

    expect(landedCostEntry.credit).toBe(50);
    expect(landedCostEntry.indexGroup).toBe(20);
    expect(landedCostEntry.accountNormal).toBe(AccountNormal.DEBIT);
  });

  it('keeps the bill entries amounts when there are no contributions', () => {
    const ledger = buildLedger(buildBill());

    const entries = ledger.getEntries();
    const itemEntryOne = entries.find((entry) => entry.itemId === 10);

    expect(itemEntryOne.debit).toBe(1000);
    expect(entries.some((entry) => entry.accountId === 300)).toBe(false);
  });

  it('applies the exchange rate to the item entries but keeps the allocated costs as is', () => {
    const ledger = buildLedger(
      buildBill({ exchangeRate: 2 }),
      [{ entryId: 1, amount: 100 }],
      [],
    );

    const entries = ledger.getEntries();
    const itemEntryOne = entries.find((entry) => entry.itemId === 10);

    expect(itemEntryOne.debit).toBe(2100);
  });
});

describe('BillGL tax', () => {
  const PAYABLE = 1;
  const TAX_PAYABLE = 2;
  const EXPENSE = 200;

  interface TestLine {
    amount: number;
    taxRate?: number;
    isInclusiveTax?: boolean;
    discount?: number;
  }

  const buildTaxBill = (
    lines: TestLine[],
    overrides: Record<string, any> = {},
  ): Bill => {
    const isInclusiveTax = overrides.isInclusiveTax ?? false;

    return Bill.fromJson({
      id: 1,
      billNumber: 'B-100',
      referenceNo: 'REF-1',
      billDate: '2026-11-03',
      currencyCode: 'CAD',
      exchangeRate: 1,
      vendorId: 5,
      userId: 1,
      branchId: 1,
      createdAt: '2026-11-03',
      amount: lines.reduce((total, line) => total + line.amount, 0),
      discount: 0,
      discountType: DiscountType.Amount,
      adjustment: 0,
      isInclusiveTax,
      entries: lines.map((line, index) => ({
        index: index + 1,
        itemId: 1,
        quantity: 1,
        rate: line.amount,
        costAccountId: EXPENSE,
        discount: line.discount ?? 0,
        discountType: DiscountType.Amount,
        taxRateId: line.taxRate ? 7 : null,
        taxRate: line.taxRate ?? 0,
        isInclusiveTax: line.isInclusiveTax ?? isInclusiveTax,
        item: { type: 'service' },
      })),
      ...overrides,
    });
  };

  const getLegs = (bill: Bill): ILedgerEntry[] =>
    buildLedger(bill).getEntries();

  const legsOf = (legs: ILedgerEntry[], accountId: number) =>
    legs.filter((leg) => leg.accountId === accountId);
  const payable = (legs: ILedgerEntry[]) =>
    legsOf(legs, PAYABLE).map((leg) => leg.credit);
  const expense = (legs: ILedgerEntry[]) =>
    legsOf(legs, EXPENSE).map((leg) => leg.debit);
  const tax = (legs: ILedgerEntry[]) =>
    legsOf(legs, TAX_PAYABLE).map((leg) => leg.debit);

  // Σdebit and Σcredit agree in thousandths, the precision of accounts_transactions.
  const balanced = (legs: ILedgerEntry[]) =>
    Math.round(legs.reduce((sum, leg) => sum + (leg.debit || 0), 0) * 1000) ===
    Math.round(legs.reduce((sum, leg) => sum + (leg.credit || 0), 0) * 1000);

  const atStoredPrecision = (legs: ILedgerEntry[]) =>
    legs.every(
      (leg) =>
        roundHalfAwayFromZero(leg.debit || 0, 3) === (leg.debit || 0) &&
        roundHalfAwayFromZero(leg.credit || 0, 3) === (leg.credit || 0),
    );

  it('(a) debits the negative line tax and balances', () => {
    const legs = getLegs(
      buildTaxBill(
        [
          { amount: 37.5, taxRate: 14.975 },
          { amount: -4.5, taxRate: 14.975 },
        ],
        { taxAmountWithheld: 4.95 },
      ),
    );

    expect(payable(legs)).toEqual([37.95]);
    expect(expense(legs)).toEqual([37.5, -4.5]);
    expect(tax(legs)).toEqual([5.62, -0.67]);
    expect(balanced(legs)).toBe(true);
  });

  it('(c) credits a negative payable for a negative-total bill and balances', () => {
    const legs = getLegs(
      buildTaxBill(
        [
          { amount: 4.5, taxRate: 14.975 },
          { amount: -37.5, taxRate: 14.975 },
        ],
        { taxAmountWithheld: -4.95 },
      ),
    );

    expect(payable(legs)).toEqual([-37.95]);
    expect(balanced(legs)).toBe(true);
  });

  it('(d) posts the stored tax of an old document, allocated over its lines', () => {
    const legs = getLegs(
      buildTaxBill(
        [
          { amount: 37.5, taxRate: 5 },
          { amount: 12.3, taxRate: 5 },
        ],
        { taxAmountWithheld: 2.49 },
      ),
    );

    expect(tax(legs)).toEqual([1.87, 0.62]);
    expect(payable(legs)).toEqual([52.29]);
    expect(balanced(legs)).toBe(true);
  });

  it('(e) balances in the organization currency at exchange rate 1.3567', () => {
    const legs = getLegs(
      buildTaxBill(
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

  it('puts the rounding remainder of the converted entries on the largest expense entry', () => {
    // At 1.3567 the entries round to 61.975 of debits against a 61.974 payable;
    // the largest expense entry gives the extra thousandth back (50.876 to 50.875).
    const legs = getLegs(
      buildTaxBill(
        [
          { amount: 37.5, taxRate: 14.975 },
          { amount: 1.11, taxRate: 14.975 },
          { amount: 1.11, taxRate: 14.975 },
        ],
        { taxAmountWithheld: 5.96, exchangeRate: 1.3567 },
      ),
    );

    expect(payable(legs)).toEqual([61.974]);
    expect(expense(legs)).toEqual([50.875, 1.506, 1.506]);
    expect(tax(legs)).toEqual([7.625, 0.231, 0.231]);
    expect(balanced(legs)).toBe(true);
    expect(atStoredPrecision(legs)).toBe(true);
  });

  it('(g) splits a tax-inclusive line into expense and tax', () => {
    const legs = getLegs(
      buildTaxBill([{ amount: 1100, taxRate: 10 }], {
        taxAmountWithheld: 100,
        isInclusiveTax: true,
      }),
    );

    expect(expense(legs)).toEqual([1000]);
    expect(tax(legs)).toEqual([100]);
    expect(balanced(legs)).toBe(true);
  });

  it('takes a tax-inclusive line expense from the allocated line tax of an old document', () => {
    // Per-line rounding gives 1.79 + 0.59; the document stored 2.37.
    const legs = getLegs(
      buildTaxBill(
        [
          { amount: 37.5, taxRate: 5 },
          { amount: 12.3, taxRate: 5 },
        ],
        { taxAmountWithheld: 2.37, isInclusiveTax: true },
      ),
    );

    expect(tax(legs)).toEqual([1.78, 0.59]);
    expect(expense(legs)).toEqual([35.72, 11.71]);
    expect(payable(legs)).toEqual([49.8]);
    expect(balanced(legs)).toBe(true);
  });

  it('keeps a line discount out of the rounding remainder', () => {
    // The bill total leaves line discounts out (a known issue, out of scope):
    // that difference is not a rounding remainder and must not move into expense.
    const legs = getLegs(
      buildTaxBill([{ amount: 100, taxRate: 14.975, discount: 10 }], {
        taxAmountWithheld: 14.98,
      }),
    );

    expect(expense(legs)).toEqual([90]);
    expect(tax(legs)).toEqual([14.98]);
  });
});
