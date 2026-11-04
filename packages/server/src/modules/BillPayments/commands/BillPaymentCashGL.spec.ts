import { AccountNormal } from '@/modules/Accounts/Accounts.types';
import { sumBy } from 'lodash';
import { roundHalfAwayFromZero } from '@bigcapital/utils';
import { DiscountType } from '@/common/types/Discount';
import { ILedgerEntry } from '@/modules/Ledger/types/Ledger.types';
import { Bill } from '@/modules/Bills/models/Bill';
import { BillPaymentCashGL } from './BillPaymentCashGL';

const buildBill = (overrides: Record<string, any> = {}) => {
  const bill = {
    exchangeRate: 1,
    totalLocal: 1000,
    discountAmountLocal: null,
    adjustmentLocal: null,
    entries: [
      {
        itemId: 10,
        totalExcludingTax: 1000,
        taxAmount: 0,
        costAccountId: 200,
        item: { type: 'service' },
      },
    ],
    ...overrides,
  };
  // The bill total in its currency, as the model derives it.
  return { total: bill.totalLocal / bill.exchangeRate, ...bill };
};

const buildBillPayment = (overrides: Record<string, any> = {}) => ({
  id: 1,
  currencyCode: 'USD',
  exchangeRate: 1,
  paymentNumber: 'PMT-100',
  reference: 'REF-100',
  paymentDate: '2023-01-01',
  createdAt: new Date('2023-01-01'),
  branchId: 1,
  paymentAccountId: 900,
  entries: [],
  ...overrides,
});

const buildLedger = (
  billPayment: any,
  paidBeforeByBillId: Record<number, number> = {},
) =>
  new BillPaymentCashGL(billPayment, paidBeforeByBillId)
    .setTaxPayableAccountId(1)
    .setPurchaseDiscountAccountId(2)
    .setOtherExpensesAccountId(3)
    .getLedger();

describe('BillPaymentCashGL', () => {
  it('credits the payment account and debits the bill item cost accounts', () => {
    const billPayment = buildBillPayment({
      entries: [{ paymentAmount: 1000, bill: buildBill() }],
    });
    const entries = buildLedger(billPayment).getEntries();

    const paymentEntry = entries.find((entry) => entry.accountId === 900);
    const costEntry = entries.find((entry) => entry.accountId === 200);

    expect(paymentEntry.credit).toBe(1000);
    expect(paymentEntry.accountNormal).toBe(AccountNormal.DEBIT);
    expect(paymentEntry.basis).toBe('cash');
    expect(paymentEntry.indexGroup).toBe(50);

    expect(costEntry.debit).toBe(1000);
    expect(costEntry.accountNormal).toBe(AccountNormal.DEBIT);
    expect(costEntry.itemId).toBe(10);

    expect(sumBy(entries, 'debit')).toBeCloseTo(sumBy(entries, 'credit'), 2);
  });

  it('scales the entries by the paid proportion for partial payments', () => {
    const billPayment = buildBillPayment({
      entries: [
        {
          paymentAmount: 900,
          bill: buildBill({
            totalLocal: 1800,
            discountAmountLocal: 200,
            entries: [
              {
                itemId: 10,
                totalExcludingTax: 2000,
                taxAmount: 0,
                costAccountId: 200,
                item: { type: 'service' },
              },
            ],
          }),
        },
      ],
    });
    const entries = buildLedger(billPayment).getEntries();

    const paymentEntry = entries.find((entry) => entry.accountId === 900);
    const costEntry = entries.find((entry) => entry.accountId === 200);
    const discountEntry = entries.find((entry) => entry.accountId === 2);

    expect(paymentEntry.credit).toBe(900);
    expect(costEntry.debit).toBe(1000);
    expect(discountEntry.credit).toBe(100);
    expect(sumBy(entries, 'debit')).toBeCloseTo(sumBy(entries, 'credit'), 2);
  });

  it('mirrors the taxes and uses the inventory account for inventory items', () => {
    const billPayment = buildBillPayment({
      entries: [
        {
          paymentAmount: 1100,
          bill: buildBill({
            totalLocal: 1100,
            entries: [
              {
                itemId: 11,
                totalExcludingTax: 1000,
                taxAmount: 100,
                costAccountId: 200,
                item: { type: 'inventory', inventoryAccountId: 300 },
              },
            ],
          }),
        },
      ],
    });
    const entries = buildLedger(billPayment).getEntries();

    const inventoryEntry = entries.find((entry) => entry.accountId === 300);
    const taxEntry = entries.find((entry) => entry.accountId === 1);

    expect(inventoryEntry.debit).toBe(1000);
    expect(taxEntry.debit).toBe(100);
    expect(sumBy(entries, 'debit')).toBeCloseTo(sumBy(entries, 'credit'), 2);
  });

  it('mirrors the bill adjustment sign', () => {
    const billPayment = buildBillPayment({
      entries: [
        {
          paymentAmount: 850,
          bill: buildBill({
            totalLocal: 850,
            adjustmentLocal: 50,
            entries: [
              {
                itemId: 10,
                totalExcludingTax: 800,
                taxAmount: 0,
                costAccountId: 200,
                item: { type: 'service' },
              },
            ],
          }),
        },
      ],
    });
    const entries = buildLedger(billPayment).getEntries();

    const adjustmentEntry = entries.find((entry) => entry.accountId === 3);

    expect(adjustmentEntry.debit).toBe(50);
    expect(sumBy(entries, 'debit')).toBeCloseTo(sumBy(entries, 'credit'), 2);
  });

  it('returns no entries when the paid proportion cannot be computed', () => {
    const billPayment = buildBillPayment({
      entries: [{ paymentAmount: 1000, bill: buildBill({ totalLocal: 0 }) }],
    });
    const entries = buildLedger(billPayment).getEntries();

    expect(entries).toHaveLength(0);
  });
});

