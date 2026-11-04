import { SaleInvoice } from '../SaleInvoices/models/SaleInvoice';
import { Bill } from '../Bills/models/Bill';

const record = (filter: (builder: any) => void) => {
  const calls: [string, ...any[]][] = [];
  const builder: any = new Proxy(
    {},
    {
      get:
        (_, method: string) =>
        (...args: any[]) => {
          calls.push([method, ...args]);
          return builder;
        },
    },
  );
  filter(builder);
  return calls;
};

describe.each([
  ['SaleInvoice', SaleInvoice],
  ['Bill', Bill],
])('%s tax relations', (_name, model: any) => {
  it('orders the taxes by their row id, so components keep their order', () => {
    const calls = record(model.relationMappings.taxes.filter);

    expect(calls).toContainEqual(['orderBy', 'tax_rate_transactions.id']);
  });

  it('keeps the entries ordered by index only', () => {
    const calls = record(model.relationMappings.entries.filter);

    expect(calls).toContainEqual(['orderBy', 'index', 'ASC']);
    expect(
      calls.filter(([, ...args]) =>
        String(args[0] ?? '').startsWith('tax_rate_transactions'),
      ),
    ).toEqual([]);
  });
});
