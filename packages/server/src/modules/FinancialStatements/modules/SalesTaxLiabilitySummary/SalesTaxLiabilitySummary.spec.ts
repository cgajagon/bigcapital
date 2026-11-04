import { SalesTaxLiabilitySummary } from './SalesTaxLiabilitySummary';
import { SalesTaxLiabilitySummaryRepository } from './SalesTaxLiabilitySummaryRepository';
import {
  SalesTaxLiabilitySummaryPayableById,
  SalesTaxLiabilitySummaryQuery,
  SalesTaxLiabilitySummarySalesById,
} from './SalesTaxLiability.types';
import { AccountingBasis } from '@/common/types/AccountingBasis';

const query: SalesTaxLiabilitySummaryQuery = {
  fromDate: '2026-01-01',
  toDate: '2026-01-31',
  basis: AccountingBasis.Accrual,
  numberFormat: {},
};

const createSummary = ({
  payable = {},
  sales = {},
  salesPayable = {},
  purchasePayable = {},
  taxRates = [{ id: 1, name: 'Tax', rate: 10 }],
  taxGroupComponentIds = {},
}: {
  taxRates?: Array<{ id: number; name: string; rate: number }>;
  taxGroupComponentIds?: Record<number, number[]>;
  payable?: SalesTaxLiabilitySummaryPayableById;
  sales?: SalesTaxLiabilitySummarySalesById;
  salesPayable?: SalesTaxLiabilitySummaryPayableById;
  purchasePayable?: SalesTaxLiabilitySummaryPayableById;
}) => {
  const repository = {
    taxRates,
    taxGroupComponentIds,
    taxesPayableByTaxRateId: payable,
    accountTransactionsByTaxRateId: sales,
    salesTaxesPayableByTaxRateId: salesPayable,
    purchaseTaxesPayableByTaxRateId: purchasePayable,
  } as unknown as SalesTaxLiabilitySummaryRepository;

  return new SalesTaxLiabilitySummary(query, repository, {
    baseCurrency: 'USD',
    dateFormat: 'YYYY MMM DD',
  });
};

describe('SalesTaxLiabilitySummary', () => {
  it('calculates the tax percentage from the payable tax over the taxable sales', () => {
    const summary = createSummary({
      payable: { 1: { taxRateId: 1, credit: 100, debit: 0 } },
      sales: { 1: { taxRateId: 1, credit: 1000, debit: 0 } },
    });

    const [taxRate] = summary.reportData().taxRates;

    expect(taxRate.taxPercentage.amount).toBe(0.1);
    expect(taxRate.taxPercentage.formattedAmount).toBe('%10.00');
  });

  it('returns a zero percentage when the taxable sales are zero', () => {
    const summary = createSummary({
      payable: { 1: { taxRateId: 1, credit: 100, debit: 0 } },
    });

    const [taxRate] = summary.reportData().taxRates;

    expect(taxRate.taxPercentage.amount).toBe(0);
    expect(taxRate.taxPercentage.formattedAmount).not.toContain('NaN');
  });

  it('returns a zero percentage when the taxable sales and payable tax are negative', () => {
    const summary = createSummary({
      payable: { 1: { taxRateId: 1, credit: 0, debit: 100 } },
    });

    const [taxRate] = summary.reportData().taxRates;

    expect(taxRate.taxPercentage.amount).toBe(0);
    expect(taxRate.taxPercentage.formattedAmount).not.toContain('NaN');
  });

  it('returns a zero percentage when there are no transactions', () => {
    const summary = createSummary({
      sales: { 1: { taxRateId: 1, credit: 0, debit: 0 } },
    });

    const [taxRate] = summary.reportData().taxRates;

    expect(taxRate.taxPercentage.amount).toBe(0);
    expect(taxRate.taxPercentage.formattedAmount).not.toContain('NaN');
  });

  it('splits tax on sales and tax on purchases by document type', () => {
    const summary = createSummary({
      payable: { 1: { taxRateId: 1, credit: 10, debit: 5 } },
      salesPayable: { 1: { taxRateId: 1, credit: 10, debit: 1 } },
      purchasePayable: { 1: { taxRateId: 1, credit: 0, debit: 4 } },
      sales: { 1: { taxRateId: 1, credit: 100, debit: 0 } },
    });

    const { taxRates, total } = summary.reportData();
    const [taxRate] = taxRates;

    expect(taxRate.taxableAmount.amount).toBe(100);
    expect(taxRate.taxOnSalesAmount.amount).toBe(9);
    expect(taxRate.collectedTaxAmount.amount).toBe(4);
    expect(taxRate.taxAmount.amount).toBe(5);
    expect(total.taxOnSalesAmount.amount).toBe(9);
  });

  it('adds the sales of the groups containing a rate to its taxable amount', () => {
    const summary = createSummary({
      taxRates: [
        { id: 1, name: 'TPS', rate: 5 },
        { id: 2, name: 'TVQ', rate: 9.975 },
      ],
      taxGroupComponentIds: { 9: [1, 2] },
      sales: {
        1: { taxRateId: 1, credit: 100, debit: 0 },
        9: { taxRateId: 9, credit: 33, debit: 0 },
      },
      salesPayable: {
        1: { taxRateId: 1, credit: 6.65, debit: 0 },
        2: { taxRateId: 2, credit: 3.29, debit: 0 },
      },
      payable: {
        1: { taxRateId: 1, credit: 6.65, debit: 0 },
        2: { taxRateId: 2, credit: 3.29, debit: 0 },
      },
    });

    const { taxRates } = summary.reportData();

    expect(taxRates.map((row) => row.id)).toEqual([1, 2]);
    expect(taxRates[0].taxableAmount.amount).toBe(133);
    expect(taxRates[0].taxOnSalesAmount.amount).toBe(6.65);
    expect(taxRates[1].taxableAmount.amount).toBe(33);
    expect(taxRates[1].taxOnSalesAmount.amount).toBe(3.29);
  });
});
