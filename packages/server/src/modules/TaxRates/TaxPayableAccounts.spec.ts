import { knex, Knex } from 'knex';
import { knexSnakeCaseMappers, QueryBuilder } from 'objection';
import { TaxRateModel } from './models/TaxRate.model';
import { loadTaxPayableAccountsByRateId } from './TaxPayableAccounts';

describe('loadTaxPayableAccountsByRateId', () => {
  let tenantKnex: Knex;
  let executed: Knex.Sql[];

  beforeEach(() => {
    // Builds the queries as the tenant database does, without connecting.
    tenantKnex = knex({
      client: 'mysql',
      ...knexSnakeCaseMappers({ upperCase: true }),
    });
    executed = [];
    jest.spyOn(QueryBuilder.prototype, 'execute').mockImplementation(function (
      this: QueryBuilder<any>,
    ) {
      executed.push(this.toKnexQuery().toSQL());
      return Promise.resolve([
        { id: 1, payableAccountId: 2101 },
        { id: 2, payableAccountId: 2102 },
      ]);
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await tenantKnex.destroy();
  });

  it('maps each rate with a payable account to that account', async () => {
    const BoundTaxRate = TaxRateModel.bindKnex(tenantKnex);

    const accounts = await loadTaxPayableAccountsByRateId(() => BoundTaxRate);

    expect(accounts).toEqual({ 1: 2101, 2: 2102 });
    expect(executed).toHaveLength(1);
    expect(executed[0].sql).toBe(
      'select `ID`, `PAYABLE_ACCOUNT_ID` from `TAX_RATES`' +
        ' where `PAYABLE_ACCOUNT_ID` is not null',
    );
  });

  it('reads the rates in the given transaction', async () => {
    const BoundTaxRate = TaxRateModel.bindKnex(tenantKnex);
    const query = jest.spyOn(BoundTaxRate, 'query');
    const trx = tenantKnex as unknown as Knex.Transaction;

    await loadTaxPayableAccountsByRateId(() => BoundTaxRate, trx);

    expect(query).toHaveBeenCalledWith(trx);
  });
});
