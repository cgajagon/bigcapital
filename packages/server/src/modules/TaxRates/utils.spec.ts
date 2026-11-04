import { ItemEntry } from '@/modules/TransactionItemEntry/models/ItemEntry';
import {
  allocateDocumentLineTaxes,
  getDocumentLineComponentTaxes,
  getDocumentLineTaxes,
  getLineTaxesByTaxRateId,
} from './utils';

describe('allocateDocumentLineTaxes', () => {
  it.each([
    [[1.88, 0.62], 2.49, [1.87, 0.62]],
    [[5.62, -0.67], 4.95, [5.62, -0.67]],
    [[5.62, -0.67], 4.94, [5.61, -0.67]],
    [[0.45, -0.45], 0, [0.45, -0.45]],
    [[1.88, -1.88], 0.01, [1.89, -1.88]],
    [[0, 0], 0.5, [0, 0]],
    [[], 0, []],
    [[2.5], null, [2.5]],
    [[2.5], undefined, [2.5]],
  ])('%j with document tax %j gives %j', (lines, documentTax, expected) => {
    expect(allocateDocumentLineTaxes(lines, documentTax)).toEqual(expected);
  });

  it('does not mutate the input', () => {
    const lines = [1.88, 0.62];
    allocateDocumentLineTaxes(lines, 2.49);
    expect(lines).toEqual([1.88, 0.62]);
  });

  it('never returns -0', () => {
    const [first] = allocateDocumentLineTaxes([0.01, 0.01], 0.01);
    expect(Object.is(first, 0)).toBe(true);
  });
});

describe('getDocumentLineTaxes', () => {
  it('allocates the stored document tax over the entries taxAmount', () => {
    const entries = [{ taxAmount: 5.62 }, { taxAmount: -0.67 }] as any;
    expect(getDocumentLineTaxes({ entries, taxAmountWithheld: 4.94 })).toEqual([
      5.61, -0.67,
    ]);
  });

  it('handles a document without entries', () => {
    expect(getDocumentLineTaxes({ taxAmountWithheld: 1 })).toEqual([]);
  });
});

describe('getDocumentLineComponentTaxes', () => {
  const TPS = { taxRateId: 1, rate: 5 };
  const TVQ = { taxRateId: 2, rate: 9.975 };

  // A line on the TPS + TVQ group (id 9).
  const groupLine = (amount: number) =>
    ItemEntry.fromJson({
      quantity: 1,
      rate: amount,
      taxRateId: 9,
      taxRate: 14.975,
      taxComponents: [TPS, TVQ],
    });

  const plainLine = (
    amount: number,
    taxRateId: number | null,
    taxRate: number,
  ) => ItemEntry.fromJson({ quantity: 1, rate: amount, taxRateId, taxRate });

  it('splits each group line into its components, rounded per line', () => {
    const lines = getDocumentLineComponentTaxes({
      entries: [groupLine(37.5), groupLine(-4.5)],
      taxAmountWithheld: 4.94,
    });

    expect(lines).toEqual([
      [
        { taxRateId: 1, rate: 5, amount: 1.88 },
        { taxRateId: 2, rate: 9.975, amount: 3.74 },
      ],
      [
        { taxRateId: 1, rate: 5, amount: -0.23 },
        { taxRateId: 2, rate: 9.975, amount: -0.45 },
      ],
    ]);
  });

  it("keeps a plain pre-A3 document's allocated line taxes, one component per line", () => {
    // Per-line rounding gives 1.88 + 0.62; the document stored 2.49.
    const lines = getDocumentLineComponentTaxes({
      entries: [plainLine(37.5, 7, 5), plainLine(12.3, 7, 5)],
      taxAmountWithheld: 2.49,
    });

    expect(lines).toEqual([
      [{ taxRateId: 7, rate: 5, amount: 1.87 }],
      [{ taxRateId: 7, rate: 5, amount: 0.62 }],
    ]);
  });

  it('puts the extra cent of the stored document tax on the largest component', () => {
    const lines = getDocumentLineComponentTaxes({
      entries: [groupLine(37.5)],
      taxAmountWithheld: 5.63,
    });

    expect(lines).toEqual([
      [
        { taxRateId: 1, rate: 5, amount: 1.88 },
        { taxRateId: 2, rate: 9.975, amount: 3.75 },
      ],
    ]);
  });

  it("adds each line's components up to its allocated line tax", () => {
    const document = {
      entries: [groupLine(37.5), groupLine(-4.5)],
      taxAmountWithheld: 4.93,
    };
    const lineTaxes = getDocumentLineTaxes(document);
    const lines = getDocumentLineComponentTaxes(document);

    expect(lineTaxes).toEqual([5.61, -0.68]);
    expect(lines.map((line) => line.map((c) => c.amount))).toEqual([
      [1.88, 3.73],
      [-0.23, -0.45],
    ]);
  });

  it('keeps the line tax of a taxed line without a tax rate id as one component', () => {
    // Stale data (rate set, id missing): A3 posted the line tax tagged null.
    const lines = getDocumentLineComponentTaxes({
      entries: [plainLine(100, null, 10)],
      taxAmountWithheld: 10,
    });

    expect(lines).toEqual([[{ taxRateId: null, rate: 10, amount: 10 }]]);
  });

  it('gives no component for an untaxed line', () => {
    const lines = getDocumentLineComponentTaxes({
      entries: [plainLine(100, null, 0)],
      taxAmountWithheld: 0,
    });

    expect(lines).toEqual([[]]);
  });

  it('handles a document without entries', () => {
    expect(getDocumentLineComponentTaxes({ taxAmountWithheld: 1 })).toEqual([]);
  });
});

describe('getLineTaxesByTaxRateId', () => {
  const TPS = { taxRateId: 1, rate: 5 };
  const TVQ = { taxRateId: 2, rate: 9.975 };
  const groupLine = (amount: number) =>
    ItemEntry.fromJson({
      quantity: 1,
      rate: amount,
      taxRateId: 9,
      taxRate: 14.975,
      taxComponents: [TPS, TVQ],
    });

  it('keys a mixed plain and group document by component, never by group', () => {
    const plain = ItemEntry.fromJson({
      quantity: 1,
      rate: 10,
      taxRateId: 1,
      taxRate: 5,
    });

    expect(
      getLineTaxesByTaxRateId({
        entries: [plain, groupLine(37.5), groupLine(-4.5)],
        taxAmountWithheld: 5.44,
      }),
    ).toEqual({ 1: 2.15, 2: 3.29 });
  });
});
