import { DiscountType } from '@/common/types/Discount';
import { ItemEntry } from './ItemEntry';

describe('ItemEntry.calcAmount', () => {
  it('returns the gross amount when no discount is set', () => {
    expect(ItemEntry.calcAmount({ quantity: 2, rate: 1000 })).toBe(2000);
    expect(ItemEntry.calcAmount({ quantity: 2, rate: 1000, discount: 0 })).toBe(
      2000,
    );
  });

  it('applies a percentage discount', () => {
    expect(
      ItemEntry.calcAmount({
        quantity: 2,
        rate: 1000,
        discount: 10,
        discountType: DiscountType.Percentage,
      }),
    ).toBe(1800);
  });

  it('treats a missing discount type as percentage', () => {
    expect(
      ItemEntry.calcAmount({ quantity: 2, rate: 1000, discount: 10 }),
    ).toBe(1800);
  });

  it('applies an amount discount', () => {
    expect(
      ItemEntry.calcAmount({
        quantity: 2,
        rate: 1000,
        discount: 100,
        discountType: DiscountType.Amount,
      }),
    ).toBe(1900);
  });
});

describe('ItemEntry.taxAmount', () => {
  it('is zero when the entry has no tax rate', () => {
    const exclusive = ItemEntry.fromJson({ quantity: 1, rate: 1000 });
    const inclusive = ItemEntry.fromJson({
      quantity: 1,
      rate: 1000,
      isInclusiveTax: true,
    });

    expect(exclusive.taxAmount).toBe(0);
    expect(inclusive.taxAmount).toBe(0);
  });

  it('rounds an exclusive line tax to the cent', () => {
    const entry = ItemEntry.fromJson({
      quantity: 1,
      rate: 37.5,
      taxRate: 14.975,
    });

    expect(entry.taxAmount).toBe(5.62);
    expect(entry.subtotal).toBe(43.12);
  });

  it('rounds a negative exclusive line tax away from zero', () => {
    const entry = ItemEntry.fromJson({
      quantity: 1,
      rate: -4.5,
      taxRate: 14.975,
    });

    expect(entry.taxAmount).toBe(-0.67);
  });

  it('extracts an inclusive tax from a round amount', () => {
    const entry = ItemEntry.fromJson({
      quantity: 1,
      rate: 1100,
      taxRate: 10,
      isInclusiveTax: true,
    });

    expect(entry.taxAmount).toBe(100);
    expect(entry.subtotalExcludingTax).toBe(1000);
  });

  it('rounds an inclusive line tax to the cent', () => {
    const entry = ItemEntry.fromJson({
      quantity: 1,
      rate: 37.5,
      taxRate: 14.975,
      isInclusiveTax: true,
    });

    expect(entry.taxAmount).toBe(4.88);
    expect(entry.subtotalExcludingTax).toBe(32.62);
  });

  it('keeps a negative inclusive line balanced', () => {
    const entry = ItemEntry.fromJson({
      quantity: 1,
      rate: -114.975,
      taxRate: 14.975,
      isInclusiveTax: true,
    });

    expect(entry.taxAmount).toBe(-14.98);
    expect(entry.subtotalExcludingTax + entry.taxAmount).toBeCloseTo(
      entry.amount,
      3,
    );
  });
});
