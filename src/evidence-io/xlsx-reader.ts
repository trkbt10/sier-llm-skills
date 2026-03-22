/**
 * @file XLSX ファイルのセル値読み取り。
 *
 * aurochs の parseWorkbook (簡易 API) を使って XLSX のシート内容を
 * テキスト形式に変換し、LLM がテスト仕様書の構造を動的に解釈できるようにする。
 */

import { parseWorkbook, getCellValue } from "aurochs/xlsx/parser";
import type { WorkbookSheet } from "aurochs/xlsx/parser";
import { readFile } from "node:fs/promises";

/** シート内容のテキスト表現。 */
export type SheetText = {
  readonly name: string;
  readonly rows: readonly SheetRow[];
  readonly maxRow: number;
  readonly maxCol: string;
};

export type SheetRow = {
  readonly rowNumber: number;
  readonly cells: readonly SheetCell[];
};

export type SheetCell = {
  readonly col: string;
  readonly row: number;
  readonly value: string;
};

/** XLSX 読み取り結果。 */
export type XlsxReadResult = {
  readonly sheetNames: readonly string[];
  readonly sheets: readonly SheetText[];
};

/** XLSX ファイルを読み取り、全シートのセル値をテキスト化する。 */
export async function readXlsxAsText(filePath: string): Promise<XlsxReadResult> {
  const data = await readFile(filePath);
  const workbook = await parseWorkbook(data.buffer as ArrayBuffer);
  const sheetNames = [...workbook.sheets.keys()];

  return {
    sheetNames,
    sheets: sheetNames.map((name) => {
      const sheet = workbook.sheets.get(name)!;
      return sheetToText(sheet);
    }),
  };
}

/** 特定シートの特定セル値を取得する。 */
export async function readCellValue(
  filePath: string,
  sheetName: string,
  col: string,
  row: number,
): Promise<string | number | boolean | undefined> {
  const data = await readFile(filePath);
  const workbook = await parseWorkbook(data.buffer as ArrayBuffer);
  const sheet = workbook.sheets.get(sheetName);
  if (sheet === undefined) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }
  return getCellValue(sheet, col, row);
}

function sheetToText(sheet: WorkbookSheet): SheetText {
  const rows: SheetRow[] = [];
  const sortedRowNumbers = [...sheet.rows.keys()].sort((a, b) => a - b);
  const maxCol = findMaxCol(sheet);

  for (const rowNum of sortedRowNumbers) {
    const row = sheet.rows.get(rowNum)!;
    const cells: SheetCell[] = [];

    for (const [colLetter, cell] of row.cells) {
      const value = String(cell.value);
      if (value !== "") {
        cells.push({ col: colLetter, row: rowNum, value });
      }
    }

    if (cells.length > 0) {
      rows.push({ rowNumber: rowNum, cells });
    }
  }

  const lastRow = sortedRowNumbers[sortedRowNumbers.length - 1];
  const maxRow = lastRow ?? 0;

  return { name: sheet.name, rows, maxRow, maxCol };
}

function findMaxCol(sheet: WorkbookSheet): string {
  const cols = new Set<string>();
  for (const row of sheet.rows.values()) {
    for (const col of row.cells.keys()) {
      cols.add(col);
    }
  }
  const sorted = [...cols].sort((a, b) => colToIndex(a) - colToIndex(b));
  return sorted.length > 0 ? sorted[sorted.length - 1] : "A";
}

function colToIndex(col: string): number {
  const upper = col.toUpperCase();
  if (upper.length === 1) {
    return upper.charCodeAt(0) - 65;
  }
  return (upper.charCodeAt(0) - 64) * 26 + (upper.charCodeAt(1) - 65);
}

/** シート内容を LLM 向けテキストにフォーマットする。 */
export function formatSheetForLlm(sheet: SheetText): string {
  const lines: string[] = [`=== シート: ${sheet.name} ===`];

  for (const row of sheet.rows) {
    const cellTexts = row.cells.map((c) => `${c.col}${c.row}="${c.value}"`);
    lines.push(`行${row.rowNumber}: ${cellTexts.join(" | ")}`);
  }

  return lines.join("\n");
}

/** 全シートを LLM 向けテキストにフォーマットする。 */
export function formatXlsxForLlm(result: XlsxReadResult): string {
  const header = `シート一覧: ${result.sheetNames.join(", ")}`;
  const body = result.sheets.map(formatSheetForLlm).join("\n\n");
  return `${header}\n\n${body}`;
}
