import request = require('supertest');
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { faker } from '@faker-js/faker';
import { knex as createKnex } from 'knex';
import { camelCase, isArray, isPlainObject, mapKeys, mapValues } from 'lodash';
import { app, AuthorizationHeader, orgainzationId } from './init-app-test';
import {
  cancelTransactionsLock,
  createCustomer,
  getBaseCurrency,
} from './_utils/gl';

// main.ts sets the static folder that import uploads are stored in; the test
// app doesn't run main.ts, so point it at a temp folder or every upload fails.
const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-rec-e2e-'));
fs.mkdirSync(path.join(staticDir, 'imports'));
(global as any).__static_dirname = staticDir;

afterAll(() => {
  fs.rmSync(staticDir, { recursive: true, force: true });
});

// Describes build on the state their setup committed; never retry.
jest.retryTimes(0);

// ---------------------------------------------------------------------------
// Shared helpers (reused by the later describes of this file)
// ---------------------------------------------------------------------------

const api = () => request(app.getHttpServer());

const authed = <T extends request.Test>(req: T): T =>
  req
    .set('organization-id', orgainzationId)
    .set('Authorization', AuthorizationHeader) as T;

/**
 * Responses are snake_case on the wire for some endpoints; normalise the keys
 * (deeply) so the assertions don't depend on it.
 */
export const camelDeep = (value: any): any => {
  if (isArray(value)) return value.map(camelDeep);
  if (isPlainObject(value)) {
    return mapValues(
      mapKeys(value, (_v, key) => camelCase(key)),
      camelDeep,
    );
  }
  return value;
};

const uniqueName = (prefix: string) =>
  `${prefix} ${Date.now()}-${faker.string.alphanumeric({ length: 4 })}`;

export const createAccount = async (
  accountType: string,
  prefix = 'Rec e2e',
): Promise<number> => {
  const res = await authed(api().post('/accounts'))
    .send({
      name: uniqueName(prefix),
      accountType,
      code: faker.string.alphanumeric({ length: 6 }).toUpperCase(),
    })
    .expect(201);
  return res.body.id;
};

export const createItem = async (): Promise<number> => {
  const res = await authed(api().post('/items'))
    .send({
      name: uniqueName('Rec e2e item'),
      type: 'service',
      unit: 'piece',
      sellable: true,
      purchasable: true,
      sellAccountId: 1026,
      costAccountId: 1019,
      costPrice: 100,
      sellPrice: 100,
    })
    .expect(201);
  return parseInt(res.body.id, 10);
};

export const createInvoice = async (
  customerId: number,
  itemId: number,
  rate: number,
  date: string,
): Promise<number> => {
  const res = await authed(api().post('/sale-invoices'))
    .send({
      customerId,
      invoiceDate: date,
      dueDate: date,
      invoiceNo: faker.string.uuid(),
      delivered: true,
      branchId: 1,
      warehouseId: 1,
      entries: [{ index: 1, itemId, quantity: 1, rate }],
    })
    .expect(201);
  return res.body.id;
};

export const createPayment = async (
  customerId: number,
  depositAccountId: number,
  invoices: Array<{ invoiceId: number; amount: number }>,
  date: string,
): Promise<number> => {
  const res = await authed(api().post('/payments-received'))
    .send({
      customerId,
      paymentDate: date,
      exchangeRate: 1,
      depositAccountId,
      paymentReceiveNo: faker.string.uuid(),
      entries: invoices.map((inv, i) => ({
        index: i + 1,
        invoiceId: inv.invoiceId,
        paymentAmount: inv.amount,
      })),
      branchId: 1,
    })
    .expect(201);
  return res.body.id;
};

export const createOwnerContribution = async (
  accountId: number,
  amount: number,
  date: string,
): Promise<number> => {
  const res = await authed(api().post('/banking/transactions'))
    .send({
      date,
      transactionNumber: faker.string.alphanumeric(10),
      referenceNo: faker.string.alphanumeric(8),
      transactionType: 'owner_contribution',
      description: 'Rec e2e contribution',
      amount,
      creditAccountId: 1014,
      cashflowAccountId: accountId,
      publish: true,
      branchId: 1,
    })
    .expect(201);
  return res.body.id;
};

/**
 * Transfer out of `fromAccountId` into `toAccountId`.
 */
export const createTransfer = async (
  fromAccountId: number,
  toAccountId: number,
  amount: number,
  date: string,
): Promise<number> => {
  const res = await authed(api().post('/banking/transactions'))
    .send({
      date,
      transactionNumber: faker.string.alphanumeric(10),
      referenceNo: faker.string.alphanumeric(8),
      transactionType: 'transfer_to_account',
      description: 'Rec e2e transfer',
      amount,
      creditAccountId: toAccountId,
      cashflowAccountId: fromAccountId,
      publish: true,
      branchId: 1,
    })
    .expect(201);
  return res.body.id;
};

