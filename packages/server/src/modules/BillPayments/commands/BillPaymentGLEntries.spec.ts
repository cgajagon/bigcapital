import { knex, Knex } from 'knex';
import { knexSnakeCaseMappers, QueryBuilder } from 'objection';
import { BillPaymentGLEntries } from './BillPaymentGLEntries';
import { BillPayment } from '../models/BillPayment';
import { BillPaymentEntry } from '../models/BillPaymentEntry';

describe('BillPaymentGLEntries.getBillsPaidBefore', () => {
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
      // A decimal sum may come back as a string, depending on the driver.
      return Promise.resolve([{ billId: 20, paymentAmount: '76.660' }]);
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await tenantKnex.destroy();
  });

  const buildService = () =>
    new BillPaymentGLEntries(
      {} as any,
      {} as any,
      {} as any,
      () => BillPayment.bindKnex(tenantKnex),
      {} as any,
      () => BillPaymentEntry.bindKnex(tenantKnex),
    );

  it('sums the other payments of each bill dated earlier, or the same date with a lower id', async () => {
    const payment = {
      id: 7,
      paymentDate: '2026-11-03',
      entries: [{ billId: 20 }, { billId: 21 }],
    } as unknown as BillPayment;

    const paidBefore = await buildService().getBillsPaidBefore(payment);

    expect(paidBefore).toEqual({ 20: 76.66 });
    expect(executed).toHaveLength(1);
    expect(executed[0].sql).toContain(
      'sum(`BILLS_PAYMENTS_ENTRIES`.`PAYMENT_AMOUNT`) as `PAYMENT_AMOUNT`',
    );
    expect(executed[0].sql).toContain(
      'inner join `BILLS_PAYMENTS` as `PAYMENT` on `PAYMENT`.`ID` = `BILLS_PAYMENTS_ENTRIES`.`BILL_PAYMENT_ID`',
    );
    expect(executed[0].sql).toContain(
      'where `BILLS_PAYMENTS_ENTRIES`.`BILL_ID` in (?, ?)' +
        ' and not `PAYMENT`.`ID` = ?' +
        ' and (`PAYMENT`.`PAYMENT_DATE` < ?' +
        ' or (`PAYMENT`.`PAYMENT_DATE` = ? and `PAYMENT`.`ID` < ?))' +
        ' group by `BILLS_PAYMENTS_ENTRIES`.`BILL_ID`',
    );
    expect(executed[0].bindings).toEqual([
      20,
      21,
      7,
      '2026-11-03',
      '2026-11-03',
      7,
    ]);
  });

  it('runs no query for a payment without entries', async () => {
    const payment = {
      id: 7,
      paymentDate: '2026-11-03',
      entries: [],
    } as unknown as BillPayment;

    const paidBefore = await buildService().getBillsPaidBefore(payment);

    expect(paidBefore).toEqual({});
    expect(executed).toHaveLength(0);
  });
});
