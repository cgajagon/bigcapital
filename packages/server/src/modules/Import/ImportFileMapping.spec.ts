import { ImportFileMapping } from './ImportFileMapping';
import { ServiceError } from '../Items/ServiceError';

const bankFields = {
  date: { name: 'Date', fieldType: 'date' },
  amount: { name: 'Amount', fieldType: 'number' },
  withdrawal: { name: 'Withdrawal', fieldType: 'number' },
};

const makeService = (
  importable: { validateMapping: jest.Mock },
  storedParams = { accountId: 1, batch: 'b' },
) => {
  const importFile = {
    id: 7,
    importId: 'f1',
    resource: 'UncategorizedBankTransaction',
    columnsParsed: ['Date', 'Amount', 'Withdrawals'],
    params: JSON.stringify(storedParams),
    paramsParsed: storedParams,
  };
  const patch = jest.fn(async () => 1);
  const importModel = {
    query: () => ({
      findOne: () => ({ throwIfNotFound: async () => importFile }),
      findById: () => ({ patch }),
    }),
  };
  const resource = {
    getResourceFields2: jest.fn(async () => bankFields),
    getResourceImportableFields: jest.fn(() => bankFields),
  };
  const registry = { getImportable: jest.fn(async () => importable) };
  const importFileCommon = { validateParamsSchema: jest.fn(async () => {}) };

  const service = new ImportFileMapping(
    resource as any,
    registry as any,
    importFileCommon as any,
    importModel as any,
  );
  return { service, patch, importFileCommon };
};

const maps = [
  { from: 'Date', to: 'date' },
  { from: 'Amount', to: 'amount' },
];

describe('ImportFileMapping.mapping', () => {
  it('refuses a mapping the importable rejects, without saving', async () => {
    const importable = {
      validateMapping: jest.fn(() => {
        throw new ServiceError('IMPORT_AMOUNT_MAPPING_CONFLICT');
      }),
    };
    const { service, patch } = makeService(importable);

    await expect(service.mapping('f1', maps)).rejects.toMatchObject({
      errorType: 'IMPORT_AMOUNT_MAPPING_CONFLICT',
    });
    expect(importable.validateMapping).toHaveBeenCalledWith(maps);
    expect(patch).not.toHaveBeenCalled();
  });

  it('merges params into the stored params and validates them', async () => {
    const importable = { validateMapping: jest.fn() };
    const { service, patch, importFileCommon } = makeService(importable);

    await service.mapping('f1', maps, { reverseSigns: true });

    const merged = { accountId: 1, batch: 'b', reverseSigns: true };
    expect(importFileCommon.validateParamsSchema).toHaveBeenCalledWith(
      'UncategorizedBankTransaction',
      merged,
    );
    expect(patch).toHaveBeenCalledWith({
      mapping: JSON.stringify(maps),
      params: JSON.stringify(merged),
    });
  });

  it('leaves params untouched when none are sent', async () => {
    const importable = { validateMapping: jest.fn() };
    const { service, patch, importFileCommon } = makeService(importable);

    await service.mapping('f1', maps);

    expect(importFileCommon.validateParamsSchema).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith({ mapping: JSON.stringify(maps) });
  });
});
