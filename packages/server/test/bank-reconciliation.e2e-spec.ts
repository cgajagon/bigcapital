import request = require('supertest');
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { faker } from '@faker-js/faker';
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
    let expenseId: number;
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

    const selectedHas = (body: any, ref: any) =>
      body.selected.some(
        (s: any) =>
          s.referenceType === ref.referenceType &&
          Number(s.referenceId) === Number(ref.referenceId),
      );

    // The matched path is covered with an Expense. The manual journal match
    // isn't tested end to end: on develop its total sums every journal line
    // (always 0, issue #1536, fixed by PR #1575), so the API rejects it. The
    // ManualJournal -> Journal reference type mapping is covered by the
    // toLedgerReferenceType unit tests.
    beforeAll(async () => {
      accountId = await createAccount('bank', 'Rec feed bank');
      expenseAccountId = await createAccount('expense', 'Rec feed expense');

      await importCsv(
        accountId,
        [
          'Date,Payee,Description,Amount',
          '2035-03-03,Hydro,Electricity,-50.00',
          '2035-03-05,Metro,Groceries,-20.00',
          '2035-03-07,Client Inc,Refund,10.00',
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

      // Row matched to an expense paid from the account.
      const expense = await authed(api().post('/expenses'))
        .send({
          exchangeRate: 1,
          description: 'Groceries',
          paymentAccountId: accountId,
          referenceNo: faker.string.alphanumeric(10),
          publish: true,
          paymentDate: '2035-03-05',
          categories: [
            {
              index: 1,
              expenseAccountId,
              amount: 20,
              description: 'Groceries category',
            },
          ],
          branchId: 1,
        })
        .expect(201);
      expenseId = expense.body.id;
      await authed(api().post('/banking/matching/match'))
        .send({
          uncategorizedTransactions: [idByAmount(rows, 20)],
          matchedTransactions: [
            { referenceType: 'Expense', referenceId: expenseId },
          ],
        })
        .expect((res) => expect(res.status).toBeLessThan(300));

      // A manual transaction on the same account.
      manualId = await createOwnerContribution(accountId, 40, '2035-03-06');
    });

    it('flags categorized and matched rows as bank feed and pre-ticks them', async () => {
      const res = await getTransactions(accountId, statementDate).expect(200);
      const body = camelDeep(res.body);
      const rows = body.transactions as any[];

      const categorizedRow = rows.find((r) => r.amount === -50);
      expect(categorizedRow).toBeDefined();
      expect(categorizedRow.isFromBankFeed).toBe(true);
      expect(selectedHas(body, categorizedRow)).toBe(true);

      const matchedRow = rows.find(
        (r) =>
          r.referenceType === 'Expense' &&
          Number(r.referenceId) === Number(expenseId),
      );
      expect(matchedRow).toBeDefined();
      expect(matchedRow.amount).toBe(-20);
      expect(matchedRow.isFromBankFeed).toBe(true);
      expect(selectedHas(body, matchedRow)).toBe(true);

      const manualRow = rows.find(
        (r) => Number(r.referenceId) === Number(manualId) && r.amount === 40,
      );
      expect(manualRow).toBeDefined();
      expect(manualRow.isFromBankFeed).toBe(false);
      expect(selectedHas(body, manualRow)).toBe(false);
    });

    it('does not pre-tick a bank feed row dated after the statement date', async () => {
      const res = await getTransactions(accountId, statementDate).expect(200);
      const body = camelDeep(res.body);

      const lateRow = (body.transactions as any[]).find((r) => r.amount === 30);
      expect(lateRow).toBeDefined();
      expect(lateRow.isFromBankFeed).toBe(true);
      expect(lateRow.isAfterStatementDate).toBe(true);
      expect(selectedHas(body, lateRow)).toBe(false);
    });

    it('counts the bank row still not in the books', async () => {
      const res = await getSummary(accountId, statementDate).expect(200);

      expect(camelDeep(res.body).uncategorizedCount).toBe(1);
    });
  });

  describe('write side', () => {
    const accountPath = (accountId: number, suffix: string) =>
      `/banking/reconciliations/accounts/${accountId}/${suffix}`;

    const finish = (accountId: number, body: Record<string, any>) =>
      authed(api().post(accountPath(accountId, 'finish'))).send(body);

    const saveDraft = (accountId: number, body: Record<string, any>) =>
      authed(api().put(accountPath(accountId, 'draft'))).send(body);

    const discardDraft = (accountId: number) =>
      authed(api().delete(accountPath(accountId, 'draft')));

    const createExpenseFrom = async (
      paymentAccountId: number,
      expenseAccountId: number,
      amount: number,
      date: string,
    ): Promise<number> => {
      const res = await authed(api().post('/expenses'))
        .send({
          exchangeRate: 1,
          description: 'Rec write expense',
          paymentAccountId,
          referenceNo: faker.string.alphanumeric(10),
          publish: true,
          paymentDate: date,
          categories: [
            { index: 1, expenseAccountId, amount, description: 'Rec write' },
          ],
          branchId: 1,
        })
        .expect(201);
      return res.body.id;
    };

    /**
     * The tickable row of the account with the given amount.
     */
    const refByAmount = async (
      accountId: number,
      statementDate: string,
      amount: number,
    ) => {
      const res = await getTransactions(accountId, statementDate).expect(200);
      const row = (camelDeep(res.body).transactions as any[]).find(
        (r) => r.amount === amount,
      );
      expect(row).toBeDefined();
      return { referenceType: row.referenceType, referenceId: row.referenceId };
    };

    const input = (
      statementDate: string,
      endingBalance: any,
      selectedTransactions: any[],
    ) => ({ statementDate, endingBalance, selectedTransactions });

    const errorType = (res: request.Response) => res.body.errors?.[0]?.type;

    // A read straight after a write can rarely see stale rows on develop
    // (upstream #1616: the unit of work does not await commit), so poll briefly.
    const eventually = async <T>(
      read: () => Promise<T>,
      done: (value: T) => boolean,
    ): Promise<T> => {
      let value = await read();
      for (let i = 0; i < 10 && !done(value); i++) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        value = await read();
      }
      return value;
    };

    const summaryOf = async (accountId: number, statementDate: string) =>
      camelDeep((await getSummary(accountId, statementDate).expect(200)).body);

    const transactionsOf = async (accountId: number, statementDate: string) =>
      camelDeep(
        (await getTransactions(accountId, statementDate).expect(200)).body,
      );

    const historyOf = async (accountId: number) =>
      camelDeep(
        (
          await authed(
            api().get('/banking/reconciliations').query({ accountId }),
          ).expect(200)
        ).body,
      ) as any[];

    const detailOf = async (reconciliationId: number) =>
      camelDeep(
        (
          await authed(
            api().get(`/banking/reconciliations/${reconciliationId}`),
          ).expect(200)
        ).body,
      );

    describe('finish, history and draft', () => {
      const statementDate = '2036-01-31';

      let accountId: number;
      let refs: Array<{ referenceType: string; referenceId: number }>;

      beforeAll(async () => {
        accountId = await createAccount('bank', 'Rec write bank');
        const expenseAccountId = await createAccount(
          'expense',
          'Rec write expense',
        );
        await createOwnerContribution(accountId, 1000, '2036-01-10');
        await createExpenseFrom(accountId, expenseAccountId, 250, '2036-01-20');
        refs = [
          await refByAmount(accountId, statementDate, 1000),
          await refByAmount(accountId, statementDate, -250),
        ];
      });

      it('refuses a finish whose difference is not zero', async () => {
        const res = await finish(
          accountId,
          input(statementDate, 750.01, refs),
        ).expect(400);

        expect(errorType(res)).toBe('BANK_RECONCILIATION_DIFFERENCE_NOT_ZERO');
      });

      it('rejects an ending balance with more than 2 decimals', async () => {
        await finish(accountId, input(statementDate, 750.123, refs)).expect(
          400,
        );
        await finish(accountId, input(statementDate, '750.123', refs)).expect(
          400,
        );
        await saveDraft(accountId, input(statementDate, 750.123, refs)).expect(
          400,
        );
      });

      it('keeps a draft with its ticks only in the draft, then discards it', async () => {
        const tick = [refs[0]];
        await saveDraft(accountId, input(statementDate, 1000, tick)).expect(
          200,
        );
        // Saving again updates the same single draft.
        const second = await saveDraft(
          accountId,
          input(statementDate, 1000, tick),
        ).expect(200);

        const summary = await eventually(
          () => summaryOf(accountId, statementDate),
          (body) => !!body.draft,
        );
        expect(summary.draft.id).toBe(second.body.id);
        expect(summary.draft.endingBalance).toBe(1000);
        // A draft is not a reconciliation.
        expect(summary.lastReconciliation).toBeNull();
        expect(summary.beginningBalance).toBe(0);

        const rows = await transactionsOf(accountId, statementDate);
        expect(rows.selected).toEqual(tick);
        expect(rows.droppedFromDraftCount).toBe(0);

        await discardDraft(accountId).expect(200);
        const after = await eventually(
          () => summaryOf(accountId, statementDate),
          (body) => body.draft === null,
        );
        expect(after.draft).toBeNull();

        // Discarding again is a no-op.
        await discardDraft(accountId).expect(200);
      });

      it('drops a ticked transaction that was deleted from the draft', async () => {
        const doomedId = await createOwnerContribution(
          accountId,
          55,
          '2036-01-25',
        );
        const doomed = await refByAmount(accountId, statementDate, 55);
        await saveDraft(
          accountId,
          input(statementDate, 55, [doomed, refs[0]]),
        ).expect(200);

        await authed(api().delete(`/banking/transactions/${doomedId}`)).expect(
          200,
        );

        const rows = await eventually(
          () => transactionsOf(accountId, statementDate),
          (body) => body.droppedFromDraftCount === 1,
        );
        expect(rows.droppedFromDraftCount).toBe(1);
        expect(rows.selected).toEqual([refs[0]]);

        await discardDraft(accountId).expect(200);
      });

      it('finishes with the right ending balance and records who did it', async () => {
        // A draft exists at finish time; finish must remove it.
        await saveDraft(accountId, input(statementDate, 750, refs)).expect(200);
        await eventually(
          () => summaryOf(accountId, statementDate),
          (body) => !!body.draft,
        );

        const created = await finish(
          accountId,
          input(statementDate, 750, refs),
        ).expect(201);
        expect(created.body.id).toBeGreaterThan(0);

        const summary = await eventually(
          () => summaryOf(accountId, '2036-02-28'),
          (body) => body.beginningBalance === 750,
        );
        expect(summary.beginningBalance).toBe(750);
        expect(summary.lastReconciliation.endingBalance).toBe(750);
        expect(summary.lastReconciliation.statementDate).toBe(statementDate);
        expect(summary.mismatch).toBeNull();
        // The draft was converted away.
        expect(summary.draft).toBeNull();

        const history = await eventually(
          () => historyOf(accountId),
          (list) => list.length === 1,
        );
        expect(history).toHaveLength(1);
        expect(history[0].id).toBe(created.body.id);
        expect(history[0].completedByName).toEqual(expect.any(String));
        expect(history[0].completedByName.length).toBeGreaterThan(0);
        expect(history[0].completedByUserId).toEqual(expect.any(Number));

        const detail = await detailOf(created.body.id);
        const amounts = detail.transactions.map((t: any) => t.amount).sort();
        expect(amounts).toEqual([-250, 1000]);
      });

      it('refuses the same finish again, and an already reconciled tick', async () => {
        const again = await finish(
          accountId,
          input(statementDate, 750, refs),
        ).expect(400);
        expect(errorType(again)).toBe(
          'BANK_RECONCILIATION_STATEMENT_DATE_NOT_AFTER_LAST',
        );

        const later = await finish(
          accountId,
          input('2036-02-28', 750, refs),
        ).expect(400);
        expect(errorType(later)).toBe(
          'BANK_RECONCILIATION_TRANSACTION_ALREADY_RECONCILED',
        );
      });

      it('refuses a tick that is not on the account', async () => {
        const res = await finish(
          accountId,
          input('2036-03-31', 750, [
            { referenceType: 'Expense', referenceId: 99999999 },
          ]),
        ).expect(400);
        expect(errorType(res)).toBe(
          'BANK_RECONCILIATION_TRANSACTION_NOT_ON_ACCOUNT',
        );
      });
    });

    describe('duplicated ticks', () => {
      it('does not change the difference when a transaction is ticked twice', async () => {
        const accountId = await createAccount('bank', 'Rec dup bank');
        await createOwnerContribution(accountId, 100, '2036-04-05');
        const ref = await refByAmount(accountId, '2036-04-30', 100);

        const res = await finish(
          accountId,
          input('2036-04-30', 100, [ref, { ...ref }]),
        ).expect(201);

        const detail = await detailOf(res.body.id);
        expect(detail.transactions).toHaveLength(1);
      });
    });

    describe('mismatch after a reconciled transaction is deleted', () => {
      it('lists the deleted transaction in the summary mismatch', async () => {
        const accountId = await createAccount('bank', 'Rec mismatch bank');
        const contributionId = await createOwnerContribution(
          accountId,
          40,
          '2036-05-05',
        );
        const ref = await refByAmount(accountId, '2036-05-31', 40);
        await finish(accountId, input('2036-05-31', 40, [ref])).expect(201);

        await authed(
          api().delete(`/banking/transactions/${contributionId}`),
        ).expect(200);

        const summary = await eventually(
          () => summaryOf(accountId, '2036-06-30'),
          (body) => !!body.mismatch,
        );
        expect(summary.mismatch.items).toHaveLength(1);
        expect(summary.mismatch.items[0].isDeleted).toBe(true);
        expect(summary.mismatch.items[0].amount).toBe(40);
        // The books lost the 40 the statement closed at.
        expect(summary.beginningBalance).toBe(0);
        expect(summary.mismatch.amount).toBe(-40);
      });
    });

    describe('stored totals and bank rows', () => {
      const statementDate = '2037-01-31';

      it('stores the section 5.9 totals at finish', async () => {
        const accountId = await createAccount('bank', 'Rec totals bank');
        const expenseAccountId = await createAccount(
          'expense',
          'Rec totals exp',
        );
        await createOwnerContribution(accountId, 500, '2037-01-05');
        await createOwnerContribution(accountId, 120, '2037-01-10');
        await createExpenseFrom(accountId, expenseAccountId, 70, '2037-01-12');
        await createExpenseFrom(accountId, expenseAccountId, 30, '2037-01-15');
        await createOwnerContribution(accountId, 900, '2037-02-10');
        const ticked = [
          await refByAmount(accountId, statementDate, 500),
          await refByAmount(accountId, statementDate, -30),
        ];

        const res = await finish(
          accountId,
          input(statementDate, 470, ticked),
        ).expect(201);

        const detail = await eventually(
          () => detailOf(res.body.id),
          (body) => body.transactions.length === 2,
        );
        expect(detail.beginningBalance).toBe(0);
        expect(detail.clearedIncreases).toBe(500);
        // A positive magnitude.
        expect(detail.clearedDecreases).toBe(30);
        expect(detail.bookBalance).toBe(520);
        expect(detail.unclearedCount).toBe(2);
        expect(detail.unclearedTotal).toBe(50);
      });

      it('keeps a finished bank feed transaction as a snapshot after it is uncategorized', async () => {
        const accountId = await createAccount('bank', 'Rec snapshot bank');
        const expenseAccountId = await createAccount('expense', 'Rec snap exp');
        await importCsv(
          accountId,
          [
            'Date,Payee,Description,Amount',
            '2037-03-03,Hydro,Electricity,-50.00',
          ].join(String.fromCharCode(10)),
        );
        const feed = camelDeep(
          (
            await authed(
              api().get(`/banking/uncategorized/accounts/${accountId}`),
            ).expect(200)
          ).body,
        ).data as any[];
        const uncategorizedId = feed[0].id;
        await authed(api().post('/banking/categorize'))
          .send({
            uncategorizedTransactionIds: [uncategorizedId],
            date: '2037-03-03',
            creditAccountId: expenseAccountId,
            transactionType: 'other_expense',
            exchangeRate: 1,
          })
          .expect(201);

        const ref = await refByAmount(accountId, '2037-03-31', -50);
        const res = await finish(
          accountId,
          input('2037-03-31', -50, [ref]),
        ).expect(201);

        await authed(
          api().delete(`/banking/categorize/${uncategorizedId}`),
        ).expect(200);

        // The transaction left the books, the reconciliation keeps its snapshot.
        const detail = await eventually(
          () => detailOf(res.body.id),
          (body) => body.transactions[0]?.isDeleted === true,
        );
        expect(detail.transactions).toHaveLength(1);
        expect(detail.transactions[0].amount).toBe(-50);
        expect(detail.transactions[0].isDeleted).toBe(true);
        expect(detail.transactions[0].currentAmount).toBe(0);
        // Bank row links are internal: the detail does not expose them, so
        // only the snapshot surviving the uncategorize is asserted here.
      });
    });

    describe('undo', () => {
      const undo = (reconciliationId: number) =>
        authed(api().post(`/banking/reconciliations/${reconciliationId}/undo`));

      const balanceOf = async (accountId: number) =>
        camelDeep(
          (await authed(api().get(`/accounts/${accountId}`)).expect(200)).body,
        ).amount;

      it('undoes the target, every later reconciliation and the draft', async () => {
        const accountId = await createAccount('bank', 'Rec undo bank');
        await createOwnerContribution(accountId, 100, '2038-01-10');
        await createOwnerContribution(accountId, 200, '2038-02-10');
        await createOwnerContribution(accountId, 300, '2038-03-10');

        const january = await finish(
          accountId,
          input('2038-01-31', 100, [
            await refByAmount(accountId, '2038-01-31', 100),
          ]),
        ).expect(201);
        const february = await finish(
          accountId,
          input('2038-02-28', 300, [
            await refByAmount(accountId, '2038-02-28', 200),
          ]),
        ).expect(201);
        await saveDraft(
          accountId,
          input('2038-03-31', 600, [
            await refByAmount(accountId, '2038-03-31', 300),
          ]),
        ).expect(200);
        await eventually(
          () => summaryOf(accountId, '2038-03-31'),
          (body) => !!body.draft,
        );
        const balanceBefore = await balanceOf(accountId);

        const res = await undo(january.body.id).expect(201);
        expect([...camelDeep(res.body).undoneIds].sort()).toEqual(
          [january.body.id, february.body.id].sort(),
        );

        const history = await eventually(
          () => historyOf(accountId),
          (list) => list.length === 0,
        );
        expect(history).toEqual([]);
        const summary = await eventually(
          () => summaryOf(accountId, '2038-03-31'),
          (body) => body.draft === null,
        );
        expect(summary.draft).toBeNull();
        expect(summary.lastReconciliation).toBeNull();
        expect(summary.beginningBalance).toBe(0);

        const rows = await transactionsOf(accountId, '2038-03-31');
        expect(rows.transactions.map((r: any) => r.amount).sort()).toEqual([
          100, 200, 300,
        ]);
        expect(
          rows.transactions.every(
            (r: any) => r.reconcileStatus !== 'reconciled',
          ),
        ).toBe(true);

        // The books were not touched.
        expect(await balanceOf(accountId)).toBe(balanceBefore);
        // The undone reconciliation is gone.
        await authed(
          api().get(`/banking/reconciliations/${february.body.id}`),
        ).expect(400);
      });

      it('keeps the earlier reconciliations when a later one is undone', async () => {
        const accountId = await createAccount('bank', 'Rec undo later bank');
        await createOwnerContribution(accountId, 100, '2038-04-10');
        await createOwnerContribution(accountId, 200, '2038-05-10');
        const first = await finish(
          accountId,
          input('2038-04-30', 100, [
            await refByAmount(accountId, '2038-04-30', 100),
          ]),
        ).expect(201);
        const second = await finish(
          accountId,
          input('2038-05-31', 300, [
            await refByAmount(accountId, '2038-05-31', 200),
          ]),
        ).expect(201);

        const res = await undo(second.body.id).expect(201);
        expect(camelDeep(res.body).undoneIds).toEqual([second.body.id]);

        const history = await eventually(
          () => historyOf(accountId),
          (list) => list.length === 1,
        );
        expect(history.map((item) => item.id)).toEqual([first.body.id]);
      });

      it('answers an unknown id and a draft id with NOT_FOUND', async () => {
        const unknown = await undo(99999999);
        expect(errorType(unknown)).toBe('BANK_RECONCILIATION_NOT_FOUND');
        expect(unknown.status).toBeGreaterThanOrEqual(400);
        expect(unknown.status).toBeLessThan(500);

        const accountId = await createAccount('bank', 'Rec undo draft bank');
        await createOwnerContribution(accountId, 10, '2038-06-10');
        const draft = await saveDraft(
          accountId,
          input('2038-06-30', 10, [
            await refByAmount(accountId, '2038-06-30', 10),
          ]),
        ).expect(200);
        const onDraft = await undo(draft.body.id);
        expect(errorType(onDraft)).toBe('BANK_RECONCILIATION_NOT_FOUND');
      });
    });

    describe('credit card account', () => {
      it('counts a charge as +80 and rejects the negated ending balance', async () => {
        const cardId = await createAccount('credit-card', 'Rec write card');
        const expenseAccountId = await createAccount('expense', 'Rec card exp');
        await createExpenseFrom(cardId, expenseAccountId, 80, '2036-07-10');
        const ref = await refByAmount(cardId, '2036-07-31', 80);

        const wrong = await finish(
          cardId,
          input('2036-07-31', -80, [ref]),
        ).expect(400);
        expect(errorType(wrong)).toBe(
          'BANK_RECONCILIATION_DIFFERENCE_NOT_ZERO',
        );

        await finish(cardId, input('2036-07-31', 80, [ref])).expect(201);
      });
    });
  });
});
