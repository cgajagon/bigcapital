import { ImportFileCommon } from './ImportFileCommon';
import { Importable } from './Importable';
import { ImportRowSkip } from './interfaces';
import { ImportModelShape } from './models/Import';

class FakeImportable extends Importable {
  public importable = jest.fn(async (dto: Record<string, any>) => dto);
}

class SkippingImportable extends FakeImportable {
  public getSkippedRows = jest.fn(
    async (): Promise<ImportRowSkip[]> => [
      { index: 1, errorCode: 'DuplicateBankTransaction', errorMessage: 'm' },
    ],
  );
}

const makeService = (importable: Importable) => {
  const validator = { validateData: jest.fn(async () => undefined) };
  const resource = { getResourceFields2: jest.fn(async () => ({})) };
  const registry = { getImportable: jest.fn(async () => importable) };

  return new ImportFileCommon(
    validator as any,
    resource as any,
    registry as any,
  );
};

const importFile = {
  resource: 'UncategorizedBankTransaction',
} as ImportModelShape;
const rows = [{ amount: 1 }, { amount: 2 }, { amount: 3 }];

describe('ImportFileCommon.import', () => {
  it('imports every row when the importable skips none', async () => {
    const importable = new FakeImportable();
    const service = makeService(importable);

    const [success, failed] = await service.import(importFile, rows);

    expect(success).toHaveLength(3);
    expect(failed).toHaveLength(0);
    expect(importable.importable).toHaveBeenCalledTimes(3);
  });

  it('reports pre-skipped rows as skipped without importing them', async () => {
    const importable = new SkippingImportable();
    const service = makeService(importable);

    const [success, failed] = await service.import(importFile, rows);

    const importedDTOs = importable.importable.mock.calls.map(
      (call) => call[0],
    );
    expect(importedDTOs).toEqual([{ amount: 1 }, { amount: 3 }]);
    expect(success).toHaveLength(2);
    expect(failed).toEqual([
      {
        index: 1,
        skipped: true,
        error: [
          {
            errorCode: 'DuplicateBankTransaction',
            errorMessage: 'm',
            rowNumber: 2,
            uniqueValue: '',
          },
        ],
      },
    ]);
    expect(importable.getSkippedRows).toHaveBeenCalledTimes(1);
    expect(importable.getSkippedRows).toHaveBeenCalledWith(rows, importFile);
  });

  it('imports the rows prepareRows returns and checks those rows for skips', async () => {
    const importable = new SkippingImportable();
    importable.getSkippedRows.mockResolvedValue([]);
    const prepared = rows.map((row) => ({ amount: row.amount * 10 }));
    importable.prepareRows = jest.fn(async () => ({
      rows: prepared,
      rowErrors: [],
    }));
    const service = makeService(importable);

    await service.import(importFile, rows);

    const importedDTOs = importable.importable.mock.calls.map(
      (call) => call[0],
    );
    expect(importedDTOs).toEqual([
      { amount: 10 },
      { amount: 20 },
      { amount: 30 },
    ]);
    expect(importable.prepareRows).toHaveBeenCalledWith(rows, importFile);
    expect(importable.getSkippedRows).toHaveBeenCalledWith(
      prepared,
      importFile,
    );
  });

  it('reports prepareRows row errors as errors without importing them', async () => {
    const importable = new SkippingImportable();
    importable.getSkippedRows.mockResolvedValue([
      { index: 0, errorCode: 'DuplicateBankTransaction', errorMessage: 'dup' },
    ]);
    importable.prepareRows = jest.fn(async (parsed: Record<string, any>[]) => ({
      rows: parsed,
      rowErrors: [
        { index: 0, errorCode: 'BankAmountMissing', errorMessage: 'x' },
      ],
    }));
    const service = makeService(importable);

    const [success, failed] = await service.import(importFile, rows);

    const importedDTOs = importable.importable.mock.calls.map(
      (call) => call[0],
    );
    expect(importedDTOs).toEqual([{ amount: 2 }, { amount: 3 }]);
    expect(success).toHaveLength(2);
    expect(failed).toEqual([
      {
        index: 0,
        error: [
          {
            errorCode: 'BankAmountMissing',
            errorMessage: 'x',
            rowNumber: 1,
            uniqueValue: '',
          },
        ],
      },
    ]);
  });
});
