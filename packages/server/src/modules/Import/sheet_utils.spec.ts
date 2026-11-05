import * as XLSX from 'xlsx';
import { parseSheetData } from './sheet_utils';

const xlsxBuffer = (
  sheet: XLSX.WorkSheet,
  options: { date1904?: boolean } = {},
): Buffer => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  if (options.date1904) {
    workbook.Workbook = { WBProps: { date1904: true } };
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

describe('parseSheetData', () => {
  it('reads Excel date cells as YYYY-MM-DD', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Date', 'Description', 'Amount'],
      [new Date(2026, 0, 8), 'Coffee', -5],
      [new Date(2026, 11, 31), 'Rent', -1200],
    ]);

    const [data, columns] = parseSheetData(xlsxBuffer(sheet));

    expect(columns).toEqual(['Date', 'Description', 'Amount']);
    expect(data.map((row) => row.Date)).toEqual(['2026-01-08', '2026-12-31']);
  });

  it('drops the time of a date-time cell', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Posted'],
      [new Date(2026, 0, 8, 23, 45)],
    ]);

    const [data] = parseSheetData(xlsxBuffer(sheet));

    expect(data[0].Posted).toBe('2026-01-08');
  });

  it('reads dates from a workbook using the 1904 date system', () => {
    // 2026-01-08 is serial 46030 in the 1900 system, 1462 days less in 1904.
    const sheet: XLSX.WorkSheet = {
      '!ref': 'A1:A2',
      A1: { t: 's', v: 'Date' },
      A2: { t: 'n', v: 46030 - 1462, z: 'yyyy-mm-dd' },
    };

    const [data] = parseSheetData(xlsxBuffer(sheet, { date1904: true }));

    expect(data[0].Date).toBe('2026-01-08');
  });

  it('keeps numbers that are not formatted as dates', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Amount', 'Code'],
      [-5, 46030],
      [1234.5, 42],
    ]);

    const [data] = parseSheetData(xlsxBuffer(sheet));

    expect(data).toEqual([
      { Amount: -5, Code: 46030 },
      { Amount: 1234.5, Code: 42 },
    ]);
  });

  it('leaves CSV text exactly as typed', () => {
    const csv = Buffer.from('Date,Amount\n2026-01-08,-5.00\n01/08/2026,3\n');

    const [data] = parseSheetData(csv);

    expect(data).toEqual([
      { Date: '2026-01-08', Amount: '-5.00' },
      { Date: '01/08/2026', Amount: '3' },
    ]);
  });
});
