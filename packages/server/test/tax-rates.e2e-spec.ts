import request = require('supertest');
import { faker } from '@faker-js/faker';
import { app, AuthorizationHeader, orgainzationId } from './init-app-test';
import {
  authHeaders,
  cancelTransactionsLock,
  createCustomer,
  createServiceItem,
  createTaxRate,
  createVendor,
  getBaseCurrency,
} from './_utils/gl';

const invoiceDTO = (customerId: number, entries: object[]) => ({
  customerId,
  invoiceDate: '2023-01-01',
  dueDate: '2023-02-01',
  invoiceNo: faker.string.uuid(),
  delivered: true,
  branchId: 1,
  warehouseId: 1,
  entries: entries.map((entry, index) => ({
    index: index + 1,
    quantity: 1,
    description: 'Tax rate e2e line',
    ...entry,
  })),
});

const billDTO = (vendorId: number, entries: object[]) => ({
  vendorId,
  billDate: '2023-01-01',
  dueDate: '2023-02-01',
  billNumber: faker.string.uuid(),
  open: true,
  branchId: 1,
  warehouseId: 1,
  entries: entries.map((entry, index) => ({
    index: index + 1,
    quantity: 1,
    description: 'Tax rate e2e line',
    ...entry,
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

const editTaxRate = (id: number, body: object) =>
  request(app.getHttpServer())
    .put(`/tax-rates/${id}`)
    .set(authHeaders())
    .send(body);

const getTaxRate = async (id: number) => {
  const res = await request(app.getHttpServer())
    .get(`/tax-rates/${id}`)
    .set(authHeaders())
    .expect(200);

  return res.body;
};

const taxRateBody = (rate: number) => ({
  name: `Tax ${faker.string.alphanumeric({ length: 6 })}`,
  code: faker.string.uuid(),
  rate,
});

describe('Tax Rates (e2e)', () => {
  let customerId: number;
  let itemId: number;

  beforeAll(async () => {
    await cancelTransactionsLock();

    customerId = await createCustomer(await getBaseCurrency());
    itemId = await createServiceItem();
  });

  it('/tax-rates (POST)', () => {
    return request(app.getHttpServer())
      .post('/tax-rates')
      .set('organization-id', orgainzationId)
      .set('Authorization', AuthorizationHeader)
      .send({
        name: faker.person.fullName(),
        rate: 2,
        code: faker.string.uuid(),
        active: true,
      })
      .expect(201);
  });

  it('/tax-rates/:id (DELETE)', async () => {
    const response = await request(app.getHttpServer())
      .post('/tax-rates')
      .set('organization-id', orgainzationId)
      .set('Authorization', AuthorizationHeader)
      .send({
        name: faker.person.fullName(),
        rate: 2,
        code: faker.string.uuid(),
        active: true,
      });
    const taxRateId = response.body.id;

    return request(app.getHttpServer())
      .delete(`/tax-rates/${taxRateId}`)
      .set('organization-id', orgainzationId)
      .set('Authorization', AuthorizationHeader)
      .expect(200);
  });

  describe('edit', () => {
    it('keeps the id when the name, code and rate change', async () => {
      const taxRateId = await createTaxRate(2);

      const res = await editTaxRate(taxRateId, taxRateBody(3)).expect(200);

      expect(res.body.id).toBe(taxRateId);
      expect(Number((await getTaxRate(taxRateId)).rate)).toBe(3);
    });

    it('edits a rate that an invoice uses', async () => {
      const taxRateId = await createTaxRate(10);
      await createInvoice(
        invoiceDTO(customerId, [{ itemId, rate: 1000, taxRateId }]),
      );

      const res = await editTaxRate(taxRateId, taxRateBody(20)).expect(200);

      expect(res.body.id).toBe(taxRateId);
    });

    it('refuses a code another rate has', async () => {
      const taxRateA = await createTaxRate(5);
      const taxRateB = await createTaxRate(6);
      const { code: codeB } = await getTaxRate(taxRateB);

      const res = await editTaxRate(taxRateA, {
        ...taxRateBody(5),
        code: codeB,
      }).expect(400);

      expect(res.body.errors[0].type).toBe('TAX_CODE_NOT_UNIQUE');
    });

    it('accepts its own code', async () => {
      const taxRateId = await createTaxRate(5);
      const { code } = await getTaxRate(taxRateId);

      await editTaxRate(taxRateId, { ...taxRateBody(5), code }).expect(200);
    });

    it('keeps an inactive rate inactive when active is omitted', async () => {
      const taxRateId = await createTaxRate(5);
      await request(app.getHttpServer())
        .put(`/tax-rates/${taxRateId}/inactivate`)
        .set(authHeaders())
        .expect(200);

      await editTaxRate(taxRateId, taxRateBody(5)).expect(200);

      // The API returns `active` as a tinyint (0/1).
      expect(Boolean((await getTaxRate(taxRateId)).active)).toBe(false);
    });

    it('keeps an active rate active when active is omitted', async () => {
      const taxRateId = await createTaxRate(5);

      await editTaxRate(taxRateId, taxRateBody(5)).expect(200);

      expect(Boolean((await getTaxRate(taxRateId)).active)).toBe(true);
    });
  });

  describe('saved documents', () => {
    const lineTaxRates = (body: any) =>
      body.entries.map((entry: any) => Number(entry.tax_rate));

    it('an invoice keeps its percentage when re-saved after a rate edit', async () => {
      const taxRateA = await createTaxRate(10);
      const taxRateB = await createTaxRate(5);
      const dto = invoiceDTO(customerId, [
        { itemId, rate: 1000, taxRateId: taxRateA },
      ]);
      const invoiceId = await createInvoice(dto);

      await editTaxRate(taxRateA, taxRateBody(20)).expect(200);

      await request(app.getHttpServer())
        .put(`/sale-invoices/${invoiceId}`)
        .set(authHeaders())
        .send(
          invoiceDTO(customerId, [
            { itemId, rate: 1000, taxRateId: taxRateA },
            { itemId, rate: 500, taxRateId: taxRateA },
            { itemId, rate: 200, taxRateId: taxRateB },
          ]),
        )
        .expect(200);

      const saved = await request(app.getHttpServer())
        .get(`/sale-invoices/${invoiceId}`)
        .set(authHeaders())
        .expect(200);

      expect(lineTaxRates(saved.body)).toEqual([10, 10, 5]);
      expect(Number(saved.body.tax_amount_withheld)).toBe(160);

      const newInvoiceId = await createInvoice(
        invoiceDTO(customerId, [{ itemId, rate: 1000, taxRateId: taxRateA }]),
      );
      const newInvoice = await request(app.getHttpServer())
        .get(`/sale-invoices/${newInvoiceId}`)
        .set(authHeaders())
        .expect(200);

      expect(lineTaxRates(newInvoice.body)).toEqual([20]);
      expect(Number(newInvoice.body.tax_amount_withheld)).toBe(200);
    });

    it('a bill keeps its percentage when re-saved after a rate edit', async () => {
      const vendorId = await createVendor(await getBaseCurrency());
      const taxRateA = await createTaxRate(10);
      const created = await request(app.getHttpServer())
        .post('/bills')
        .set(authHeaders())
        .send(billDTO(vendorId, [{ itemId, rate: 1000, taxRateId: taxRateA }]))
        .expect(201);
      const billId = created.body.id;

      await editTaxRate(taxRateA, taxRateBody(20)).expect(200);

      await request(app.getHttpServer())
        .put(`/bills/${billId}`)
        .set(authHeaders())
        .send(
          billDTO(vendorId, [
            { itemId, rate: 1000, taxRateId: taxRateA },
            { itemId, rate: 500, taxRateId: taxRateA },
          ]),
        )
        .expect(200);

      const saved = await request(app.getHttpServer())
        .get(`/bills/${billId}`)
        .set(authHeaders())
        .expect(200);

      expect(lineTaxRates(saved.body)).toEqual([10, 10]);
      expect(Number(saved.body.tax_amount_withheld)).toBe(150);

      const newBill = await request(app.getHttpServer())
        .post('/bills')
        .set(authHeaders())
        .send(billDTO(vendorId, [{ itemId, rate: 1000, taxRateId: taxRateA }]))
        .expect(201);
      const newBillBody = await request(app.getHttpServer())
        .get(`/bills/${newBill.body.id}`)
        .set(authHeaders())
        .expect(200);

      expect(lineTaxRates(newBillBody.body)).toEqual([20]);
    });
  });

  describe('delete', () => {
    const deleteTaxRate = (id: number) =>
      request(app.getHttpServer())
        .delete(`/tax-rates/${id}`)
        .set(authHeaders());

    it('refuses to delete a rate an invoice uses', async () => {
      const taxRateId = await createTaxRate(10);
      await createInvoice(
        invoiceDTO(customerId, [{ itemId, rate: 1000, taxRateId }]),
      );

      const res = await deleteTaxRate(taxRateId).expect(400);

      expect(res.body.errors[0].type).toBe('TAX_RATE_IN_USE');
      await getTaxRate(taxRateId);
    });

    it('refuses to delete a rate that is only an item default', async () => {
      const taxRateId = await createTaxRate(10);
      await request(app.getHttpServer())
        .post('/items')
        .set(authHeaders())
        .send({
          name: `Tax default item ${faker.string.alphanumeric({ length: 8 })}`,
          type: 'service',
          sellable: true,
          purchasable: true,
          sellAccountId: 1026,
          costAccountId: 1019,
          costPrice: 100,
          sellPrice: 100,
          sellTaxRateId: taxRateId,
        })
        .expect(201);

      const res = await deleteTaxRate(taxRateId).expect(400);

      expect(res.body.errors[0].type).toBe('TAX_RATE_IN_USE');
    });
  });
});
