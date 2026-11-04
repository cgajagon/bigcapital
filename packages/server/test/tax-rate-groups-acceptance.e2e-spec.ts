import request = require('supertest');
import { faker } from '@faker-js/faker';
import { app } from './init-app-test';
import {
  authHeaders,
  cancelTransactionsLock,
  createCustomer,
  createServiceItem,
  createTaxGroup,
  createTaxPayableAccount,
  createTaxRate,
  createVendor,
  expectBalanced,
  fetchLegs,
  getBaseCurrency,
  legNets,
} from './_utils/gl';

/**
 * Acceptance for tax groups end to end: a TPS 5 % + TVQ 9.975 % group is
 * computed per component, posted to each component's own payable account,
 * reported per component and shown per component, against the real database.
 */
describe('Tax rate groups acceptance (e2e)', () => {
  const REPORT_DATE = '2023-03-15';
  const AR_CODE = '10007';
  const AP_CODE = '20001';

  let customerId: number;
  let vendorId: number;
  let itemId: number;

  beforeAll(async () => {
    await cancelTransactionsLock();

    const baseCurrency = await getBaseCurrency();
    customerId = await createCustomer(baseCurrency);
    vendorId = await createVendor(baseCurrency);
    itemId = await createServiceItem();
  });

  const accountCodeOf = async (accountId: number): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(`/accounts/${accountId}`)
      .set(authHeaders())
      .expect(200);

    return res.body.code;
  };

  // Fresh rates, payable accounts and group per test, so the TVQ edit and the
  // report rows of one test never touch another's, and a retry starts clean.
  const setup = async () => {
    const tpsAccountId = await createTaxPayableAccount();
    const tvqAccountId = await createTaxPayableAccount();
    const tps = await createTaxRate(5, {
      name: `TPS ${faker.string.alphanumeric({ length: 6 })}`,
      payableAccountId: tpsAccountId,
    });
    const tvq = await createTaxRate(9.975, {
      name: `TVQ ${faker.string.alphanumeric({ length: 6 })}`,
      payableAccountId: tvqAccountId,
    });
    const group = await createTaxGroup([tps, tvq], { name: 'TPS+TVQ' });

    return {
      tps,
      tvq,
      group,
      tpsCode: await accountCodeOf(tpsAccountId),
      tvqCode: await accountCodeOf(tvqAccountId),
    };
  };

  const invoiceDTO = (lines: { rate: number; taxRateId: number }[]) => ({
    customerId,
    invoiceDate: REPORT_DATE,
    dueDate: '2023-04-15',
    invoiceNo: faker.string.uuid(),
    delivered: true,
    branchId: 1,
    warehouseId: 1,
    entries: lines.map((line, i) => ({
      index: i + 1,
      itemId,
      quantity: 1,
      ...line,
    })),
  });

  const billDTO = (lines: { rate: number; taxRateId: number }[]) => ({
    vendorId,
    billDate: REPORT_DATE,
    dueDate: '2023-04-15',
    billNumber: faker.string.uuid(),
    open: true,
    branchId: 1,
    warehouseId: 1,
    entries: lines.map((line, i) => ({
      index: i + 1,
      itemId,
      quantity: 1,
      ...line,
    })),
  });

  const createInvoice = async (dto: object): Promise<number> => {
    const res = await request(app.getHttpServer())
      .post('/sale-invoices')
      .set(authHeaders())
      .send(dto)
      .expect(201);

    return res.body.id;
  };

  const createBill = async (dto: object): Promise<number> => {
    const res = await request(app.getHttpServer())
      .post('/bills')
      .set(authHeaders())
      .send(dto)
      .expect(201);

    return res.body.id;
  };

  const getInvoice = async (id: number) => {
    const res = await request(app.getHttpServer())
      .get(`/sale-invoices/${id}`)
      .set(authHeaders())
      .expect(200);

    return res.body;
  };

  const getReportRow = async (taxRateId: number, basis = 'accrual') => {
    const res = await request(app.getHttpServer())
      .get('/reports/sales-tax-liability-summary')
      .set(authHeaders())
      .query({ fromDate: REPORT_DATE, toDate: REPORT_DATE, basis })
      .expect(200);

    return {
      rows: res.body.data.tax_rates as any[],
      row: (res.body.data.tax_rates as any[]).find((r) => r.id === taxRateId),
    };
  };

  const payInvoice = async (invoiceId: number, paymentAmount: number) => {
    const res = await request(app.getHttpServer())
      .post('/payments-received')
      .set(authHeaders())
      .send({
        customerId,
        paymentDate: REPORT_DATE,
        exchangeRate: 1,
        referenceNo: faker.string.uuid(),
        depositAccountId: 1000,
        paymentReceiveNo: faker.string.uuid(),
        entries: [{ index: 1, invoiceId, paymentAmount }],
        branchId: 1,
      })
      .expect(201);

    return res.body.id as number;
  };

  const sum = (nums: number[]) =>
    Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;

  // Sorted so the assertions do not depend on the posting order.
  const sorted = (nums: number[]) => [...nums].sort((a, b) => a - b);

  // The snapshot's component rates, whatever the key casing on the wire.
  const componentRates = (entry: any): Record<number, number> =>
    Object.fromEntries(
      (entry.tax_components as any[]).map((c) => [
        c.tax_rate_id ?? c.taxRateId,
        Number(c.rate),
      ]),
    );

  it('posts an invoice of 37.50 and -4.50 to each component payable account', async () => {
    const { tps, tvq, group, tpsCode, tvqCode } = await setup();
    const invoiceId = await createInvoice(
      invoiceDTO([
        { rate: 37.5, taxRateId: group },
        { rate: -4.5, taxRateId: group },
      ]),
    );

    const legs = await fetchLegs('SaleInvoice', invoiceId);

    expectBalanced(legs);
    expect(legNets(legs, AR_CODE)).toEqual([37.94]);
    expect(sorted(legNets(legs, tpsCode))).toEqual([-1.88, 0.23]);
    expect(sorted(legNets(legs, tvqCode))).toEqual([-3.74, 0.45]);

    const invoice = await getInvoice(invoiceId);

    expect(invoice.taxes).toHaveLength(2);
    expect(invoice.taxes[0]).toMatchObject({
      tax_rate_id: tps,
      tax_rate: 5,
      tax_rate_amount: 1.65,
    });
    expect(invoice.taxes[1]).toMatchObject({
      tax_rate_id: tvq,
      tax_rate: 9.975,
      tax_rate_amount: 3.29,
    });
    expect(Number(invoice.tax_amount_withheld)).toBe(4.94);
    expect(Number(invoice.total)).toBe(37.94);
  });

  it('locks the used component: it is used and its payable account cannot change', async () => {
    const { tps, group } = await setup();
    await createInvoice(invoiceDTO([{ rate: 37.5, taxRateId: group }]));

    const tpsRate = await request(app.getHttpServer())
      .get(`/tax-rates/${tps}`)
      .set(authHeaders())
      .expect(200);

    expect(tpsRate.body.is_used).toBe(true);

    const otherAccountId = await createTaxPayableAccount();
    const res = await request(app.getHttpServer())
      .put(`/tax-rates/${tps}`)
      .set(authHeaders())
      .send({
        name: tpsRate.body.name,
        code: faker.string.uuid(),
        rate: 5,
        payableAccountId: otherAccountId,
      })
      .expect(400);

    expect(res.body.errors[0].type).toBe('TAX_RATE_PAYABLE_ACCOUNT_LOCKED');
  });

  it('splits the debits of a bill with the same lines the same way', async () => {
    const { tpsCode, tvqCode, group } = await setup();
    const billId = await createBill(
      billDTO([
        { rate: 37.5, taxRateId: group },
        { rate: -4.5, taxRateId: group },
      ]),
    );

    const legs = await fetchLegs('Bill', billId);

    expectBalanced(legs);
    expect(sorted(legNets(legs, tpsCode))).toEqual([-0.23, 1.88]);
    expect(sorted(legNets(legs, tvqCode))).toEqual([-0.45, 3.74]);
    expect(legNets(legs, AP_CODE)).toEqual([-37.94]);
  });

  it('reports each component on its own row and never the group', async () => {
    const { tps, tvq, group } = await setup();
    const lines = [
      { rate: 37.5, taxRateId: group },
      { rate: -4.5, taxRateId: group },
    ];
    await createInvoice(invoiceDTO(lines));
    await createBill(billDTO(lines));

    const { rows, row: tpsRow } = await getReportRow(tps);
    const { row: tvqRow } = await getReportRow(tvq);

    expect(tpsRow.taxable_amount.amount).toBe(33);
    expect(tpsRow.tax_on_sales_amount.amount).toBe(1.65);
    expect(tpsRow.collected_tax_amount.amount).toBe(1.65);
    expect(tpsRow.tax_amount.amount).toBe(0);

    expect(tvqRow.taxable_amount.amount).toBe(33);
    expect(tvqRow.tax_on_sales_amount.amount).toBe(3.29);
    expect(tvqRow.collected_tax_amount.amount).toBe(3.29);
    expect(tvqRow.tax_amount.amount).toBe(0);

    expect(rows.find((r) => r.id === group)).toBeUndefined();
  });

  it('pays a group invoice in two parts on the cash basis', async () => {
    const { tpsCode, tvqCode, group } = await setup();
    const invoiceId = await createInvoice(
      invoiceDTO([
        { rate: 37.5, taxRateId: group },
        { rate: -4.5, taxRateId: group },
      ]),
    );

    // The brief's split is 12.00 then 25.94, but the payment validator compares
    // the due amount as a float (37.94 - 12 = 25.939999999999998 < 25.94) and
    // refuses the second payment; 12.01 then 25.93 pays the same 37.94.
    const first = await payInvoice(invoiceId, 12.01);
    const second = await payInvoice(invoiceId, 25.93);

    const firstLegs = await fetchLegs('PaymentReceive', first, 'cash');
    const secondLegs = await fetchLegs('PaymentReceive', second, 'cash');

    expectBalanced(firstLegs);
    expectBalanced(secondLegs);

    const paidTps = sum([
      ...legNets(firstLegs, tpsCode),
      ...legNets(secondLegs, tpsCode),
    ]);
    const paidTvq = sum([
      ...legNets(firstLegs, tvqCode),
      ...legNets(secondLegs, tvqCode),
    ]);

    expect(paidTps).toBe(-1.65);
    expect(paidTvq).toBe(-3.29);
  });

  it('keeps the TVQ rate on saved group lines after TVQ goes to 10 %', async () => {
    const { tvq, group } = await setup();
    const dto = invoiceDTO([
      { rate: 37.5, taxRateId: group },
      { rate: -4.5, taxRateId: group },
    ]);
    const invoiceId = await createInvoice(dto);

    const tvqRate = await request(app.getHttpServer())
      .get(`/tax-rates/${tvq}`)
      .set(authHeaders())
      .expect(200);

    await request(app.getHttpServer())
      .put(`/tax-rates/${tvq}`)
      .set(authHeaders())
      .send({ name: tvqRate.body.name, code: tvqRate.body.code, rate: 10 })
      .expect(200);

    // Re-save the first invoice, adding a group line.
    await request(app.getHttpServer())
      .put(`/sale-invoices/${invoiceId}`)
      .set(authHeaders())
      .send({
        ...invoiceDTO([
          { rate: 37.5, taxRateId: group },
          { rate: -4.5, taxRateId: group },
          { rate: 10, taxRateId: group },
        ]),
        invoiceNo: dto.invoiceNo,
      })
      .expect(200);

    const saved = await getInvoice(invoiceId);

    expect(saved.entries).toHaveLength(3);
    saved.entries.forEach((entry: any) => {
      expect(componentRates(entry)[tvq]).toBe(9.975);
      expect(Number(entry.tax_rate)).toBe(14.975);
    });

    const newInvoiceId = await createInvoice(
      invoiceDTO([{ rate: 100, taxRateId: group }]),
    );
    const created = await getInvoice(newInvoiceId);

    expect(componentRates(created.entries[0])[tvq]).toBe(10);
    expect(Number(created.entries[0].tax_rate)).toBe(15);
  });

  it('sums a plain TPS line and a group line into one TPS and one TVQ', async () => {
    const { tps, tvq, group } = await setup();
    const invoiceId = await createInvoice(
      invoiceDTO([
        { rate: 10, taxRateId: tps },
        { rate: 37.5, taxRateId: group },
      ]),
    );

    const invoice = await getInvoice(invoiceId);

    expect(invoice.taxes).toHaveLength(2);
    expect(invoice.taxes[0]).toMatchObject({
      tax_rate_id: tps,
      tax_rate_amount: 2.38,
    });
    expect(invoice.taxes[1]).toMatchObject({
      tax_rate_id: tvq,
      tax_rate_amount: 3.74,
    });

    const { row } = await getReportRow(tps);

    expect(row.taxable_amount.amount).toBe(47.5);
    expect(row.tax_on_sales_amount.amount).toBe(2.38);
  });
});
