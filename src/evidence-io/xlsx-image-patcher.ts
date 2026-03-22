/**
 * @file XLSX への画像注入。
 *
 * aurochs の patchWorkbook + ImagePlacement API を使って
 * 既存 XLSX に画像を埋め込む。
 */

import { parseWorkbook } from "aurochs/xlsx/parser";
import { patchWorkbook } from "aurochs/xlsx/builder";
import type { ImagePlacement, SheetUpdate } from "aurochs/xlsx/builder";
import { readFile, writeFile } from "node:fs/promises";

/** 画像挿入指定。 */
export type ImageInsert = {
  /** 画像データ。 */
  readonly data: Uint8Array;
  /** OPC content type (必須)。@see ECMA-376 Part 2, Section 10.1.2.2.1 */
  readonly contentType: string;
  /** アンカー開始列 (0-based)。 */
  readonly fromCol: number;
  /** アンカー開始行 (0-based)。 */
  readonly fromRow: number;
  /** アンカー終了列 (0-based)。 */
  readonly toCol: number;
  /** アンカー終了行 (0-based)。 */
  readonly toRow: number;
};

/** シートへの画像挿入指定。 */
export type SheetImagePatch = {
  /** シート名。 */
  readonly sheetName: string;
  /** 挿入する画像群。 */
  readonly images: readonly ImageInsert[];
};

/** XLSX ファイルに画像を注入する。 */
export async function patchXlsxWithImages(
  inputPath: string,
  outputPath: string,
  patches: readonly SheetImagePatch[],
): Promise<void> {
  const data = await readFile(inputPath);
  const workbook = await parseWorkbook(data.buffer as ArrayBuffer);

  const updates: SheetUpdate[] = patches.map((patch) => ({
    sheetName: patch.sheetName,
    cells: [],
    images: patch.images.map((img): ImagePlacement => ({
      data: img.data,
      contentType: img.contentType,
      fromCol: img.fromCol,
      fromRow: img.fromRow,
      toCol: img.toCol,
      toRow: img.toRow,
    })),
  }));

  const result = await patchWorkbook(workbook, updates);
  await writeFile(outputPath, Buffer.from(result.xlsxBuffer));
}
