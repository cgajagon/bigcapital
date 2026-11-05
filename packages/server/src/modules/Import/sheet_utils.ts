import * as XLSX from 'xlsx';
import { first } from 'lodash';

/**
 * Formats an Excel date serial as YYYY-MM-DD. SheetJS's own conversion is
 * used, so no time zone can shift the day; any time of day is dropped.
 * @param {number} serial
 * @param {boolean} date1904 - Whether the workbook uses the 1904 date system.
 * @returns {string}
 */
const formatDateSerial = (serial: number, date1904: boolean): string => {
  const { y, m, d } = XLSX.SSF.parse_date_code(serial, { date1904 });
  const pad = (n: number) => String(n).padStart(2, '0');

  return `${y}-${pad(m)}-${pad(d)}`;
};

/**
 * Replaces the date cells of the worksheet (numbers with a date format, which
 * is how Excel stores a typed date) with YYYY-MM-DD text, as the importers
 * expect. Other cells, and every CSV value, are left as they are.
 * @param {XLSX.WorkSheet} worksheet
 * @param {boolean} date1904
 */
const convertDateCells = (worksheet: XLSX.WorkSheet, date1904: boolean) => {
  Object.keys(worksheet)
    .filter((address) => !address.startsWith('!'))
    .forEach((address) => {
      const cell: XLSX.CellObject = worksheet[address];

      if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
        const date = formatDateSerial(cell.v as number, date1904);
        worksheet[address] = { t: 's', v: date, w: date };
      }
    });
};

/**
 * Parses the given sheet buffer to worksheet.
 * @param {Buffer} buffer
 * @returns {XLSX.WorkSheet}
 */
export function parseFirstSheet(buffer: Buffer): XLSX.WorkSheet {
  // `cellNF` keeps each cell's number format, so date cells can be told apart.
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    raw: true,
    cellNF: true,
  });

  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];

  convertDateCells(worksheet, !!workbook.Workbook?.WBProps?.date1904);

  return worksheet;
}

/**
 * Extracts the given worksheet to columns.
 * @param {XLSX.WorkSheet} worksheet
 * @returns {Array<string>}
 */
export function extractSheetColumns(worksheet: XLSX.WorkSheet): Array<string> {
  // By default, sheet_to_json scans the first row and uses the values as headers.
  // With the header: 1 option, the function exports an array of arrays of values.
  const sheetCells = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  const sheetCols = first(sheetCells) as Array<string>;

  return sheetCols.filter((col) => col);
}

/**
 * Parses the given worksheet to json values. the keys are columns labels.
 * @param {XLSX.WorkSheet} worksheet
 * @returns {Array<Record<string, string>>}
 */
export function parseSheetToJson(
  worksheet: XLSX.WorkSheet,
): Array<Record<string, string>> {
  return XLSX.utils.sheet_to_json(worksheet, {});
}

/**
 * Parses the given sheet buffer then retrieves the sheet data and columns.
 * @param {Buffer} buffer
 */
export function parseSheetData(
  buffer: Buffer,
): [Array<Record<string, string>>, string[]] {
  const worksheet = parseFirstSheet(buffer);

  const columns = extractSheetColumns(worksheet);
  const data = parseSheetToJson(worksheet);

  return [data, columns];
}
