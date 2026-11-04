import { roundHalfAwayFromZero } from '@bigcapital/utils';
import { PaymentReceivedCashGL } from './PaymentReceivedCashGL';
import { PaymentReceived } from '../models/PaymentReceived';
import { AccountingBasis } from '@/common/types/AccountingBasis';
import { DiscountType } from '@/common/types/Discount';
import { ILedgerEntry } from '@/modules/Ledger/types/Ledger.types';
import { SaleInvoice } from '@/modules/SaleInvoices/models/SaleInvoice';

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
  ): ILedgerEntry[] => {
    const payment = {
      ...buildPayment(),
      exchangeRate: invoice.exchangeRate,
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
    expect(tax(legs)).toEqual([3.81, -0.45]);
    expect(income(legs)).toEqual([25.448, -3.058]);
    expect(balanced(legs)).toBe(true);
    expect(atStoredPrecision(legs)).toBe(true);
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
