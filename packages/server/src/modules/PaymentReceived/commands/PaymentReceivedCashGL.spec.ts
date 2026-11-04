import { roundHalfAwayFromZero, TaxComponentRate } from '@bigcapital/utils';
import { PaymentReceivedCashGL } from './PaymentReceivedCashGL';
import { PaymentReceived } from '../models/PaymentReceived';
import { AccountingBasis } from '@/common/types/AccountingBasis';
import { DiscountType } from '@/common/types/Discount';
import { ILedgerEntry } from '@/modules/Ledger/types/Ledger.types';
import { SaleInvoice } from '@/modules/SaleInvoices/models/SaleInvoice';
import { InvoiceAccrualGL } from '@/modules/SaleInvoices/ledger/InvoiceAccrualGL';

interface TestItemEntry {
  itemId?: number;
  description?: string;
  sellAccountId: number;
  totalExcludingTax: number;
  taxAmount?: number;
  taxRateId?: number | null;
  taxRate?: number;
}

interface TestInvoice {
  id: number;
  exchangeRate: number;
  total?: number;
  totalLocal: number;
  entries: TestItemEntry[];
  discountAmountLocal?: number | null;
  adjustmentLocal?: number | null;
}

const buildItemEntry = (
  overrides: Partial<TestItemEntry> = {},
): TestItemEntry => ({
  itemId: 1,
  description: 'Item description',
  sellAccountId: 500,
  totalExcludingTax: 1000,
  taxAmount: 0,
  taxRateId: null,
  taxRate: 0,
  ...overrides,
});

const buildInvoice = (
  entries: TestItemEntry[],
  overrides: Partial<TestInvoice> = {},
): TestInvoice => {
  const invoice = {
    id: 10,
    exchangeRate: 1,
    totalLocal: entries.reduce(
      (total, entry) =>
        total + entry.totalExcludingTax + (entry.taxAmount || 0),
      0,
    ),
    discountAmountLocal: null,
    adjustmentLocal: null,
    entries,
    ...overrides,
  };
  // The invoice total in its currency, as the model derives it.
  return { total: invoice.totalLocal / invoice.exchangeRate, ...invoice };
};

const buildPayment = () =>
  ({
    id: 1,
    paymentReceiveNo: 'PAY-00001',
    referenceNo: 'REF-00001',
    paymentDate: '2024-01-01',
    currencyCode: 'USD',
    exchangeRate: 1,
    userId: 1,
    branchId: 1,
    createdAt: '2024-01-01',
    depositAccountId: 100,
    customerId: 5,
    entries: [],
  }) as unknown as PaymentReceived;

const buildPaymentEntry = (invoice: TestInvoice, paymentAmount: number) => ({
  invoiceId: invoice.id,
  paymentAmount,
  invoice,
});

const buildGL = (
  payment: PaymentReceived,
  paidBeforeByInvoiceId: Record<number, number> = {},
) =>
  new PaymentReceivedCashGL(payment, paidBeforeByInvoiceId)
    .setTaxPayableAccountId(200)
    .setDiscountAccountId(300)
    .setOtherChargesAccountId(400);

const findEntry = (entries: any[], accountId: number) =>
  entries.find((entry) => entry.accountId === accountId);

