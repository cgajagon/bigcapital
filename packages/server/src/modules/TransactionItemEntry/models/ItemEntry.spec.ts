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

describe('ItemEntry with tax components', () => {
  const taxComponents = [
    { taxRateId: 1, rate: 5 },
    { taxRateId: 2, rate: 9.975 },
  ];

  it('sums the rounded component taxes on an exclusive line', () => {
    const entry = ItemEntry.fromJson({
      quantity: 1,
      rate: 37.5,
      taxRate: 14.975,
      taxComponents,
    });

    expect(entry.taxAmount).toBe(5.62);
    expect(entry.componentTaxes.map((c) => c.amount)).toEqual([1.88, 3.74]);
  });

  it('rounds a negative line half away from zero', () => {
    const entry = ItemEntry.fromJson({
      quantity: 1,
      rate: -4.5,
      taxRate: 14.975,
      taxComponents,
    });

    expect(entry.taxAmount).toBe(-0.68);
  });

  it('splits an inclusive line by its components', () => {
    const entry = ItemEntry.fromJson({
      quantity: 1,
      rate: 114.975,
      taxRate: 14.975,
      isInclusiveTax: true,
      taxComponents,
    });

    expect(entry.taxAmount).toBe(14.98);
    expect(entry.subtotalExcludingTax).toBeCloseTo(99.995, 6);
  });

  it('reports a plain taxed line as a single component', () => {
    const entry = ItemEntry.fromJson({
      quantity: 1,
      rate: 37.5,
      taxRateId: 1,
      taxRate: 5,
    });

    expect(entry.componentTaxes).toEqual([
      { taxRateId: 1, rate: 5, amount: 1.88 },
    ]);
  });

  it('has no component taxes without a rate', () => {
    const entry = ItemEntry.fromJson({ quantity: 1, rate: 10 });

    expect(entry.componentTaxes).toEqual([]);
  });

  it('parses taxComponents stored as a JSON string', () => {
    const entry = ItemEntry.fromDatabaseJson({
      quantity: 1,
      rate: 37.5,
      taxRate: 14.975,
      taxComponents: JSON.stringify(taxComponents),
    } as any);

    expect(entry.taxComponents).toEqual(taxComponents);
    expect(entry.taxAmount).toBe(5.62);
  });
});
