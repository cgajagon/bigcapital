import { getLineTaxesByTaxRateId } from '../../TaxRates/utils';
import { SaleInvoiceTaxEntryTransformer } from './SaleInvoiceTaxEntry.transformer';

const buildDocument = () =>
  ({
    entries: [
      { taxRateId: 1, taxAmount: 5.62 },
      { taxRateId: 1, taxAmount: -0.67 },
      { taxRateId: null, taxAmount: 0 },
      { taxRateId: 2, taxAmount: 2.5 },
    ],
    taxAmountWithheld: 7.45,
    taxes: [
      {
        id: 10,
        taxRateId: 1,
        rate: 14.975,
        taxRate: { id: 1, code: 'A', name: 'Tax A', rate: 99 },
      },
      {
        id: 11,
        taxRateId: 2,
        rate: 5,
        taxRate: { id: 2, code: 'B', name: 'Tax B', rate: 99 },
      },
    ],
  }) as any;

describe('SaleInvoiceTaxEntryTransformer', () => {
  it('groups the allocated line taxes by tax rate', () => {
    expect(getLineTaxesByTaxRateId(buildDocument())).toEqual({
      1: 4.95,
      2: 2.5,
    });
  });

  it('shows the sum of the line taxes at the stored percentage', () => {
    const document = buildDocument();
    const options = {
      lineTaxesByTaxRateId: getLineTaxesByTaxRateId(document),
      currencyCode: 'USD',
    };
    const [a, b] = document.taxes.map((taxEntry) => {
      const transformer = new SaleInvoiceTaxEntryTransformer();
      transformer.setOptions(options);
      return transformer.work(taxEntry);
    });

    expect(a.taxRate).toBe(14.975);
    expect(a.taxRateAmount).toBe(4.95);
    expect(b.taxRate).toBe(5);
    expect(b.taxRateAmount).toBe(2.5);
  });
});
