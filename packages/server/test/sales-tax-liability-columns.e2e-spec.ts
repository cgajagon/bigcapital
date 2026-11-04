import request = require('supertest');
import { faker } from '@faker-js/faker';
import { app } from './init-app-test';
import {
  authHeaders,
  cancelTransactionsLock,
  createCustomer,
  createServiceItem,
  createTaxRate,
  createVendor,
  getBaseCurrency,
} from './_utils/gl';

/**
 * The sales tax liability summary separates the tax of sales documents (tax on
 * sales) from the tax of purchase documents (tax on purchases), and keeps the
 * net as the tax amount.
 */
describe('Sales tax liability summary columns (e2e)', () => {
  const query = {
    fromDate: '2023-01-01',
    toDate: '2023-01-01',
    basis: 'accrual',
  };
  let taxRateId: number;

  beforeAll(async () => {
    await cancelTransactionsLock();

    const baseCurrency = await getBaseCurrency();
    const customerId = await createCustomer(baseCurrency);
    const vendorId = await createVendor(baseCurrency);
    const itemId = await createServiceItem();
    // A fresh rate, so only this test's documents show on its row.
    taxRateId = await createTaxRate(10);

    await request(app.getHttpServer())
      .post('/sale-invoices')
      .set(authHeaders())
      .send({
        customerId,
        invoiceDate: '2023-01-01',
        dueDate: '2023-02-01',
        invoiceNo: faker.string.uuid(),
        delivered: true,
        branchId: 1,
        warehouseId: 1,
        entries: [{ index: 1, itemId, quantity: 1, rate: 100, taxRateId }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/bills')
      .set(authHeaders())
      .send({
        vendorId,
        billDate: '2023-01-01',
        dueDate: '2023-02-01',
        billNumber: faker.string.alphanumeric(10),
        open: true,
        branchId: 1,
        warehouseId: 1,
        entries: [{ index: 1, itemId, quantity: 1, rate: 40, taxRateId }],
      })
      .expect(201);
  });

  it('splits the tax by document type and keeps the net', async () => {
    const res = await request(app.getHttpServer())
      .get('/reports/sales-tax-liability-summary')
      .query(query)
      .set(authHeaders())
      .expect(200);

    const row = res.body.data.tax_rates.find(
      (taxRate) => taxRate.id === taxRateId,
    );

    expect(row.taxable_amount.amount).toBe(100);
    expect(row.tax_on_sales_amount.amount).toBe(10);
    expect(row.collected_tax_amount.amount).toBe(4);
    expect(row.tax_amount.amount).toBe(6);
  });

  it('labels the columns tax on sales and tax on purchases', async () => {
    const res = await request(app.getHttpServer())
      .get('/reports/sales-tax-liability-summary')
      .query(query)
      .set({ ...authHeaders(), Accept: 'application/json+table' })
      .expect(200);

    const labels = res.body.table.columns.map((column) => column.label);

    expect(labels).toEqual(
      expect.arrayContaining(['Tax on Sales', 'Tax on Purchases']),
    );
    expect(labels).not.toContain('Collected Tax');
  });
});
