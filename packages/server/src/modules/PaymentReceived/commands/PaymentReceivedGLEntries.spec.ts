import { knex, Knex } from 'knex';
import { knexSnakeCaseMappers, QueryBuilder } from 'objection';
import { PaymentReceivedGLEntries } from './PaymentReceivedGLEntries';
import { PaymentReceived } from '../models/PaymentReceived';
import { PaymentReceivedEntry } from '../models/PaymentReceivedEntry';

describe('PaymentReceivedGLEntries.getInvoicesPaidBefore', () => {
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
      return Promise.resolve([{ invoiceId: 10, paymentAmount: '76.660' }]);
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await tenantKnex.destroy();
  });

  const buildService = () =>
    new PaymentReceivedGLEntries(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      () => PaymentReceived.bindKnex(tenantKnex),
      () => PaymentReceivedEntry.bindKnex(tenantKnex),
    );

  it('sums the other payments of each invoice dated earlier, or the same date with a lower id', async () => {
    const payment = {
      id: 7,
      paymentDate: '2026-11-03',
      entries: [{ invoiceId: 10 }, { invoiceId: 11 }],
    } as unknown as PaymentReceived;

    const paidBefore = await buildService().getInvoicesPaidBefore(payment);

    expect(paidBefore).toEqual({ 10: 76.66 });
    expect(executed).toHaveLength(1);
    expect(executed[0].sql).toContain(
      'sum(`PAYMENT_RECEIVES_ENTRIES`.`PAYMENT_AMOUNT`) as `PAYMENT_AMOUNT`',
    );
    expect(executed[0].sql).toContain(
      'inner join `PAYMENT_RECEIVES` as `PAYMENT` on `PAYMENT`.`ID` = `PAYMENT_RECEIVES_ENTRIES`.`PAYMENT_RECEIVE_ID`',
    );
    expect(executed[0].sql).toContain(
      'where `PAYMENT_RECEIVES_ENTRIES`.`INVOICE_ID` in (?, ?)' +
        ' and not `PAYMENT`.`ID` = ?' +
        ' and (`PAYMENT`.`PAYMENT_DATE` < ?' +
        ' or (`PAYMENT`.`PAYMENT_DATE` = ? and `PAYMENT`.`ID` < ?))' +
        ' group by `PAYMENT_RECEIVES_ENTRIES`.`INVOICE_ID`',
    );
    expect(executed[0].bindings).toEqual([
      10,
      11,
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
    } as unknown as PaymentReceived;

    const paidBefore = await buildService().getInvoicesPaidBefore(payment);

    expect(paidBefore).toEqual({});
    expect(executed).toHaveLength(0);
  });
});
