/**
 * @file XLSX ファイルへのセル値書き戻し。
 *
 * aurochs の patchWorkbook を使って既存 XLSX のセルを更新する。
 */

import { parseWorkbook } from "aurochs/xlsx/parser";
import { patchWorkbook } from "aurochs/xlsx/patcher";
import type { CellUpdate, SheetUpdate } from "aurochs/xlsx/patcher";
import { readFile, writeFile } from "node:fs/promises";

export type { CellUpdate, SheetUpdate };

/** XLSX ファイルのセルを更新して保存する。 */
export async function updateXlsxCells(
  inputPath: string,
  outputPath: string,
  updates: readonly SheetUpdate[],
): Promise<void> {
  const data = await readFile(inputPath);
  const workbook = await parseWorkbook(data.buffer as ArrayBuffer);
  const result = await patchWorkbook(workbook, updates);
  await writeFile(outputPath, Buffer.from(result.xlsxBuffer));
}
