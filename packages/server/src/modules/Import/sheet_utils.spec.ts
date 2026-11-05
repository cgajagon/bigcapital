import * as XLSX from 'xlsx';
import { parseSheetData } from './sheet_utils';

// Excel stores dates as serial numbers with a date format. Building the cells
// from serials (not JS Dates) keeps these tests the same in every time zone.
const JAN_8_2026 = 46030;
const DEC_31_2026 = 46387;

type Cell = string | { v: number; z?: string };

/**
 * Builds an .xlsx buffer from rows of header strings and number cells.
 */
const xlsxBuffer = (
  rows: Cell[][],
  options: { date1904?: boolean } = {},
): Buffer => {
  const sheet: XLSX.WorkSheet = {};
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      const address = XLSX.utils.encode_cell({ r, c });
      sheet[address] =
        typeof cell === 'string'
          ? { t: 's', v: cell }
          : { t: 'n', v: cell.v, ...(cell.z ? { z: cell.z } : {}) };
    }),
  );
  sheet['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: rows.length - 1, c: rows[0].length - 1 },
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  if (options.date1904) {
    workbook.Workbook = { WBProps: { date1904: true } };
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const date = (v: number) => ({ v, z: 'yyyy-mm-dd' });

describe('parseSheetData', () => {
  it('reads Excel date cells as YYYY-MM-DD', () => {
    const [data, columns] = parseSheetData(
      xlsxBuffer([
        ['Date', 'Amount'],
        [date(JAN_8_2026), { v: -5 }],
        [{ v: DEC_31_2026, z: 'm/d/yy' }, { v: -1200 }],
      ]),
    );

    expect(columns).toEqual(['Date', 'Amount']);
    expect(data.map((row) => row.Date)).toEqual(['2026-01-08', '2026-12-31']);
  });

  it('drops the time of a date-time cell', () => {
    const [data] = parseSheetData(
      xlsxBuffer([
        ['Posted'],
        [{ v: JAN_8_2026 + 0.9895833, z: 'yyyy-mm-dd hh:mm' }],
      ]),
    );

    expect(data[0].Posted).toBe('2026-01-08');
  });

  it('reads dates from a workbook using the 1904 date system', () => {
    // The 1904 system counts 1462 days fewer than the 1900 system.
    const [data] = parseSheetData(
      xlsxBuffer([['Date'], [date(JAN_8_2026 - 1462)]], { date1904: true }),
    );

    expect(data[0].Date).toBe('2026-01-08');
  });

  it('keeps numbers that are not formatted as dates', () => {
    const [data] = parseSheetData(
      xlsxBuffer([
        ['Amount', 'Code', 'Rate', 'Price'],
        [
          { v: -5 },
          { v: JAN_8_2026 },
          { v: 0.25, z: '0%' },
          { v: 5, z: '"$"#,##0.00' },
        ],
      ]),
    );

    expect(data).toEqual([
      { Amount: -5, Code: JAN_8_2026, Rate: 0.25, Price: 5 },
    ]);
  });

  it('keeps time-only cells as numbers', () => {
    const [data] = parseSheetData(
      xlsxBuffer([
        ['Start', 'Hours'],
        [
          { v: 0.5, z: 'h:mm' },
          { v: 1.5, z: '[h]:mm' },
        ],
      ]),
    );

    expect(data).toEqual([{ Start: 0.5, Hours: 1.5 }]);
  });

  it('keeps date-formatted numbers that are not valid dates, without failing', () => {
    const [data] = parseSheetData(
      xlsxBuffer([
        ['Days overdue', 'Big'],
        [date(-1), date(2958466)],
      ]),
    );

    expect(data).toEqual([{ 'Days overdue': -1, Big: 2958466 }]);
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