const MAPPING = [
  { from: 'Date', to: 'date' },
  { from: 'Payee', to: 'payee' },
  { from: 'Description', to: 'description' },
  { from: 'Amount', to: 'amount' },
];

/**
 * Uploads, maps, previews and imports the given CSV into the bank account.
 */
export const importCsv = async (accountId: number, csv: string) => {
  const upload = await authed(api().post('/import/file'))
    .attach('file', Buffer.from(csv), 'bank.csv')
    .field('resource', 'UncategorizedBankTransaction')
    .field('params', JSON.stringify({ accountId }));
  expect(upload.status).toBeLessThan(300);
  const importId = upload.body.import.import_id;

  await authed(api().post(`/import/${importId}/mapping`))
    .send({ mapping: MAPPING })
    .expect((res) => expect(res.status).toBeLessThan(300));

  const preview = await authed(api().get(`/import/${importId}/preview`));
  expect(preview.status).toBe(200);

  const result = await authed(api().post(`/import/${importId}/import`));
  expect(result.status).toBeLessThan(300);

  return { preview: preview.body, result: result.body };
};

/**
 * Stores a bank row -> manual journal match straight in the tenant database.
 */
const linkBankRowToJournal = async (
  uncategorizedTransactionId: number,
  journalId: number,
  amount: number,
) => {
  const db = createKnex({
    client: 'mysql2',
    connection: {
      // The app's mysql driver reaches 'localhost' over IPv4; mysql2 on
      // Node 18 may pick ::1 (another server), so pin IPv4 explicitly.
      host: (
        process.env.TENANT_DB_HOST ||
        process.env.DB_HOST ||
        '127.0.0.1'
      ).replace('localhost', '127.0.0.1'),
      port: Number(process.env.TENANT_DB_PORT || process.env.DB_PORT || 3306),
      user: process.env.TENANT_DB_USER || process.env.DB_USER,
      password: process.env.TENANT_DB_PASSWORD || process.env.DB_PASSWORD,
      database: `${process.env.TENANT_DB_NAME_PERFIX || 'bigcapital_tenant_'}${orgainzationId}`,
    },
  });
  try {
    // Tenant tables are upper-cased by the app's knex mapper.
    await db('MATCHED_BANK_TRANSACTIONS').insert({
      uncategorized_transaction_id: uncategorizedTransactionId,
      reference_type: 'ManualJournal',
      reference_id: journalId,
      amount,
      created_at: new Date(),
      updated_at: new Date(),
    });
  } finally {
    await db.destroy();
  }
};

const getSummary = (accountId: number, statementDate?: string) =>
  authed(
    api()
      .get(`/banking/reconciliations/accounts/${accountId}/summary`)
      .query(statementDate ? { statementDate } : {}),
  );

const getTransactions = (accountId: number, statementDate: string) =>
  authed(
    api()
      .get(`/banking/reconciliations/accounts/${accountId}/transactions`)
      .query({ statementDate }),
  );

// ---------------------------------------------------------------------------

