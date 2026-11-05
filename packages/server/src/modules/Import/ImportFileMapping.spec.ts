import * as yup from 'yup';
import { ImportFileMapping } from './ImportFileMapping';
import { ServiceError } from '../Items/ServiceError';

const bankFields = {
  date: { name: 'Date', fieldType: 'date' },
  amount: { name: 'Amount', fieldType: 'number' },
  withdrawal: { name: 'Withdrawal', fieldType: 'number' },
};

const reverseSignsSchema = () =>
  yup.object().shape({ reverseSigns: yup.boolean() }).noUnknown();

interface FakeImportable {
  validateMapping: jest.Mock;
  mappingParamsSchema: () => yup.ObjectSchema<object> | null;
}

const makeService = (
  importable: FakeImportable,
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

  const service = new ImportFileMapping(
    resource as any,
    registry as any,
    importModel as any,
  );
  return { service, patch };
};

const bankImportable = (): FakeImportable => ({
  validateMapping: jest.fn(),
  mappingParamsSchema: reverseSignsSchema,
});

const maps = [
  { from: 'Date', to: 'date' },
  { from: 'Amount', to: 'amount' },
];

describe('ImportFileMapping.mapping', () => {
  it('refuses a mapping the importable rejects, without saving', async () => {
    const importable = {
      ...bankImportable(),
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

  it('merges allowed params into the stored params', async () => {
    const { service, patch } = makeService(bankImportable());

    await service.mapping('f1', maps, { reverseSigns: true });

    expect(patch).toHaveBeenCalledWith({
      mapping: JSON.stringify(maps),
      params: JSON.stringify({ accountId: 1, batch: 'b', reverseSigns: true }),
    });
  });

  it.each([
    ['a key the importable does not allow', { accountId: 99 }],
    ['a reverseSigns that is a string', { reverseSigns: 'false' }],
    ['params that are not an object', 'reverseSigns'],
    ['params that are an array', [true]],
  ])('refuses %s, without saving', async (_label, params) => {
    const { service, patch } = makeService(bankImportable());

    await expect(
      service.mapping('f1', maps, params as any),
    ).rejects.toMatchObject({ errorType: 'INVALID_IMPORT_PARAMS' });
    expect(patch).not.toHaveBeenCalled();
  });

  it('refuses params when the importable takes none at mapping', async () => {
    const { service, patch } = makeService({
      validateMapping: jest.fn(),
      mappingParamsSchema: () => null,
    });

    await expect(
      service.mapping('f1', maps, { reverseSigns: true }),
    ).rejects.toMatchObject({ errorType: 'INVALID_IMPORT_PARAMS' });
    expect(patch).not.toHaveBeenCalled();
  });

  it('leaves params untouched when none are sent', async () => {
    const { service, patch } = makeService(bankImportable());

    await service.mapping('f1', maps);

    expect(patch).toHaveBeenCalledWith({ mapping: JSON.stringify(maps) });
  });
});
