import { allocateDocumentLineTaxes, getDocumentLineTaxes } from './utils';

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