describe('Bank reconciliation (e2e)', () => {
  beforeAll(async () => {
    await cancelTransactionsLock();
  });

  describe('read side', () => {
    const statementDate = '2035-01-31';

    let accountId: number;
    let secondAccountId: number;
    let expenseAccountId: number;
    let contributionId: number;
    let paymentId: number;
    let transferId: number;

    beforeAll(async () => {
      accountId = await createAccount('bank', 'Rec read bank');
      secondAccountId = await createAccount('bank', 'Rec read bank 2');
      expenseAccountId = await createAccount('expense', 'Rec read expense');

      contributionId = await createOwnerContribution(
        accountId,
        1000,
        '2035-01-05',
      );

      const customerId = await createCustomer(await getBaseCurrency());
      const itemId = await createItem();
      const invoiceA = await createInvoice(
        customerId,
        itemId,
        1000,
        '2035-01-10',
      );
      const invoiceB = await createInvoice(
        customerId,
        itemId,
        200,
        '2035-01-10',
      );
      paymentId = await createPayment(
        customerId,
        accountId,
        [
          { invoiceId: invoiceA, amount: 1000 },
          { invoiceId: invoiceB, amount: 200 },
        ],
        '2035-01-12',
      );

      transferId = await createTransfer(
        accountId,
        secondAccountId,
        300,
        '2035-01-15',
      );

      await importCsv(
        accountId,
        [
          'Date,Payee,Description,Amount',
          '2035-01-03,Hydro,Electricity,-120.00',
          '2035-01-04,Client Inc,Deposit,250.00',
        ].join('\n'),
      );
    });

    it('summarises a first reconciliation with nothing reconciled yet', async () => {
      const res = await getSummary(accountId, statementDate).expect(200);
      const body = camelDeep(res.body);

      expect(body.account.id).toBe(accountId);
      expect(body.account.accountType).toBe('bank');
      expect(body.account.accountNormal).toBe('debit');
      expect(body.beginningBalance).toBe(0);
      expect(body.lastReconciliation).toBeNull();
      expect(body.draft).toBeNull();
      expect(body.mismatch).toBeNull();
      expect(body.uncategorizedCount).toBe(2);
    });

    it('omits the uncategorized count when no statement date is given', async () => {
      const res = await getSummary(accountId).expect(200);

      expect(camelDeep(res.body).uncategorizedCount).toBeNull();
    });

    it('lists one row per source transaction with its net amount', async () => {
      const res = await getTransactions(accountId, statementDate).expect(200);
      const body = camelDeep(res.body);
      const rows = body.transactions as any[];

      const payments = rows.filter((r) => r.referenceType === 'PaymentReceive');
      expect(payments).toHaveLength(1);
      expect(Number(payments[0].referenceId)).toBe(Number(paymentId));
      expect(payments[0].amount).toBe(1200);

      const contribution = rows.find(
        (r) =>
          r.referenceType === 'CashflowTransaction' &&
          Number(r.referenceId) === Number(contributionId),
      );
      expect(contribution).toBeDefined();
      expect(contribution.amount).toBe(1000);
      expect(contribution.isFromBankFeed).toBe(false);
      expect(contribution.isAfterStatementDate).toBe(false);
      expect(typeof contribution.transactionType).toBe('string');
      expect(contribution.date).toBeDefined();
      expect(contribution.formattedDate).toBeDefined();
      expect(contribution.formattedAmount).toBeDefined();

      const transfer = rows.find(
        (r) =>
          r.referenceType === 'CashflowTransaction' &&
          Number(r.referenceId) === Number(transferId),
      );
      expect(transfer).toBeDefined();
      expect(transfer.amount).toBe(-300);

      // The uncategorized bank rows are not in the books.
      expect(rows).toHaveLength(3);
      expect(body.selected).toEqual([]);
      expect(body.droppedFromDraftCount).toBe(0);
    });

    it('flags rows dated after the statement date', async () => {
      const res = await getTransactions(accountId, '2035-01-11').expect(200);
      const rows = camelDeep(res.body).transactions as any[];

      const payment = rows.find((r) => r.referenceType === 'PaymentReceive');
      expect(payment.isAfterStatementDate).toBe(true);
      const contribution = rows.find(
        (r) => Number(r.referenceId) === Number(contributionId),
      );
      expect(contribution.isAfterStatementDate).toBe(false);
    });

    it('shows the transfer as +300 on the second account', async () => {
      const res = await getTransactions(secondAccountId, statementDate).expect(
        200,
      );
      const rows = camelDeep(res.body).transactions as any[];

      expect(rows).toHaveLength(1);
      expect(Number(rows[0].referenceId)).toBe(Number(transferId));
      expect(rows[0].amount).toBe(300);
    });

    it('lists no history for an account never reconciled', async () => {
      const res = await authed(
        api().get('/banking/reconciliations').query({ accountId }),
      ).expect(200);

      expect(res.body).toEqual([]);
    });

    it('answers a missing reconciliation with its error code', async () => {
      const res = await authed(api().get('/banking/reconciliations/99999999'));

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(res.body.errors[0].type).toBe('BANK_RECONCILIATION_NOT_FOUND');
    });

    it('refuses an account that cannot be reconciled', async () => {
      const summary = await getSummary(expenseAccountId, statementDate).expect(
        400,
      );
      expect(summary.body.errors[0].type).toBe(
        'BANK_RECONCILIATION_ACCOUNT_NOT_RECONCILABLE',
      );

      const rows = await getTransactions(
        expenseAccountId,
        statementDate,
      ).expect(400);
      expect(rows.body.errors[0].type).toBe(
        'BANK_RECONCILIATION_ACCOUNT_NOT_RECONCILABLE',
      );
    });

    it('rejects a statement date that is not a plain YYYY-MM-DD date', async () => {
      const timestamp = '2035-01-31T23:00:00Z';

      await getSummary(accountId, timestamp).expect(400);
      await getTransactions(accountId, timestamp).expect(400);
      await getTransactions(accountId, '2035-02-30').expect(400);
    });
  });

  describe('bank feed rows', () => {
    const statementDate = '2035-03-31';

    let accountId: number;
    let expenseAccountId: number;
    let journalId: number;
    let manualId: number;

    const uncategorizedRows = async () => {
      const res = await authed(
        api().get(`/banking/uncategorized/accounts/${accountId}`),
      ).expect(200);
      return camelDeep(res.body).data as any[];
    };
    const idByAmount = (rows: any[], amount: number) =>
      rows.find((row) => Math.abs(Number(row.amount)) === amount).id;

    const categorize = (body: Record<string, any>) =>
      authed(api().post('/banking/categorize')).send(body);

    beforeAll(async () => {
      accountId = await createAccount('bank', 'Rec feed bank');
      expenseAccountId = await createAccount('expense', 'Rec feed expense');

      await importCsv(
        accountId,
        [
          'Date,Payee,Description,Amount',
          '2035-03-03,Hydro,Electricity,-50.00',
          '2035-03-04,Client Inc,Deposit,75.00',
          '2035-03-05,Metro,Groceries,-20.00',
          '2035-04-10,Client Inc,Late deposit,30.00',
        ].join(String.fromCharCode(10)),
      );
      const rows = await uncategorizedRows();

      // Categorized row, on or before the statement date.
      await categorize({
        uncategorizedTransactionIds: [idByAmount(rows, 50)],
        date: '2035-03-03',
        creditAccountId: expenseAccountId,
        transactionType: 'other_expense',
        exchangeRate: 1,
      }).expect(201);

      // Categorized row, after the statement date.
      await categorize({
        uncategorizedTransactionIds: [idByAmount(rows, 30)],
        date: '2035-04-10',
        creditAccountId: 1014,
        transactionType: 'owner_contribution',
        exchangeRate: 1,
      }).expect(201);

      // Row matched to a manual journal.
      const journal = await authed(api().post('/manual-journals'))
        .send({
          date: '2035-03-04',
          reference: faker.string.uuid(),
          journalNumber: faker.string.uuid(),
          publish: true,
          entries: [
            { index: 1, credit: 0, debit: 75, accountId },
            { index: 2, credit: 75, debit: 0, accountId: 1014 },
          ],
        })
        .expect(201);
      journalId = journal.body.id;
      // POST /banking/matching/match can't match a balanced manual journal
      // (it totals debit minus credit over the journal, which is always 0),
      // so store the link the matching command would: the journal's
      // 'ManualJournal' reference type on the bank row.
      await linkBankRowToJournal(idByAmount(rows, 75), journalId, 75);

      // A manual transaction on the same account.
      manualId = await createOwnerContribution(accountId, 40, '2035-03-06');
    });

    it('flags categorized and matched rows as bank feed and pre-ticks them', async () => {
      const res = await getTransactions(accountId, statementDate).expect(200);
      const body = camelDeep(res.body);
      const rows = body.transactions as any[];
      const isSelected = (ref: any) =>
        body.selected.some(
          (s: any) =>
            s.referenceType === ref.referenceType &&
            Number(s.referenceId) === Number(ref.referenceId),
        );

      const journalRow = rows.find(
        (r) =>
          r.referenceType === 'Journal' &&
          Number(r.referenceId) === Number(journalId),
      );
      expect(journalRow).toBeDefined();
      expect(journalRow.amount).toBe(75);
      expect(journalRow.isFromBankFeed).toBe(true);
      expect(isSelected(journalRow)).toBe(true);

      const expenseRow = rows.find((r) => r.amount === -50);
      expect(expenseRow).toBeDefined();
      expect(expenseRow.isFromBankFeed).toBe(true);
      expect(isSelected(expenseRow)).toBe(true);

      const manualRow = rows.find(
        (r) => Number(r.referenceId) === Number(manualId) && r.amount === 40,
      );
      expect(manualRow).toBeDefined();
      expect(manualRow.isFromBankFeed).toBe(false);
      expect(isSelected(manualRow)).toBe(false);

      expect(body.selected).toHaveLength(2);
    });

    it('does not pre-tick a bank feed row dated after the statement date', async () => {
      const res = await getTransactions(accountId, statementDate).expect(200);
      const body = camelDeep(res.body);

      const lateRow = (body.transactions as any[]).find((r) => r.amount === 30);
      expect(lateRow).toBeDefined();
      expect(lateRow.isFromBankFeed).toBe(true);
      expect(lateRow.isAfterStatementDate).toBe(true);
      expect(
        body.selected.some(
          (s: any) =>
            Number(s.referenceId) === Number(lateRow.referenceId) &&
            s.referenceType === lateRow.referenceType,
        ),
      ).toBe(false);
    });

    it('counts the bank row still not in the books', async () => {
      const res = await getSummary(accountId, statementDate).expect(200);

      expect(camelDeep(res.body).uncategorizedCount).toBe(1);
    });
  });
});
