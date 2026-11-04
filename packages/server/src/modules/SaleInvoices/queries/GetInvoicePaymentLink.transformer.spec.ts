import { GetInvoicePaymentLinkTaxEntryTransformer } from './GetInvoicePaymentLink.transformer';

describe('GetInvoicePaymentLinkTaxEntryTransformer', () => {
  it('includes the stored tax percentage of a component', () => {
    const transformer = new GetInvoicePaymentLinkTaxEntryTransformer();
    transformer.setOptions({
      lineTaxesByTaxRateId: { 2: 3.29 },
      currencyCode: 'USD',
    });
    const result = transformer.work({
      id: 20,
      taxRateId: 2,
      rate: 9.975,
      taxRate: { id: 2, code: 'TVQ', name: 'TVQ', rate: 10 },
    });

    expect(result).toMatchObject({
      name: 'TVQ',
      taxRate: 9.975,
      taxRateAmount: 3.29,
    });
  });
});
