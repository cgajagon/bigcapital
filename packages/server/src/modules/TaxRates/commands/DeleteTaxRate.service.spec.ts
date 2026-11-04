import { DeleteTaxRateService } from './DeleteTaxRate.service';

describe('DeleteTaxRateService', () => {
  it('checks whether the rate is in use inside the delete transaction', async () => {
    const trx = { id: 'trx' };
    const calls: string[] = [];
    const validators = {
      validateTaxRateExistance: jest.fn(),
      validateTaxRateNotInUse: jest.fn(async () => {
        calls.push('in-use check');
      }),
    };
    const uow = {
      withTransaction: async (work: (trx: any) => Promise<void>) => {
        calls.push('transaction start');
        await work(trx);
      },
    };
    const deleteQuery = { delete: jest.fn(async () => calls.push('delete')) };
    const taxRateModel = () => ({
      query: () => ({
        findById: (id: number) =>
          id === 5
            ? Object.assign(Promise.resolve({ id: 5 }), deleteQuery)
            : null,
      }),
    });
    const service = new DeleteTaxRateService(
      { emitAsync: jest.fn() } as any,
      uow as any,
      validators as any,
      taxRateModel as any,
    );

    await service.deleteTaxRate(5);

    expect(validators.validateTaxRateNotInUse).toHaveBeenCalledWith(5, trx);
    expect(calls).toEqual(['transaction start', 'in-use check', 'delete']);
  });
});
