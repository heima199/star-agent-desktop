import { defaultSpreadsheetEngine, SpreadsheetError, type DelimitedFormat } from '@/components/workspace/surfaces/document/spreadsheetEngine'
import { TABLE_IMPORT_LIMITS } from './designEditor'

/**
 * Spreadsheets in and out of board tables: a workbook's first sheet becomes a
 * table, and a table leaves as an Excel or CSV file. Reading goes through the
 * workspace's spreadsheet engine, with its checks on what a file may hold.
 */

/** File types the 导入表格 picker offers. */
export const SPREADSHEET_ACCEPT = '.xlsx,.xlsm,.xls,.csv,.tsv'

function delimitedFormat(name: string): DelimitedFormat | undefined {
  const extension = name.toLowerCase().split('.').pop()
  return extension === 'csv' || extension === 'tsv' ? extension : undefined
}

/** The first visible sheet of `file` as rows of cell text, and whether more was left out. */
export async function readSpreadsheetRows(file: File): Promise<{ rows: string[][]; truncated: boolean }> {
  return spreadsheetRowsFromBytes(new Uint8Array(await file.arrayBuffer()), file.name)
}

/** As readSpreadsheetRows, for the bytes of a file called `name` (the extension tells CSV from TSV). */
export async function spreadsheetRowsFromBytes(bytes: Uint8Array, name: string): Promise<{ rows: string[][]; truncated: boolean }> {
  let rows: string[][]
  let truncated: boolean
  try {
    const document = await defaultSpreadsheetEngine.open(bytes, { delimited: delimitedFormat(name) })
    const sheet = document.sheets[0]
    if (!sheet) throw new SpreadsheetError('invalid', 'The workbook has no visible sheet')
    const grid = await document.readSheet(sheet.index)
    rows = grid.cells.map(row => Array.from({ length: grid.columns }, (_, col) => row[col]?.text ?? ''))
    truncated = grid.truncatedRows || grid.truncatedColumns
  } catch (error) {
    if (error instanceof SpreadsheetError) {
      throw new Error(error.kind === 'tooComplex' ? '表格文件过大或结构过于复杂，无法导入' : error.kind === 'unavailable' ? '表格组件加载失败，请稍后再试' : '无法读取这个文件，请确认它是 Excel 或 CSV 表格')
    }
    throw error
  }
  // Trailing empty rows say nothing on a board.
  while (rows.length && rows[rows.length - 1]!.every(value => !value.trim())) rows.pop()
  if (!rows.length) throw new Error('这个表格是空的')
  return {
    rows,
    truncated: truncated || rows.length > TABLE_IMPORT_LIMITS.rows || rows.some(row => row.length > TABLE_IMPORT_LIMITS.columns),
  }
}

/** RFC 4180 CSV, with the byte-order mark Excel needs to read UTF-8 Chinese text correctly. */
export function rowsToCsv(rows: readonly (readonly string[])[]): string {
  const quote = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)
  return `\ufeff${rows.map(row => row.map(quote).join(',')).join('\r\n')}\r\n`
}

/**
 * A cell Excel should hold as a number, so sums and charts work on it: text
 * that reads back exactly as written (120, -3.5). Anything else stays text:
 * 007, 0.10, 1e5 and 1,234 would change if they became numbers.
 */
function spreadsheetValue(text: string): string | number {
  if (!/^-?\d/.test(text)) return text
  const value = Number(text)
  return Number.isFinite(value) && String(value) === text ? value : text
}

/** The bytes of an .xlsx workbook with `rows` on one sheet; see spreadsheetValue for which cells are numbers. */
export async function rowsToXlsxBytes(rows: readonly (readonly string[])[], sheetName = 'Sheet1'): Promise<Uint8Array<ArrayBuffer>> {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet(rows.map(row => row.map(spreadsheetValue)))
  const book = XLSX.utils.book_new()
  // Excel caps sheet names at 31 characters and refuses a few in them.
  XLSX.utils.book_append_sheet(book, sheet, sheetName.replace(/[\\/?*[\]:]/g, '-').slice(0, 31) || 'Sheet1')
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

/** rowsToXlsxBytes as a file to download. */
export async function rowsToXlsx(rows: readonly (readonly string[])[], sheetName = 'Sheet1'): Promise<Blob> {
  return new Blob([await rowsToXlsxBytes(rows, sheetName)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