describe('PaymentReceivedCashGL', () => {
  it('records Dr deposit / Cr income for a full tax-free payment', () => {
    const invoice = buildInvoice([buildItemEntry()], { totalLocal: 1000 });
    const payment = {
      ...buildPayment(),
      entries: [buildPaymentEntry(invoice, 1000)],
    } as unknown as PaymentReceived;

    const entries = buildGL(payment).GLEntries();

    expect(entries).toHaveLength(2);

    const depositEntry = findEntry(entries, 100);
    expect(depositEntry.debit).toBe(1000);
    expect(depositEntry.credit).toBe(0);
    expect(depositEntry.accountNormal).toBe('debit');

    const incomeEntry = findEntry(entries, 500);
    expect(incomeEntry.credit).toBe(1000);
    expect(incomeEntry.debit).toBe(0);
    expect(incomeEntry.accountNormal).toBe('credit');
  });

  it('flags the entries as cash basis with its own index group', () => {
    const invoice = buildInvoice([buildItemEntry()], { totalLocal: 1000 });
    const payment = {
      ...buildPayment(),
      entries: [buildPaymentEntry(invoice, 1000)],
    } as unknown as PaymentReceived;

    const entries = buildGL(payment).GLEntries();

    entries.forEach((entry) => {
      expect(entry.basis).toBe(AccountingBasis.Cash);
      expect(entry.indexGroup).toBe(50);
      expect(entry.transactionType).toBe('PaymentReceive');
      expect(entry.transactionId).toBe(payment.id);
    });
  });

  it('mirrors the invoice tax payable for a tax-exclusive invoice', () => {
    const invoice = buildInvoice(
      [
        buildItemEntry({
          totalExcludingTax: 1000,
          taxAmount: 100,
          taxRateId: 7,
          taxRate: 10,
        }),
      ],
      { totalLocal: 1100 },
    );
    const payment = {
      ...buildPayment(),
      entries: [buildPaymentEntry(invoice, 1100)],
    } as unknown as PaymentReceived;

    const entries = buildGL(payment).GLEntries();

    expect(entries).toHaveLength(3);
    expect(findEntry(entries, 100).debit).toBe(1100);
    expect(findEntry(entries, 500).credit).toBe(1000);

    const taxEntry = findEntry(entries, 200);
    expect(taxEntry.credit).toBe(100);
    expect(taxEntry.taxRateId).toBe(7);
    expect(taxEntry.taxRate).toBe(10);
  });

  it('recognizes the income proportionally for a partial payment', () => {
    const invoice = buildInvoice([buildItemEntry()], { totalLocal: 1000 });
    const payment = {
      ...buildPayment(),
      entries: [buildPaymentEntry(invoice, 400)],
    } as unknown as PaymentReceived;

    const entries = buildGL(payment).GLEntries();

    expect(findEntry(entries, 100).debit).toBe(400);
    expect(findEntry(entries, 500).credit).toBe(400);
  });

  it('mirrors the invoice discount and adjustment entries', () => {
    const invoice = buildInvoice([buildItemEntry()], {
      totalLocal: 950,
      discountAmountLocal: 100,
      adjustmentLocal: 50,
    });
    const payment = {
      ...buildPayment(),
      entries: [buildPaymentEntry(invoice, 950)],
    } as unknown as PaymentReceived;

    const entries = buildGL(payment).GLEntries();

    expect(entries).toHaveLength(4);
    expect(findEntry(entries, 100).debit).toBe(950);
    expect(findEntry(entries, 500).credit).toBe(1000);
    expect(findEntry(entries, 300).debit).toBe(100);
    expect(findEntry(entries, 400).credit).toBe(50);
  });

  it('records the income of each invoice of a multi-invoices payment', () => {
    const invoiceA = buildInvoice([buildItemEntry({ sellAccountId: 500 })], {
      id: 10,
      totalLocal: 1000,
    });
    const invoiceB = buildInvoice(
      [buildItemEntry({ sellAccountId: 501, totalExcludingTax: 500 })],
      {
        id: 11,
        totalLocal: 500,
      },
    );
    const payment = {
      ...buildPayment(),
      entries: [
        buildPaymentEntry(invoiceA, 1000),
        buildPaymentEntry(invoiceB, 500),
      ],
    } as unknown as PaymentReceived;

    const entries = buildGL(payment).GLEntries();

    expect(entries).toHaveLength(4);
    expect(findEntry(entries, 500).credit).toBe(1000);
    expect(findEntry(entries, 501).credit).toBe(500);
    expect(
      entries
        .filter((entry) => entry.accountId === 100)
        .reduce((total, entry) => total + entry.debit, 0),
    ).toBe(1500);
  });

  it('keeps the cash basis entries balanced', () => {
    const invoice = buildInvoice(
      [
        buildItemEntry({ totalExcludingTax: 1000, taxAmount: 100 }),
        buildItemEntry({
          sellAccountId: 501,
          totalExcludingTax: 500,
          taxAmount: 50,
        }),
      ],
      { id: 10, totalLocal: 1550, discountAmountLocal: 100 },
    );
    const payment = {
      ...buildPayment(),
      entries: [buildPaymentEntry(invoice, 825)],
    } as unknown as PaymentReceived;

    const entries = buildGL(payment).GLEntries();

    const totalDebit = entries.reduce((total, entry) => total + entry.debit, 0);
    const totalCredit = entries.reduce(
      (total, entry) => total + entry.credit,
      0,
    );
    expect(totalDebit).toBeCloseTo(totalCredit, 2);
    expect(findEntry(entries, 100).debit).toBe(825);
  });
});

