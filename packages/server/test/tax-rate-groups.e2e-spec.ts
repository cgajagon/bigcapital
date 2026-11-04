import request = require('supertest');
import { faker } from '@faker-js/faker';
import { app } from './init-app-test';
import {
  authHeaders,
  cancelTransactionsLock,
  createAccount,
  createCustomer,
  createServiceItem,
  createTaxGroup,
  createTaxPayableAccount,
  createTaxRate,
  getBaseCurrency,
} from './_utils/gl';

const uniqueName = (prefix: string) =>
  `${prefix} ${faker.string.alphanumeric({ length: 6 })}`;

const plainBody = (rate: number, extra: object = {}) => ({
  name: uniqueName('Tax'),
  code: faker.string.uuid(),
  rate,
  ...extra,
});

const groupBody = (componentIds: number[], extra: object = {}) => ({
  name: uniqueName('Group'),
  code: faker.string.uuid(),
  isGroup: true,
  componentIds,
  ...extra,
});

const postTaxRate = (body: object) =>
  request(app.getHttpServer()).post('/tax-rates').set(authHeaders()).send(body);

const editTaxRate = (id: number, body: object) =>
  request(app.getHttpServer())
    .put(`/tax-rates/${id}`)
    .set(authHeaders())
    .send(body);

const deleteTaxRate = (id: number) =>
  request(app.getHttpServer()).delete(`/tax-rates/${id}`).set(authHeaders());

const getTaxRate = async (id: number) => {
  const res = await request(app.getHttpServer())
    .get(`/tax-rates/${id}`)
    .set(authHeaders())
    .expect(200);

  return res.body;
};

const getTaxRates = async () => {
  const res = await request(app.getHttpServer())
    .get('/tax-rates')
    .set(authHeaders())
    .expect(200);

  return res.body;
};

const componentIdsOf = (taxRate: any) =>
  taxRate.components.map((component: any) => component.id);

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
    description: 'Tax group e2e line',
    ...entry,
  })),
});

