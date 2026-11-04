import { knex, Knex } from 'knex';
import { knexSnakeCaseMappers, QueryBuilder } from 'objection';
import { PaymentReceivedGLEntries } from './PaymentReceivedGLEntries';
import { PaymentReceived } from '../models/PaymentReceived';
import { PaymentReceivedEntry } from '../models/PaymentReceivedEntry';
import { DiscountType } from '@/common/types/Discount';
import { SaleInvoice } from '@/modules/SaleInvoices/models/SaleInvoice';

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
      {} as any,
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

describe('PaymentReceivedGLEntries.getPaymentReceiveCashLedger', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("posts each tax group component on its tax's payable account, loaded in the transaction", async () => {
    const trx = {} as Knex.Transaction;
    // The tax rates with a payable account: TPS (id 1) and TVQ (id 2).
    const taxRateQuery = {
      select: jest.fn().mockReturnThis(),
      whereNotNull: jest.fn().mockResolvedValue([
        { id: 1, payableAccountId: 2101 },
        { id: 2, payableAccountId: 2102 },
      ]),
    };
    const taxRateModel = { query: jest.fn().mockReturnValue(taxRateQuery) };
    const accountRepository = {
      findOrCreateTaxPayable: jest.fn().mockResolvedValue({ id: 200 }),
      findOrCreateDiscountAccount: jest.fn().mockResolvedValue({ id: 300 }),
      findOrCreateOtherChargesAccount: jest.fn().mockResolvedValue({ id: 400 }),
    };
    const service = new PaymentReceivedGLEntries(
      {} as any,
      accountRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      () => taxRateModel as any,
    );
    jest.spyOn(service, 'getInvoicesPaidBefore').mockResolvedValue({});

    // 100 on the TPS + TVQ group (id 9): TPS 5.00, TVQ 9.98, total 114.98.
    const invoice = SaleInvoice.fromJson({
      id: 10,
      exchangeRate: 1,
      balance: 100,
      discount: 0,
      discountType: DiscountType.Amount,
      adjustment: 0,
      isInclusiveTax: false,
      taxAmountWithheld: 14.98,
      entries: [
        {
          index: 1,
          itemId: 1,
          sellAccountId: 500,
          quantity: 1,
          rate: 100,
          discount: 0,
          discountType: DiscountType.Amount,
          taxRateId: 9,
          taxRate: 14.975,
          taxComponents: [
            { taxRateId: 1, rate: 5 },
            { taxRateId: 2, rate: 9.975 },
          ],
          isInclusiveTax: false,
        },
      ],
    });
    const payment = {
      id: 7,
      exchangeRate: 1,
      depositAccountId: 100,
      entries: [{ invoiceId: 10, paymentAmount: 114.98, invoice }],
    } as unknown as PaymentReceived;

    const ledger = await service.getPaymentReceiveCashLedger(payment, trx);

    expect(taxRateModel.query).toHaveBeenCalledWith(trx);
    expect(taxRateQuery.whereNotNull).toHaveBeenCalledWith('payableAccountId');
    expect(
      ledger
        .getEntries()
        .filter((entry) => [200, 2101, 2102].includes(entry.accountId))
        .map(({ credit, accountId, taxRateId }) => [
          credit,
          accountId,
          taxRateId,
        ]),
    ).toEqual([
      [5, 2101, 1],
      [9.98, 2102, 2],
    ]);
  });
});
