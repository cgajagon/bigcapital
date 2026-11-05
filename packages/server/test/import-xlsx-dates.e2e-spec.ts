import request = require('supertest');
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';
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

// The test builds on the account it creates, so a retry would re-import.
jest.retryTimes(0);

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const api = () => request(app.getHttpServer());
const authed = <T extends request.Test>(req: T): T =>
  req
    .set('organization-id', orgainzationId)
    .set('Authorization', AuthorizationHeader) as T;

/**
 * A bank statement saved from Excel: the Date column holds real date cells,
 * which Excel stores as serial numbers with a date format (46030 = 2026-01-08).
 * Built from serials, not JS Dates, so the test is the same in every zone.
 */
const bankStatementXlsx = (): Buffer => {
  const sheet: XLSX.WorkSheet = {
    '!ref': 'A1:C3',
    A1: { t: 's', v: 'Date' },
    B1: { t: 's', v: 'Description' },
    C1: { t: 's', v: 'Amount' },
    A2: { t: 'n', v: 46030, z: 'yyyy-mm-dd' },
    B2: { t: 's', v: 'Coffee' },
    C2: { t: 'n', v: -5 },
    A3: { t: 'n', v: 46034.6041667, z: 'm/d/yy h:mm' },
    B3: { t: 's', v: 'Client payment' },
    C3: { t: 'n', v: 500 },
  };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

describe('Import an Excel file with date cells (e2e)', () => {
  it('imports the dates of an .xlsx bank statement', async () => {
    const account = await authed(api().post('/accounts'))
      .send({
        name: `Xlsx dates ${Date.now()}-${faker.string.alphanumeric({ length: 4 })}`,
        accountType: 'bank',
        code: faker.string.alphanumeric({ length: 6 }).toUpperCase(),
      })
      .expect(201);
    const accountId = account.body.id;

    const upload = await authed(api().post('/import/file'))
      .attach('file', bankStatementXlsx(), {
        filename: 'statement.xlsx',
        contentType: XLSX_MIME,
      })
      .field('resource', 'UncategorizedBankTransaction')
      .field('params', JSON.stringify({ accountId }));
    expect(upload.status).toBeLessThan(300);
    const importId = upload.body.import.import_id;

    await authed(api().post(`/import/${importId}/mapping`))
      .send({
        mapping: [
          { from: 'Date', to: 'date' },
          { from: 'Description', to: 'description' },
          { from: 'Amount', to: 'amount' },
        ],
      })
      .expect((res) => expect(res.status).toBeLessThan(300));

    const preview = await authed(api().get(`/import/${importId}/preview`));
    expect(preview.body.errors).toEqual([]);
    expect(preview.body.created_count).toBe(2);

    const result = await authed(api().post(`/import/${importId}/import`));
    expect(result.body.created_count).toBe(2);

    const list = await authed(
      api().get(`/banking/uncategorized/accounts/${accountId}`),
    ).expect(200);
    const dates = list.body.data
      .map((row) => String(row.date).slice(0, 10))
      .sort();
    expect(dates).toEqual(['2026-01-08', '2026-01-12']);
  });
});