describe('Tax rate groups (e2e)', () => {
  let customerId: number;
  let itemId: number;

  beforeAll(async () => {
    await cancelTransactionsLock();

    customerId = await createCustomer(await getBaseCurrency());
    itemId = await createServiceItem();
  });

  const createInvoiceOn = (taxRateId: number) =>
    request(app.getHttpServer())
      .post('/sale-invoices')
      .set(authHeaders())
      .send(invoiceDTO(customerId, [{ itemId, rate: 1000, taxRateId }]))
      .expect(201);

  // Fresh TPS 5 % and TVQ 9.975 % per test, so a retried test never reuses
  // rates an earlier attempt already grouped or used.
  const createTpsTvq = async (): Promise<[number, number]> => [
    await createTaxRate(5, { name: uniqueName('TPS') }),
    await createTaxRate(9.975, { name: uniqueName('TVQ') }),
  ];

  describe('create', () => {
    it("creates a group whose rate is its components' sum, in the given order", async () => {
      const [tps, tvq] = await createTpsTvq();

      // A rate sent with a group is ignored: the server sums the components.
      const res = await postTaxRate(groupBody([tps, tvq], { rate: 1 })).expect(
        201,
      );

      // The create response has the get endpoint's shape.
      expect(res.body.rate).toBe(14.975);
      expect(res.body.is_group).toBe(true);
      expect(res.body.is_used).toBe(false);
      expect(res.body.payable_account_id).toBeNull();
      expect(res.body.name_formatted.endsWith('[14.975%]')).toBe(true);
      expect(res.body.rate_formatted).toBe('14.975%');
      expect(res.body.components).toEqual([
        {
          id: tps,
          name: expect.stringMatching(/^TPS /),
          code: expect.any(String),
          rate: 5,
        },
        {
          id: tvq,
          name: expect.stringMatching(/^TVQ /),
          code: expect.any(String),
          rate: 9.975,
        },
      ]);

      const group = await getTaxRate(res.body.id);

      expect(group.is_group).toBe(true);
      expect(group).toEqual(res.body);
    });

    it('creates a rate with a tax payable account', async () => {
      const accountId = await createTaxPayableAccount();
      const tps = await createTaxRate(5, { payableAccountId: accountId });

      const created = await getTaxRate(tps);

      expect(created.payable_account_id).toBe(accountId);
      expect(created.is_group).toBe(false);

      // An edit that omits the payable account keeps it.
      await editTaxRate(tps, plainBody(5)).expect(200);

      expect((await getTaxRate(tps)).payable_account_id).toBe(accountId);
    });

    describe('refuses', () => {
      it('a group of one component', async () => {
        const [tps] = await createTpsTvq();

        const res = await postTaxRate(groupBody([tps])).expect(400);

        expect(res.body.errors[0].type).toBe('TAX_GROUP_COMPONENTS_INVALID');
      });

      it('a duplicate component', async () => {
        const [tps, tvq] = await createTpsTvq();

        const res = await postTaxRate(groupBody([tps, tvq, tps])).expect(400);

        expect(res.body.errors[0].type).toBe('TAX_GROUP_COMPONENTS_INVALID');
      });

      it('component ids on a plain rate', async () => {
        const [tps, tvq] = await createTpsTvq();

        const res = await postTaxRate(
          plainBody(5, { componentIds: [tps, tvq] }),
        ).expect(400);

        expect(res.body.errors[0].type).toBe('TAX_GROUP_COMPONENTS_INVALID');
      });

      it('a group as a component', async () => {
        const [tps, tvq] = await createTpsTvq();
        const groupId = await createTaxGroup([tps, tvq]);

        const res = await postTaxRate(groupBody([groupId, tps])).expect(400);

        expect(res.body.errors[0].type).toBe('TAX_GROUP_COMPONENT_IS_GROUP');
      });

      it('an inactive component', async () => {
        const tps = await createTaxRate(5, { name: uniqueName('TPS') });
        const tvq = await createTaxRate(9.975, {
          name: uniqueName('TVQ'),
          active: false,
        });

        const res = await postTaxRate(groupBody([tps, tvq])).expect(400);

        expect(res.body.errors[0].type).toBe('TAX_GROUP_COMPONENT_INACTIVE');
      });

      it('an income account as the payable account', async () => {
        const incomeAccountId = await createAccount('income');

        const res = await postTaxRate(
          plainBody(5, { payableAccountId: incomeAccountId }),
        ).expect(400);

        expect(res.body.errors[0].type).toBe('TAX_PAYABLE_ACCOUNT_INVALID');
      });

      it('a payable account on a group', async () => {
        const [tps, tvq] = await createTpsTvq();
        const accountId = await createTaxPayableAccount();

        const res = await postTaxRate(
          groupBody([tps, tvq], { payableAccountId: accountId }),
        ).expect(400);

        expect(res.body.errors[0].type).toBe('TAX_PAYABLE_ACCOUNT_INVALID');
      });
    });
  });

  describe('edit', () => {
    it('reorders the components of an unused group', async () => {
      const [tps, tvq] = await createTpsTvq();
      const groupId = await createTaxGroup([tps, tvq]);

      const res = await editTaxRate(groupId, groupBody([tvq, tps])).expect(200);

      // The edit response has the get endpoint's shape.
      expect(res.body.rate).toBe(14.975);
      expect(res.body.is_group).toBe(true);
      expect(res.body.is_used).toBe(false);
      expect(res.body.components).toEqual([
        {
          id: tvq,
          name: expect.stringMatching(/^TVQ /),
          code: expect.any(String),
          rate: 9.975,
        },
        {
          id: tps,
          name: expect.stringMatching(/^TPS /),
          code: expect.any(String),
          rate: 5,
        },
      ]);
      expect(await getTaxRate(groupId)).toEqual(res.body);
    });

    it("recomputes a group's rate when a component's rate changes", async () => {
      const [tps, tvq] = await createTpsTvq();
      const groupId = await createTaxGroup([tps, tvq]);

      await editTaxRate(tvq, plainBody(10)).expect(200);

      expect((await getTaxRate(groupId)).rate).toBe(15);
    });

    it('refuses to change the components of a group an invoice uses', async () => {
      const [tps, tvq] = await createTpsTvq();
      const groupId = await createTaxGroup([tps, tvq]);
      await createInvoiceOn(groupId);

      const res = await editTaxRate(groupId, groupBody([tvq, tps])).expect(400);

      expect(res.body.errors[0].type).toBe('TAX_GROUP_COMPONENTS_LOCKED');

      // The same components, in the same order, are still accepted.
      await editTaxRate(groupId, groupBody([tps, tvq])).expect(200);
    });

    it('refuses to change the payable account of a rate an invoice line uses', async () => {
      const tps = await createTaxRate(5, { name: uniqueName('TPS') });
      const accountA = await createTaxPayableAccount();
      const accountB = await createTaxPayableAccount();

      // Unused, the payable account can still change.
      await editTaxRate(
        tps,
        plainBody(5, { payableAccountId: accountA }),
      ).expect(200);
      await createInvoiceOn(tps);

      const res = await editTaxRate(
        tps,
        plainBody(5, { payableAccountId: accountB }),
      ).expect(400);

      expect(res.body.errors[0].type).toBe('TAX_RATE_PAYABLE_ACCOUNT_LOCKED');
      expect((await getTaxRate(tps)).payable_account_id).toBe(accountA);

      // Sending the account it already has isn't a change.
      await editTaxRate(
        tps,
        plainBody(5, { payableAccountId: accountA }),
      ).expect(200);
    });

    it('refuses to set a payable account on a group', async () => {
      const [tps, tvq] = await createTpsTvq();
      const groupId = await createTaxGroup([tps, tvq]);
      const accountId = await createTaxPayableAccount();

      const res = await editTaxRate(
        groupId,
        groupBody([tps, tvq], { payableAccountId: accountId }),
      ).expect(400);

      expect(res.body.errors[0].type).toBe('TAX_PAYABLE_ACCOUNT_INVALID');
      expect((await getTaxRate(groupId)).payable_account_id).toBeNull();

      // Omitted or null is fine.
      await editTaxRate(groupId, groupBody([tps, tvq])).expect(200);
      await editTaxRate(
        groupId,
        groupBody([tps, tvq], { payableAccountId: null }),
      ).expect(200);
    });

    it('clears the payable account of an unused plain rate', async () => {
      const accountId = await createTaxPayableAccount();
      const tps = await createTaxRate(5, {
        name: uniqueName('TPS'),
        payableAccountId: accountId,
      });
      expect((await getTaxRate(tps)).payable_account_id).toBe(accountId);

      await editTaxRate(tps, plainBody(5, { payableAccountId: null })).expect(
        200,
      );

      expect((await getTaxRate(tps)).payable_account_id).toBeNull();
    });

    it('refuses to turn a group into a plain rate', async () => {
      const [tps, tvq] = await createTpsTvq();
      const groupId = await createTaxGroup([tps, tvq]);

      const res = await editTaxRate(
        groupId,
        plainBody(14.975, { isGroup: false }),
      ).expect(400);

      expect(res.body.errors[0].type).toBe('TAX_RATE_TYPE_LOCKED');
    });

    it('refuses to turn a plain rate into a group', async () => {
      const [tps, tvq] = await createTpsTvq();
      const plainRateId = await createTaxRate(7);

      const res = await editTaxRate(plainRateId, groupBody([tps, tvq])).expect(
        400,
      );

      expect(res.body.errors[0].type).toBe('TAX_RATE_TYPE_LOCKED');
    });
  });

  describe('delete', () => {
    it('refuses to delete a rate that is a component of a group', async () => {
      const [tps, tvq] = await createTpsTvq();
      await createTaxGroup([tps, tvq]);

      const res = await deleteTaxRate(tps).expect(400);

      expect(res.body.errors[0].type).toBe('TAX_RATE_IS_GROUP_COMPONENT');
      await getTaxRate(tps);
    });

    it('deletes an unused group and keeps its components', async () => {
      const [tps, tvq] = await createTpsTvq();
      const groupId = await createTaxGroup([tps, tvq]);

      await deleteTaxRate(groupId).expect(200);

      await getTaxRate(tps);
      await getTaxRate(tvq);

      // TPS is no longer anyone's component, so it can now be deleted.
      await deleteTaxRate(tps).expect(200);
    });
  });

  describe('is_used', () => {
    it('is false before an invoice uses the group and true after', async () => {
      const [tps, tvq] = await createTpsTvq();
      const groupId = await createTaxGroup([tps, tvq]);

      expect((await getTaxRate(groupId)).is_used).toBe(false);

      await createInvoiceOn(groupId);

      expect((await getTaxRate(groupId)).is_used).toBe(true);

      const listed = (await getTaxRates()).find(
        (taxRate: any) => taxRate.id === groupId,
      );

      expect(listed.is_used).toBe(true);
      expect(componentIdsOf(listed)).toEqual([tps, tvq]);
    });
  });
});
