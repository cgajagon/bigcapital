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

  it('sums the payments of each invoice with a lower id, whatever their dates', async () => {
    const payment = {
      id: 7,
      paymentDate: '2026-11-03',
      entries: [{ invoiceId: 10 }, { invoiceId: 11 }],
    } as unknown as PaymentReceived;

    const paidBefore = await buildService().getInvoicesPaidBefore(payment);

    expect(paidBefore).toEqual({ 10: 76.66 });
    expect(executed).toHaveLength(1);
    expect(executed[0].sql).toBe(
      'select `INVOICE_ID`, sum(`PAYMENT_AMOUNT`) as `PAYMENT_AMOUNT`' +
        ' from `PAYMENT_RECEIVES_ENTRIES`' +
        ' where `INVOICE_ID` in (?, ?) and `PAYMENT_RECEIVE_ID` < ?' +
        ' group by `INVOICE_ID`',
    );
    expect(executed[0].bindings).toEqual([10, 11, 7]);
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
