import { ItemEntry } from '@/modules/TransactionItemEntry/models/ItemEntry';
import { ItemEntriesTaxTransactions } from './ItemEntriesTaxTransactions.service';

describe('ItemEntriesTaxTransactions', () => {
  const service = new ItemEntriesTaxTransactions(
    (() => ItemEntry) as any,
    {} as any,
    {} as any,
  );

  it('sums the rounded tax of each line, credit lines included', () => {
    const model = service.assocTaxAmountWithheldFromEntries({
      entries: [
        { quantity: 1, rate: 37.5, taxRate: 14.975 },
        { quantity: 1, rate: -4.5, taxRate: 14.975 },
      ],
    });

    expect(model.taxAmountWithheld).toBe(4.95);
  });
});
