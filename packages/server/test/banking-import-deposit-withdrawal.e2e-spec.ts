import request = require('supertest');
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { faker } from '@faker-js/faker';
import { app, AuthorizationHeader, orgainzationId } from './init-app-test';

// main.ts sets the static folder that import uploads are stored in; the test
// app doesn't run main.ts, so point it at a temp folder or every upload fails.
const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-import-e2e-'));
fs.mkdirSync(path.join(staticDir, 'imports'));
(global as any).__static_dirname = staticDir;

afterAll(() => {
  fs.rmSync(staticDir, { recursive: true, force: true });
});

// Each test builds on the account state the previous one committed, so a
// retry would re-import into it and report misleading counts.
jest.retryTimes(0);

// Two columns: rent out, a client payment in, a refund back in the
// withdrawals column (negative there means money back).
const TWO_COLUMNS = [
  'Date,Description,Withdrawals,Deposits',
  '2026-02-02,Rent,1200.00,',
  '2026-02-03,Client,,500.00',
  '2026-02-04,Refund,-20.00,',
].join('\n');

const TWO_COLUMNS_MAPPING = [
  { from: 'Date', to: 'date' },
  { from: 'Description', to: 'description' },
  { from: 'Withdrawals', to: 'withdrawal' },
  { from: 'Deposits', to: 'deposit' },
];

// A card export: purchases positive, the payment to the card negative.
const CARD_ONE_COLUMN = [
  'Date,Description,Amount',
  '2026-02-10,Coffee,5.00',
  '2026-02-11,Payment,-100.00',
].join('\n');

const ONE_COLUMN_MAPPING = [
  { from: 'Date', to: 'date' },
  { from: 'Description', to: 'description' },
  { from: 'Amount', to: 'amount' },
];

const api = () => request(app.getHttpServer());
const authed = <T extends request.Test>(req: T): T =>
  req
    .set('organization-id', orgainzationId)
    .set('Authorization', AuthorizationHeader) as T;

const upload = async (accountId: number, csv: string) => {
  const res = await authed(api().post('/import/file'))
    .attach('file', Buffer.from(csv), 'bank.csv')
    .field('resource', 'UncategorizedBankTransaction')
    .field('params', JSON.stringify({ accountId }));
  expect(res.status).toBeLessThan(300);
  return res.body.import.import_id as string;
};

const map = (importId: string, mapping: object[], params?: object) =>
  authed(api().post(`/import/${importId}/mapping`)).send(
    params ? { mapping, params } : { mapping },
  );

/**
 * Uploads, maps, previews and imports the given CSV into the bank account.
 */
const importCsv = async (
  accountId: number,
  csv: string,
  mapping: object[],
  params?: object,
) => {
  const importId = await upload(accountId, csv);
  const mapped = await map(importId, mapping, params);
  expect(mapped.status).toBeLessThan(300);

  const preview = await authed(api().get(`/import/${importId}/preview`));
  expect(preview.status).toBe(200);

  const result = await authed(api().post(`/import/${importId}/import`));
  expect(result.status).toBeLessThan(300);

  return { preview: preview.body, result: result.body };
};

const createBankAccount = async () => {
  const account = await authed(api().post('/accounts'))
    .send({
      name: `Import D/W ${Date.now()}-${faker.string.alphanumeric({ length: 4 })}`,
      accountType: 'bank',
      code: faker.string.alphanumeric({ length: 6 }).toUpperCase(),
    })
    .expect(201);
  return account.body.id as number;
};

const accountAmounts = async (accountId: number) => {
  const list = await authed(
    api().get(`/banking/uncategorized/accounts/${accountId}`),
  ).expect(200);
  return list.body.data
    .map((row) => (row.deposit > 0 ? row.deposit : -row.withdrawal))
    .sort((a, b) => a - b);
};

describe('Bank statement import with deposit/withdrawal columns (e2e)', () => {
  let accountId: number;

  beforeAll(async () => {
    accountId = await createBankAccount();
  });

  it('imports a two-column file with signed amounts and totals', async () => {
    const { preview, result } = await importCsv(
      accountId,
      TWO_COLUMNS,
      TWO_COLUMNS_MAPPING,
    );

    expect(preview.created_count).toBe(3);
    expect(preview.summary).toEqual({ money_in: 520, money_out: 1200 });
    expect(result.created_count).toBe(3);
    expect(await accountAmounts(accountId)).toEqual([-1200, 20, 500]);
  });

  it('skips every row when the same two-column file is imported again', async () => {
    const { result } = await importCsv(
      accountId,
      TWO_COLUMNS,
      TWO_COLUMNS_MAPPING,
    );

    expect(result.created_count).toBe(0);
    expect(result.skipped_count).toBe(3);
  });

  it('reverses a one-column card file and skips it on re-import', async () => {
    const cardAccountId = await createBankAccount();

    const { preview, result } = await importCsv(
      cardAccountId,
      CARD_ONE_COLUMN,
      ONE_COLUMN_MAPPING,
      { reverseSigns: true },
    );
    expect(preview.summary).toEqual({ money_in: 100, money_out: 5 });
    expect(result.created_count).toBe(2);
    expect(await accountAmounts(cardAccountId)).toEqual([-5, 100]);

    const again = await importCsv(
      cardAccountId,
      CARD_ONE_COLUMN,
      ONE_COLUMN_MAPPING,
      { reverseSigns: true },
    );
    expect(again.result.created_count).toBe(0);
    expect(again.result.skipped_count).toBe(2);
  });

  it('rejects a row with both a deposit and a withdrawal', async () => {
    const csv = [
      'Date,Description,Withdrawals,Deposits',
      '2026-03-01,Odd row,10.00,5.00',
    ].join('\n');
    const { preview } = await importCsv(
      await createBankAccount(),
      csv,
      TWO_COLUMNS_MAPPING,
    );

    expect(preview.created_count).toBe(0);
    expect(preview.errors_count).toBe(1);
    expect(preview.errors[0].error_code).toBe('BankAmountBothColumns');
  });

  it('refuses mapping Amount together with Withdrawal', async () => {
    const csv = ['Date,Amount,Withdrawals', '2026-03-02,5.00,'].join('\n');
    const importId = await upload(accountId, csv);

    const mapped = await map(importId, [
      { from: 'Date', to: 'date' },
      { from: 'Amount', to: 'amount' },
      { from: 'Withdrawals', to: 'withdrawal' },
    ]);

    expect(mapped.status).toBeGreaterThanOrEqual(400);
    expect(mapped.status).toBeLessThan(500);
    expect(JSON.stringify(mapped.body)).toContain(
      'IMPORT_AMOUNT_MAPPING_CONFLICT',
    );
  });

  it('imports a one-column file without options as before', async () => {
    const plainAccountId = await createBankAccount();
    const csv = [
      'Date,Description,Amount',
      '2026-03-05,Coffee,-5.00',
      '2026-03-06,Client,250.00',
    ].join('\n');

    const { result } = await importCsv(plainAccountId, csv, ONE_COLUMN_MAPPING);

    expect(result.created_count).toBe(2);
    expect(await accountAmounts(plainAccountId)).toEqual([-5, 250]);
  });
});
