import { knex, Knex } from 'knex';
import { knexSnakeCaseMappers, QueryBuilder } from 'objection';
import { BillPaymentGLEntries } from './BillPaymentGLEntries';
import { BillPayment } from '../models/BillPayment';
import { BillPaymentEntry } from '../models/BillPaymentEntry';
import { DiscountType } from '@/common/types/Discount';
import { Bill } from '@/modules/Bills/models/Bill';

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
      {} as any,
    );

  it('sums the payments of each bill with a lower id, whatever their dates', async () => {
    const payment = {
      id: 7,
      paymentDate: '2026-11-03',
      entries: [{ billId: 20 }, { billId: 21 }],
    } as unknown as BillPayment;

    const paidBefore = await buildService().getBillsPaidBefore(payment);

    expect(paidBefore).toEqual({ 20: 76.66 });
    expect(executed).toHaveLength(1);
    expect(executed[0].sql).toBe(
      'select `BILL_ID`, sum(`PAYMENT_AMOUNT`) as `PAYMENT_AMOUNT`' +
        ' from `BILLS_PAYMENTS_ENTRIES`' +
        ' where `BILL_ID` in (?, ?) and `BILL_PAYMENT_ID` < ?' +
        ' group by `BILL_ID`',
    );
    expect(executed[0].bindings).toEqual([20, 21, 7]);
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

describe('BillPaymentGLEntries.getBillPaymentGLedger', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("debits each tax group component on its tax's payable account, loaded in the transaction", async () => {
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
      findOrCreateAccountsPayable: jest.fn().mockResolvedValue({ id: 50 }),
      findOrCreateTaxPayable: jest.fn().mockResolvedValue({ id: 1 }),
      findOrCreatePurchaseDiscountAccount: jest
        .fn()
        .mockResolvedValue({ id: 2 }),
      findOrCreateOtherExpensesAccount: jest.fn().mockResolvedValue({ id: 3 }),
    };
    // The exchange gain or loss account.
    const accountModel = () => ({
      query: () => ({
        modify: () => ({ first: () => Promise.resolve({ id: 60 }) }),
      }),
    });
    const service = new BillPaymentGLEntries(
      {} as any,
      accountRepository as any,
      {} as any,
      {} as any,
      accountModel as any,
      {} as any,
      () => taxRateModel as any,
    );
    jest.spyOn(service, 'getBillsPaidBefore').mockResolvedValue({});

    // 100 on the TPS + TVQ group (id 9): TPS 5.00, TVQ 9.98, total 114.98.
    const bill = Bill.fromJson({
      id: 20,
      exchangeRate: 1,
      amount: 100,
      discount: 0,
      discountType: DiscountType.Amount,
      adjustment: 0,
      isInclusiveTax: false,
      taxAmountWithheld: 14.98,
      entries: [
        {
          index: 1,
          itemId: 10,
          quantity: 1,
          rate: 100,
          costAccountId: 200,
          discount: 0,
          discountType: DiscountType.Amount,
          taxRateId: 9,
          taxRate: 14.975,
          taxComponents: [
            { taxRateId: 1, rate: 5 },
            { taxRateId: 2, rate: 9.975 },
          ],
          isInclusiveTax: false,
          item: { type: 'service' },
        },
      ],
    });
    const payment = {
      id: 7,
      currencyCode: 'CAD',
      exchangeRate: 1,
      paymentAccountId: 900,
      paymentDate: '2026-11-03',
      entries: [{ billId: 20, paymentAmount: 114.98, bill }],
    } as unknown as BillPayment;

    const ledger = await service.getBillPaymentGLedger(payment, 'CAD', trx);

    expect(taxRateModel.query).toHaveBeenCalledWith(trx);
    expect(taxRateQuery.whereNotNull).toHaveBeenCalledWith('payableAccountId');
    expect(
      ledger
        .getEntries()
        .filter((entry) => [1, 2101, 2102].includes(entry.accountId))
        .map(({ debit, accountId, taxRateId, basis }) => [
          debit,
          accountId,
          taxRateId,
          basis,
        ]),
    ).toEqual([
      [5, 2101, 1, 'cash'],
      [9.98, 2102, 2, 'cash'],
    ]);
  });
});
