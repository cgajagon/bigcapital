import { transformInvoiceToPdfTemplate } from './utils';

describe('transformInvoiceToPdfTemplate', () => {
  it('labels each tax line with its name and percentage, never a group', () => {
    const template = transformInvoiceToPdfTemplate({
      entries: [],
      customer: {},
      taxes: [
        { name: 'TPS', taxRate: 5, taxRateAmountFormatted: '$1.65' },
        { name: 'TVQ', taxRate: 9.975, taxRateAmountFormatted: '$3.29' },
        { name: 'Zero', taxRate: '0.0000', taxRateAmountFormatted: '$0.00' },
      ],
    } as any);

    expect(template.taxes).toEqual([
      { label: 'TPS (5%)', amount: '$1.65' },
      { label: 'TVQ (9.975%)', amount: '$3.29' },
      { label: 'Zero (0%)', amount: '$0.00' },
    ]);
  });
});