describe('PaymentReceivedCashGL tax rounding', () => {
  const DEPOSIT_ACCOUNT = 100;
  const TAX_PAYABLE_ACCOUNT = 200;
  const INCOME_ACCOUNT = 500;

  // A real invoice model, so its total and line taxes are derived as saved.
  const buildTaxedInvoice = (
    amounts: number[],
    overrides: Record<string, any> = {},
  ): SaleInvoice =>
    SaleInvoice.fromJson({
      id: 10,
      invoiceNo: 'INV-00001',
      currencyCode: 'CAD',
      exchangeRate: 1,
      balance: amounts.reduce((total, amount) => total + amount, 0),
      discount: 0,
      discountType: DiscountType.Amount,
      adjustment: 0,
      isInclusiveTax: false,
      entries: amounts.map((amount, index) => ({
        index: index + 1,
        itemId: 1,
        sellAccountId: INCOME_ACCOUNT,
        quantity: 1,
        rate: amount,
        discount: 0,
        discountType: DiscountType.Amount,
        taxRateId: 7,
        taxRate: 14.975,
        isInclusiveTax: false,
      })),
      ...overrides,
    });

  // The cash basis legs of a payment of `paymentAmount` on the invoice, when
  // earlier payments paid `paidBefore` of it.
  const payInvoice = (
    invoice: SaleInvoice,
    paymentAmount: number,
    paidBefore: number,
    paymentOverrides: Record<string, any> = {},
  ): ILedgerEntry[] => {
    const payment = {
      ...buildPayment(),
      exchangeRate: invoice.exchangeRate,
      ...paymentOverrides,
      entries: [{ invoiceId: invoice.id, paymentAmount, invoice }],
    } as unknown as PaymentReceived;

    return buildGL(payment, { [invoice.id]: paidBefore }).GLEntries();
  };

  const credits = (legs: ILedgerEntry[], accountId: number) =>
    legs.filter((leg) => leg.accountId === accountId).map((leg) => leg.credit);
  const tax = (legs: ILedgerEntry[]) => credits(legs, TAX_PAYABLE_ACCOUNT);
  const income = (legs: ILedgerEntry[]) => credits(legs, INCOME_ACCOUNT);

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

  it('posts exactly the invoice tax over three payments, each journal balanced', () => {
    // 100 at 14.975 %: tax 14.98, total 114.98.
    const invoice = buildTaxedInvoice([100], { taxAmountWithheld: 14.98 });

    const payments = [
      payInvoice(invoice, 38.33, 0),
      payInvoice(invoice, 38.33, 38.33),
      payInvoice(invoice, 38.32, 76.66),
    ];
    const totalTax = payments
      .flatMap(tax)
      .reduce((total, amount) => total + amount, 0);

    expect(payments.map(tax)).toEqual([[4.99], [5], [4.99]]);
    expect(Math.round(totalTax * 1000)).toBe(14980);
    expect(payments.map(income)).toEqual([[33.34], [33.33], [33.33]]);
    payments.forEach((legs) => {
      expect(balanced(legs)).toBe(true);
      expect(atStoredPrecision(legs)).toBe(true);
    });
  });

  it('counts an earlier entry of the same payment as paid before', () => {
    const invoice = buildTaxedInvoice([100], { taxAmountWithheld: 14.98 });
    const payment = {
      ...buildPayment(),
      entries: [38.33, 38.33, 38.32].map((paymentAmount) => ({
        invoiceId: invoice.id,
        paymentAmount,
        invoice,
      })),
    } as unknown as PaymentReceived;

    const legs = buildGL(payment).GLEntries();

    expect(tax(legs)).toEqual([4.99, 5, 4.99]);
    expect(balanced(legs)).toBe(true);
  });

  it('posts a negative tax entry for a negative line and balances', () => {
    // 37.50 and -4.50 at 14.975 %: tax 5.62 and -0.67, total 37.95.
    const invoice = buildTaxedInvoice([37.5, -4.5], {
      taxAmountWithheld: 4.95,
    });

    const legs = payInvoice(invoice, 18.98, 0);

    expect(tax(legs)).toEqual([2.81, -0.34]);
    expect(income(legs)).toEqual([18.756, -2.246]);
    expect(balanced(legs)).toBe(true);
    expect(atStoredPrecision(legs)).toBe(true);
  });

  it('posts no entries and no NaN for a zero-total invoice', () => {
    const invoice = buildTaxedInvoice([3, -3], { taxAmountWithheld: 0 });

    const legs = payInvoice(invoice, 0, 0);

    expect(legs).toEqual([]);
  });

  it('balances in the organization currency at exchange rate 1.3567', () => {
    const invoice = buildTaxedInvoice([37.5, -4.5], {
      taxAmountWithheld: 4.95,
      exchangeRate: 1.3567,
    });

    const legs = payInvoice(invoice, 18.98, 0);

    expect(findEntry(legs, DEPOSIT_ACCOUNT).debit).toBe(25.75);
    expect(tax(legs)).toEqual([3.812, -0.461]);
    expect(income(legs)).toEqual([25.446, -3.047]);
    expect(balanced(legs)).toBe(true);
    expect(atStoredPrecision(legs)).toBe(true);
  });

  it('posts the accrual tax of a foreign-currency invoice once fully paid', () => {
    const invoice = buildTaxedInvoice([37.5, -4.5], {
      taxAmountWithheld: 4.95,
      exchangeRate: 1.3567,
    });
    const accrualGL = new InvoiceAccrualGL(invoice);
    accrualGL.setTaxPayableAccountId(TAX_PAYABLE_ACCOUNT);
    const accrualTax = tax(accrualGL.getInvoiceGLEntries());

    const payments = [
      payInvoice(invoice, 18.98, 0),
      payInvoice(invoice, 18.97, 18.98),
    ];
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
    const invoice = buildTaxedInvoice([100], { taxAmountWithheld: 14.98 });
    // Saved in this order, so the ids follow it; the dates are out of order.
    const saved = [
      { id: 1, paymentDate: '2026-11-10', paymentAmount: 38.33 },
      { id: 2, paymentDate: '2026-11-01', paymentAmount: 38.33 },
      { id: 3, paymentDate: '2026-11-20', paymentAmount: 38.32 },
    ];
    // Paid before a payment: the payments with a lower id (Ruling R9), the
    // rule `getInvoicesPaidBefore` queries (PaymentReceivedGLEntries.spec.ts).
    const postTax = (
      payment: (typeof saved)[number],
      payments: typeof saved,
    ) => {
      const paidBefore = payments
        .filter((other) => other.id < payment.id)
        .reduce((total, other) => total + other.paymentAmount, 0);
      const { id, paymentDate } = payment;

      return tax(
        payInvoice(invoice, payment.paymentAmount, paidBefore, {
          id,
          paymentDate,
        }),
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

  it('puts the rounding remainder on the largest income entry', () => {
    const invoice = buildInvoice([
      buildItemEntry({ totalExcludingTax: 1 }),
      buildItemEntry({ sellAccountId: 501, totalExcludingTax: 1 }),
      buildItemEntry({ sellAccountId: 502, totalExcludingTax: 1 }),
    ]);
    const payment = {
      ...buildPayment(),
      entries: [buildPaymentEntry(invoice, 1)],
    } as unknown as PaymentReceived;

    const legs = buildGL(payment).GLEntries();

    expect(legs.map((leg) => leg.credit)).toEqual([0, 0.334, 0.333, 0.333]);
    expect(balanced(legs)).toBe(true);
  });
});

describe('PaymentReceivedCashGL tax groups', () => {
  const DEPOSIT_ACCOUNT = 100;
  const TAX_PAYABLE_ACCOUNT = 200;
  const INCOME_ACCOUNT = 500;
  const TPS_PAYABLE_ACCOUNT = 2101;
  const TVQ_PAYABLE_ACCOUNT = 2102;

  // TPS (id 1) and TVQ (id 2), the components of the group id 9.
  const TPS = { taxRateId: 1, rate: 5 };
  const TVQ = { taxRateId: 2, rate: 9.975 };
  const PAYABLE_ACCOUNTS_BY_RATE_ID = {
    1: TPS_PAYABLE_ACCOUNT,
    2: TVQ_PAYABLE_ACCOUNT,
  };

  interface TestLine {
    amount: number;
    taxRateId: number;
    taxRate: number;
    taxComponents: TaxComponentRate[] | null;
  }
  const groupLine = (amount: number): TestLine => ({
    amount,
    taxRateId: 9,
    taxRate: 14.975,
    taxComponents: [TPS, TVQ],
  });
  const tpsLine = (amount: number): TestLine => ({
    amount,
    taxRateId: 1,
    taxRate: 5,
    taxComponents: null,
  });

  // A real invoice model, so its total and component taxes are derived as saved.
  const buildGroupInvoice = (
    lines: TestLine[],
    overrides: Record<string, any> = {},
  ): SaleInvoice =>
    SaleInvoice.fromJson({
      id: 10,
      invoiceNo: 'INV-00001',
      currencyCode: 'CAD',
      exchangeRate: 1,
      balance: lines.reduce((total, line) => total + line.amount, 0),
      discount: 0,
      discountType: DiscountType.Amount,
      adjustment: 0,
      isInclusiveTax: false,
      entries: lines.map((line, index) => ({
        index: index + 1,
        itemId: 1,
        sellAccountId: INCOME_ACCOUNT,
        quantity: 1,
        rate: line.amount,
        discount: 0,
        discountType: DiscountType.Amount,
        taxRateId: line.taxRateId,
        taxRate: line.taxRate,
        taxComponents: line.taxComponents,
        isInclusiveTax: overrides.isInclusiveTax ?? false,
      })),
      ...overrides,
    });

  // Group lines 37.50 and -4.50: TPS 1.88 and -0.23, TVQ 3.74 and -0.45,
  // total 37.94 (Task 6's invoice).
  const buildTask6Invoice = (overrides: Record<string, any> = {}) =>
    buildGroupInvoice([groupLine(37.5), groupLine(-4.5)], {
      taxAmountWithheld: 4.94,
      ...overrides,
    });

  // The cash basis legs of a payment of `paymentAmount` on the invoice, when
  // earlier payments paid `paidBefore` of it; without the map when it is null.
  const payInvoice = (
    invoice: SaleInvoice,
    paymentAmount: number,
    paidBefore: number,
    payableAccountsByRateId: Record<
      number,
      number
    > | null = PAYABLE_ACCOUNTS_BY_RATE_ID,
  ): ILedgerEntry[] => {
    const payment = {
      ...buildPayment(),
      exchangeRate: invoice.exchangeRate,
      entries: [{ invoiceId: invoice.id, paymentAmount, invoice }],
    } as unknown as PaymentReceived;
    const cashGL = buildGL(payment, { [invoice.id]: paidBefore });

    if (payableAccountsByRateId) {
      cashGL.setTaxPayableAccountsByRateId(payableAccountsByRateId);
    }
    return cashGL.GLEntries();
  };

  const TAX_ACCOUNTS = [
    TAX_PAYABLE_ACCOUNT,
    TPS_PAYABLE_ACCOUNT,
    TVQ_PAYABLE_ACCOUNT,
  ];
  const isTaxLeg = (leg: ILedgerEntry) => TAX_ACCOUNTS.includes(leg.accountId);
  const taxLegs = (legs: ILedgerEntry[]) =>
    legs.filter(isTaxLeg).map(({ credit, accountId, taxRateId, taxRate }) => ({
      credit,
      accountId,
      taxRateId,
      taxRate,
    }));
  const credits = (legs: ILedgerEntry[], accountId: number) =>
    legs.filter((leg) => leg.accountId === accountId).map((leg) => leg.credit);
  const income = (legs: ILedgerEntry[]) => credits(legs, INCOME_ACCOUNT);
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

  it("posts each component of a full payment to its tax's payable account", () => {
    const legs = payInvoice(buildTask6Invoice(), 37.94, 0);

    expect(taxLegs(legs)).toEqual([
      {
        credit: 1.88,
        accountId: TPS_PAYABLE_ACCOUNT,
        taxRateId: 1,
        taxRate: 5,
      },
      {
        credit: 3.74,
        accountId: TVQ_PAYABLE_ACCOUNT,
        taxRateId: 2,
        taxRate: 9.975,
      },
      {
        credit: -0.23,
        accountId: TPS_PAYABLE_ACCOUNT,
        taxRateId: 1,
        taxRate: 5,
      },
      {
        credit: -0.45,
        accountId: TVQ_PAYABLE_ACCOUNT,
        taxRateId: 2,
        taxRate: 9.975,
      },
    ]);
    expect(findEntry(legs, DEPOSIT_ACCOUNT).debit).toBe(37.94);
    // The income keeps the line's (group's) tax rate id.
    expect(
      legs
        .filter((leg) => leg.accountId === INCOME_ACCOUNT)
        .map(({ credit, taxRateId }) => ({ credit, taxRateId })),
    ).toEqual([
      { credit: 37.5, taxRateId: 9 },
      { credit: -4.5, taxRateId: 9 },
    ]);
    expect(balanced(legs)).toBe(true);
    expect(atStoredPrecision(legs)).toBe(true);
  });

  it('posts exactly each component of the invoice over two payments, each journal balanced', () => {
    const invoice = buildTask6Invoice();

    const payments = [
      payInvoice(invoice, 12, 0),
      payInvoice(invoice, 25.94, 12),
    ];
    const tps = payments.map((legs) => credits(legs, TPS_PAYABLE_ACCOUNT));
    const tvq = payments.map((legs) => credits(legs, TVQ_PAYABLE_ACCOUNT));

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
    expect(payments.map(income)).toEqual([
      [11.868, -1.428],
      [25.632, -3.072],
    ]);
    payments.forEach((legs) => {
      expect(taxLegs(legs).map((leg) => leg.taxRateId)).toEqual([1, 2, 1, 2]);
      expect(balanced(legs)).toBe(true);
      expect(atStoredPrecision(legs)).toBe(true);
    });
  });

  it("posts each component's accrual tax over two payments at exchange rate 1.3567", () => {
    const invoice = buildTask6Invoice({ exchangeRate: 1.3567 });
    const accrualGL = new InvoiceAccrualGL(invoice);
    accrualGL.setTaxPayableAccountId(TAX_PAYABLE_ACCOUNT);
    accrualGL.setTaxPayableAccountsByRateId(PAYABLE_ACCOUNTS_BY_RATE_ID);
    const accrualLegs = accrualGL.getInvoiceGLEntries();

    const payments = [
      payInvoice(invoice, 12, 0),
      payInvoice(invoice, 25.94, 12),
    ];
    const paidTax = (accountId: number) =>
      sum(payments.flatMap((legs) => credits(legs, accountId)));

    expect(payments.map((legs) => credits(legs, TPS_PAYABLE_ACCOUNT))).toEqual([
      [0.8, -0.095],
      [1.751, -0.217],
    ]);
    expect(payments.map((legs) => credits(legs, TVQ_PAYABLE_ACCOUNT))).toEqual([
      [1.601, -0.19],
      [3.473, -0.421],
    ]);
    // round3(1.88 × 1.3567) + round3(-0.23 × 1.3567), and the same for TVQ.
    expect(paidTax(TPS_PAYABLE_ACCOUNT)).toBe(2.239);
    expect(paidTax(TVQ_PAYABLE_ACCOUNT)).toBe(4.463);
    expect(paidTax(TPS_PAYABLE_ACCOUNT)).toBe(
      sum(credits(accrualLegs, TPS_PAYABLE_ACCOUNT)),
    );
    expect(paidTax(TVQ_PAYABLE_ACCOUNT)).toBe(
      sum(credits(accrualLegs, TVQ_PAYABLE_ACCOUNT)),
    );
    payments.forEach((legs) => {
      expect(balanced(legs)).toBe(true);
      expect(atStoredPrecision(legs)).toBe(true);
    });
  });

  it('posts no entries and no NaN for a zero-total group invoice', () => {
    // 3 and -3 on the group: TPS 0.15 and -0.15, TVQ 0.30 and -0.30, total 0.
    const invoice = buildGroupInvoice([groupLine(3), groupLine(-3)], {
      taxAmountWithheld: 0,
    });

    expect(invoice.total).toBe(0);
    [0, 5].forEach((paymentAmount) => {
      expect(payInvoice(invoice, paymentAmount, 0)).toEqual([]);
    });
  });

  it('posts every component to the default tax payable account without the map', () => {
    const legs = payInvoice(buildTask6Invoice(), 37.94, 0, null);

    expect(taxLegs(legs)).toEqual([
      {
        credit: 1.88,
        accountId: TAX_PAYABLE_ACCOUNT,
        taxRateId: 1,
        taxRate: 5,
      },
      {
        credit: 3.74,
        accountId: TAX_PAYABLE_ACCOUNT,
        taxRateId: 2,
        taxRate: 9.975,
      },
      {
        credit: -0.23,
        accountId: TAX_PAYABLE_ACCOUNT,
        taxRateId: 1,
        taxRate: 5,
      },
      {
        credit: -0.45,
        accountId: TAX_PAYABLE_ACCOUNT,
        taxRateId: 2,
        taxRate: 9.975,
      },
    ]);
    expect(balanced(legs)).toBe(true);
  });

  it('gives every component tax entry its own index after the income entries', () => {
    const legs = payInvoice(buildTask6Invoice(), 37.94, 0);

    // Deposit 1, income 2 and 3, then one tax entry per line and component.
    expect(legs.map((leg) => leg.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(legs.filter(isTaxLeg).map((leg) => leg.index)).toEqual([4, 5, 6, 7]);
  });

  it('splits a fully paid tax-inclusive group line into income and component taxes', () => {
    // 114.975 inclusive of 14.975 %: TPS 5.00, TVQ 9.98, income 99.995.
    const invoice = buildGroupInvoice([groupLine(114.975)], {
      taxAmountWithheld: 14.98,
      isInclusiveTax: true,
    });

    const legs = payInvoice(invoice, 114.975, 0);

    expect(
      taxLegs(legs).map(({ credit, accountId }) => [credit, accountId]),
    ).toEqual([
      [5, TPS_PAYABLE_ACCOUNT],
      [9.98, TVQ_PAYABLE_ACCOUNT],
    ]);
    expect(income(legs)).toEqual([99.995]);
    expect(findEntry(legs, DEPOSIT_ACCOUNT).debit).toBe(114.975);
    expect(balanced(legs)).toBe(true);
  });

  it('posts a plain TPS line and a group line of one invoice to the TPS and TVQ accounts', () => {
    // 10 at TPS: 0.50; 37.50 on the group: TPS 1.88, TVQ 3.74; total 53.62.
    const invoice = buildGroupInvoice([tpsLine(10), groupLine(37.5)], {
      taxAmountWithheld: 6.12,
    });

    const legs = payInvoice(invoice, 53.62, 0);

    expect(taxLegs(legs)).toEqual([
      {
        credit: 0.5,
        accountId: TPS_PAYABLE_ACCOUNT,
        taxRateId: 1,
        taxRate: 5,
      },
      {
        credit: 1.88,
        accountId: TPS_PAYABLE_ACCOUNT,
        taxRateId: 1,
        taxRate: 5,
      },
      {
        credit: 3.74,
        accountId: TVQ_PAYABLE_ACCOUNT,
        taxRateId: 2,
        taxRate: 9.975,
      },
    ]);
    expect(income(legs)).toEqual([10, 37.5]);
    expect(balanced(legs)).toBe(true);
  });
});