describe('BillPaymentCashGL tax rounding', () => {
  const TAX_PAYABLE_ACCOUNT = 1;
  const EXPENSE_ACCOUNT = 200;

  // A real bill model, so its total and line taxes are derived as saved.
  const buildTaxedBill = (
    amounts: number[],
    overrides: Record<string, any> = {},
  ): Bill =>
    Bill.fromJson({
      id: 20,
      billNumber: 'B-100',
      currencyCode: 'CAD',
      exchangeRate: 1,
      amount: amounts.reduce((total, amount) => total + amount, 0),
      discount: 0,
      discountType: DiscountType.Amount,
      adjustment: 0,
      isInclusiveTax: false,
      entries: amounts.map((amount, index) => ({
        index: index + 1,
        itemId: 10,
        quantity: 1,
        rate: amount,
        costAccountId: EXPENSE_ACCOUNT,
        discount: 0,
        discountType: DiscountType.Amount,
        taxRateId: 7,
        taxRate: 14.975,
        isInclusiveTax: false,
        item: { type: 'service' },
      })),
      ...overrides,
    });

  // The cash basis legs of a payment of `paymentAmount` on the bill, when
  // earlier payments paid `paidBefore` of it.
  const payBill = (
    bill: Bill,
    paymentAmount: number,
    paidBefore: number,
  ): ILedgerEntry[] =>
    buildLedger(
      buildBillPayment({
        exchangeRate: bill.exchangeRate,
        entries: [{ billId: bill.id, paymentAmount, bill }],
      }),
      { [bill.id]: paidBefore },
    ).getEntries();

  const debits = (legs: ILedgerEntry[], accountId: number) =>
    legs.filter((leg) => leg.accountId === accountId).map((leg) => leg.debit);
  const tax = (legs: ILedgerEntry[]) => debits(legs, TAX_PAYABLE_ACCOUNT);
  const expense = (legs: ILedgerEntry[]) => debits(legs, EXPENSE_ACCOUNT);

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

  it('posts exactly the bill tax over three payments, each journal balanced', () => {
    // 100 at 14.975 %: tax 14.98, total 114.98.
    const bill = buildTaxedBill([100], { taxAmountWithheld: 14.98 });

    const payments = [
      payBill(bill, 38.33, 0),
      payBill(bill, 38.33, 38.33),
      payBill(bill, 38.32, 76.66),
    ];
    const totalTax = payments
      .flatMap(tax)
      .reduce((total, amount) => total + amount, 0);

    expect(payments.map(tax)).toEqual([[4.99], [5], [4.99]]);
    expect(Math.round(totalTax * 1000)).toBe(14980);
    expect(payments.map(expense)).toEqual([[33.34], [33.33], [33.33]]);
    payments.forEach((legs) => {
      expect(balanced(legs)).toBe(true);
      expect(atStoredPrecision(legs)).toBe(true);
    });
  });

  it('debits a negative tax entry for a negative line and balances', () => {
    // 37.50 and -4.50 at 14.975 %: tax 5.62 and -0.67, total 37.95.
    const bill = buildTaxedBill([37.5, -4.5], { taxAmountWithheld: 4.95 });

    const legs = payBill(bill, 18.98, 0);

    expect(tax(legs)).toEqual([2.81, -0.34]);
    expect(expense(legs)).toEqual([18.756, -2.246]);
    expect(balanced(legs)).toBe(true);
    expect(atStoredPrecision(legs)).toBe(true);
  });
});
