import { AccountNormal } from '@/modules/Accounts/Accounts.types';
import { sumBy } from 'lodash';
import { roundHalfAwayFromZero } from '@bigcapital/utils';
import { DiscountType } from '@/common/types/Discount';
import { ILedgerEntry } from '@/modules/Ledger/types/Ledger.types';
import { Bill } from '@/modules/Bills/models/Bill';
import { BillGL } from '@/modules/Bills/commands/BillsGL';
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
    paymentOverrides: Record<string, any> = {},
  ): ILedgerEntry[] =>
    buildLedger(
      buildBillPayment({
        exchangeRate: bill.exchangeRate,
        ...paymentOverrides,
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

  it('posts the accrual tax of a foreign-currency bill once fully paid', () => {
    const bill = buildTaxedBill([37.5, -4.5], {
      taxAmountWithheld: 4.95,
      exchangeRate: 1.3567,
    });
    const accrualTax = tax(
      new BillGL(bill)
        .setTaxPayableAccountId(TAX_PAYABLE_ACCOUNT)
        .getBillLedger()
        .getEntries(),
    );

    const payments = [payBill(bill, 18.98, 0), payBill(bill, 18.97, 18.98)];
    const paidTax = [0, 1].map((line) =>
      roundHalfAwayFromZero(
        payments.reduce((total, legs) => total + tax(legs)[line], 0),
        3,
      ),
    );

    expect(payments.map(tax)).toEqual([
      [3.812, -0.461],
      [3.813, -0.448],
    ]);
    // round3(5.62 × 1.3567) and round3(-0.67 × 1.3567).
    expect(paidTax).toEqual([7.625, -0.909]);
    expect(paidTax).toEqual(accrualTax);
    payments.forEach((legs) => {
      expect(balanced(legs)).toBe(true);
      expect(atStoredPrecision(legs)).toBe(true);
    });
  });

  it('orders back-dated payments by id, so a rebuild reproduces each journal', () => {
    const bill = buildTaxedBill([100], { taxAmountWithheld: 14.98 });
    // Saved in this order, so the ids follow it; the dates are out of order.
    const saved = [
      { id: 1, paymentDate: '2026-11-10', paymentAmount: 38.33 },
      { id: 2, paymentDate: '2026-11-01', paymentAmount: 38.33 },
      { id: 3, paymentDate: '2026-11-20', paymentAmount: 38.32 },
    ];
    // Paid before a payment: the payments with a lower id (Ruling R9), the
    // rule `getBillsPaidBefore` queries (BillPaymentGLEntries.spec.ts).
    const postTax = (
      payment: (typeof saved)[number],
      payments: typeof saved,
    ) => {
      const paidBefore = payments
        .filter((other) => other.id < payment.id)
        .reduce((total, other) => total + other.paymentAmount, 0);
      const { id, paymentDate } = payment;

      return tax(
        payBill(bill, payment.paymentAmount, paidBefore, { id, paymentDate }),
      );
    };
    // First posted when saved, with the payments saved so far; rebuilt later
    // with all of them.
    const posted = saved.map((payment, index) =>
      postTax(payment, saved.slice(0, index + 1)),
    );
    const rebuilt = saved.map((payment) => postTax(payment, saved));
    const totalTax = posted.flat().reduce((total, amount) => total + amount, 0);

    expect(posted).toEqual([[4.99], [5], [4.99]]);
    expect(Math.round(totalTax * 1000)).toBe(14980);
    expect(rebuilt).toEqual(posted);
  });
});

describe('BillPaymentCashGL tax groups', () => {
  const PAYMENT_ACCOUNT = 900;
  const TAX_PAYABLE_ACCOUNT = 1;
  const EXPENSE_ACCOUNT = 200;
  const TPS_PAYABLE_ACCOUNT = 2101;
  const TVQ_PAYABLE_ACCOUNT = 2102;

  // TPS (id 1) and TVQ (id 2), the components of the group id 9.
  const TPS = { taxRateId: 1, rate: 5 };
  const TVQ = { taxRateId: 2, rate: 9.975 };
  const PAYABLE_ACCOUNTS_BY_RATE_ID = {
    1: TPS_PAYABLE_ACCOUNT,
    2: TVQ_PAYABLE_ACCOUNT,
  };

  // A real bill model whose lines are on the group, so its total and
  // component taxes are derived as saved.
  const buildGroupBill = (
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
        taxRateId: 9,
        taxRate: 14.975,
        taxComponents: [TPS, TVQ],
        isInclusiveTax: false,
        item: { type: 'service' },
      })),
      ...overrides,
    });

  // Group lines 37.50 and -4.50: TPS 1.88 and -0.23, TVQ 3.74 and -0.45,
  // total 37.94 (Task 6's bill).
  const buildTask6Bill = (overrides: Record<string, any> = {}) =>
    buildGroupBill([37.5, -4.5], { taxAmountWithheld: 4.94, ...overrides });

  // The cash basis legs of a payment of `paymentAmount` on the bill, when
  // earlier payments paid `paidBefore` of it; without the map when it is null.
  const payBill = (
    bill: Bill,
    paymentAmount: number,
    paidBefore: number,
    payableAccountsByRateId: Record<
      number,
      number
    > | null = PAYABLE_ACCOUNTS_BY_RATE_ID,
  ): ILedgerEntry[] => {
    const cashGL = new BillPaymentCashGL(
      buildBillPayment({
        exchangeRate: bill.exchangeRate,
        entries: [{ billId: bill.id, paymentAmount, bill }],
      }) as any,
      { [bill.id]: paidBefore },
    )
      .setTaxPayableAccountId(TAX_PAYABLE_ACCOUNT)
      .setPurchaseDiscountAccountId(2)
      .setOtherExpensesAccountId(3);

    if (payableAccountsByRateId) {
      cashGL.setTaxPayableAccountsByRateId(payableAccountsByRateId);
    }
    return cashGL.getLedger().getEntries();
  };

  const TAX_ACCOUNTS = [
    TAX_PAYABLE_ACCOUNT,
    TPS_PAYABLE_ACCOUNT,
    TVQ_PAYABLE_ACCOUNT,
  ];
  const isTaxLeg = (leg: ILedgerEntry) => TAX_ACCOUNTS.includes(leg.accountId);
  const taxLegs = (legs: ILedgerEntry[]) =>
    legs.filter(isTaxLeg).map(({ debit, accountId, taxRateId, taxRate }) => ({
      debit,
      accountId,
      taxRateId,
      taxRate,
    }));
  const debits = (legs: ILedgerEntry[], accountId: number) =>
    legs.filter((leg) => leg.accountId === accountId).map((leg) => leg.debit);
  const expense = (legs: ILedgerEntry[]) => debits(legs, EXPENSE_ACCOUNT);
  const sum = (amounts: number[]) =>
    roundHalfAwayFromZero(
      amounts.reduce((total, amount) => total + amount, 0),
      3,
    );

  // Σdebit and Σcredit agree in thousandths, the precision of accounts_transactions.
  const balanced = (legs: ILedgerEntry[]) =>
    Math.round(
      legs.reduce((total, leg) => total + (leg.debit || 0), 0) * 1000,
    ) ===
    Math.round(
      legs.reduce((total, leg) => total + (leg.credit || 0), 0) * 1000,
    );

  // Every leg is already at the stored precision, so the database stores it as is.
  const atStoredPrecision = (legs: ILedgerEntry[]) =>
    legs.every(
      (leg) =>
        roundHalfAwayFromZero(leg.debit || 0, 3) === (leg.debit || 0) &&
        roundHalfAwayFromZero(leg.credit || 0, 3) === (leg.credit || 0),
    );

  it("debits each component of a full payment to its tax's payable account", () => {
    const legs = payBill(buildTask6Bill(), 37.94, 0);

    expect(taxLegs(legs)).toEqual([
      {
        debit: 1.88,
        accountId: TPS_PAYABLE_ACCOUNT,
        taxRateId: 1,
        taxRate: 5,
      },
      {
        debit: 3.74,
        accountId: TVQ_PAYABLE_ACCOUNT,
        taxRateId: 2,
        taxRate: 9.975,
      },
      {
        debit: -0.23,
        accountId: TPS_PAYABLE_ACCOUNT,
        taxRateId: 1,
        taxRate: 5,
      },
      {
        debit: -0.45,
        accountId: TVQ_PAYABLE_ACCOUNT,
        taxRateId: 2,
        taxRate: 9.975,
      },
    ]);
    expect(legs.find((leg) => leg.accountId === PAYMENT_ACCOUNT).credit).toBe(
      37.94,
    );
    expect(expense(legs)).toEqual([37.5, -4.5]);
    expect(balanced(legs)).toBe(true);
    expect(atStoredPrecision(legs)).toBe(true);
  });

  it('debits exactly each component of the bill over two payments, each journal balanced', () => {
    const bill = buildTask6Bill();

    const payments = [payBill(bill, 12, 0), payBill(bill, 25.94, 12)];
    const tps = payments.map((legs) => debits(legs, TPS_PAYABLE_ACCOUNT));
    const tvq = payments.map((legs) => debits(legs, TVQ_PAYABLE_ACCOUNT));

    // cum(12) = round2(component × 12 / 37.94); the second payment posts the rest.
    expect(tps).toEqual([
      [0.59, -0.07],
      [1.29, -0.16],
    ]);
    expect(tvq).toEqual([
      [1.18, -0.14],
      [2.56, -0.31],
    ]);
    expect(sum(tps.flat())).toBe(1.65);
    expect(sum(tvq.flat())).toBe(3.29);
    // Each line's share less the sum of its components the payment recognizes.
    expect(payments.map(expense)).toEqual([
      [11.868, -1.428],
      [25.632, -3.072],
    ]);
    payments.forEach((legs) => {
      expect(taxLegs(legs).map((leg) => leg.taxRateId)).toEqual([1, 2, 1, 2]);
      expect(balanced(legs)).toBe(true);
      expect(atStoredPrecision(legs)).toBe(true);
    });
  });

  it("debits each component's accrual tax over two payments at exchange rate 1.3567", () => {
    const bill = buildTask6Bill({ exchangeRate: 1.3567 });
    const accrualLegs = new BillGL(bill)
      .setTaxPayableAccountId(TAX_PAYABLE_ACCOUNT)
      .setTaxPayableAccountsByRateId(PAYABLE_ACCOUNTS_BY_RATE_ID)
      .getBillLedger()
      .getEntries();

    const payments = [payBill(bill, 12, 0), payBill(bill, 25.94, 12)];
    const paidTax = (accountId: number) =>
      sum(payments.flatMap((legs) => debits(legs, accountId)));

    expect(payments.map((legs) => debits(legs, TPS_PAYABLE_ACCOUNT))).toEqual([
      [0.8, -0.095],
      [1.751, -0.217],
    ]);
    expect(payments.map((legs) => debits(legs, TVQ_PAYABLE_ACCOUNT))).toEqual([
      [1.601, -0.19],
      [3.473, -0.421],
    ]);
    // round3(1.88 × 1.3567) + round3(-0.23 × 1.3567), and the same for TVQ.
    expect(paidTax(TPS_PAYABLE_ACCOUNT)).toBe(2.239);
    expect(paidTax(TVQ_PAYABLE_ACCOUNT)).toBe(4.463);
    expect(paidTax(TPS_PAYABLE_ACCOUNT)).toBe(
      sum(debits(accrualLegs, TPS_PAYABLE_ACCOUNT)),
    );
    expect(paidTax(TVQ_PAYABLE_ACCOUNT)).toBe(
      sum(debits(accrualLegs, TVQ_PAYABLE_ACCOUNT)),
    );
    payments.forEach((legs) => {
      expect(balanced(legs)).toBe(true);
      expect(atStoredPrecision(legs)).toBe(true);
    });
  });

  it('posts no entries and no NaN for a zero-total group bill', () => {
    // 3 and -3 on the group: TPS 0.15 and -0.15, TVQ 0.30 and -0.30, total 0.
    const bill = buildGroupBill([3, -3], { taxAmountWithheld: 0 });

    expect(bill.total).toBe(0);
    [0, 5].forEach((paymentAmount) => {
      expect(payBill(bill, paymentAmount, 0)).toEqual([]);
    });
  });

  it('debits every component to the default tax payable account without the map', () => {
    const legs = payBill(buildTask6Bill(), 37.94, 0, null);

    expect(
      taxLegs(legs).map(({ debit, accountId, taxRateId }) => [
        debit,
        accountId,
        taxRateId,
      ]),
    ).toEqual([
      [1.88, TAX_PAYABLE_ACCOUNT, 1],
      [3.74, TAX_PAYABLE_ACCOUNT, 2],
      [-0.23, TAX_PAYABLE_ACCOUNT, 1],
      [-0.45, TAX_PAYABLE_ACCOUNT, 2],
    ]);
    expect(balanced(legs)).toBe(true);
  });

  it('gives every component tax entry its own index after the expense entries', () => {
    const legs = payBill(buildTask6Bill(), 37.94, 0);

    // Payment 1, expenses 2 and 3, then one tax entry per line and component.
    expect(legs.map((leg) => leg.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(legs.filter(isTaxLeg).map((leg) => leg.index)).toEqual([4, 5, 6, 7]);
  });
});
