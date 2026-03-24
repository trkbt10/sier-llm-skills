/**
 * @file XLSX への画像注入。
 *
 * aurochs の patchWorkbook + ImagePlacement API を使って
 * 既存 XLSX に画像を埋め込む。
 *
 * 画像のセル位置と行スパンだけ指定すれば、
 * 行高さ・列幅・セル結合・DrawingML アンカーを自動算出する。
 */

import { parseWorkbook } from "aurochs/xlsx/parser";
import { patchWorkbook } from "aurochs/xlsx/builder";
import type { ImagePlacement, SheetUpdate } from "aurochs/xlsx/builder";
import { readFile, writeFile } from "node:fs/promises";

/** スクリーンショット行のデフォルト高さ (pt)。 */
const DEFAULT_ROW_HEIGHT = 20;

/** スクリーンショット列のデフォルト幅 (文字数単位)。 */
const DEFAULT_COL_WIDTH = 70;

/** 画像挿入指定。セル位置と行スパンだけで配置を決定する。 */
export type ImageInsert = {
  /** 画像データ。 */
  readonly data: Uint8Array;
  /** OPC content type (必須)。@see ECMA-376 Part 2, Section 10.1.2.2.1 */
  readonly contentType: string;
  /** 配置先の列番号 (1-based)。 */
  readonly col: number;
  /** 配置先の開始行番号 (1-based)。 */
  readonly row: number;
  /** 画像が占める行数。 */
  readonly rowSpan: number;
};

/** シートへの画像挿入指定。 */
export type SheetImagePatch = {
  /** シート名。 */
  readonly sheetName: string;
  /** 挿入する画像群。 */
  readonly images: readonly ImageInsert[];
  /** スクリーンショット行の高さ (pt)。省略時はデフォルト (20pt)。 */
  readonly rowHeight?: number;
  /** スクリーンショット列の幅 (文字数単位)。省略時はデフォルト (70)。 */
  readonly colWidth?: number;
};

/** 列番号 (1-based) を "A", "B", ... "Z", "AA" 形式に変換する。 */
function colIndexToLetter(col: number): string {
  return colIndexToLetterRec("", col);
}

function colIndexToLetterRec(acc: string, n: number): string {
  if (n <= 0) {
    return acc;
  }
  const adjusted = n - 1;
  return colIndexToLetterRec(String.fromCharCode(65 + (adjusted % 26)) + acc, Math.floor(adjusted / 26));
}

/** XLSX ファイルに画像を注入する。 */
export async function patchXlsxWithImages(
  inputPath: string,
  outputPath: string,
  patches: readonly SheetImagePatch[],
): Promise<void> {
  const data = await readFile(inputPath);
  const workbook = await parseWorkbook(data.buffer as ArrayBuffer);

  const updates: SheetUpdate[] = patches.map((patch) => {
    const rowHeight = patch.rowHeight ?? DEFAULT_ROW_HEIGHT;
    const colWidth = patch.colWidth ?? DEFAULT_COL_WIDTH;

    const images: ImagePlacement[] = [];
    const rows: Array<{ row: number; height: number; customHeight: boolean }> = [];
    const mergeCells: string[] = [];
    const colSet = new Set<number>();

    for (const img of patch.images) {
      const endRow = img.row + img.rowSpan - 1;

      // DrawingML アンカー (0-based)
      images.push({
        data: img.data,
        contentType: img.contentType,
        fromCol: img.col - 1,
        fromRow: img.row - 1,
        toCol: img.col,
        toRow: endRow,
      });

      // 画像領域の全行に高さを設定
      for (let r = img.row; r <= endRow; r++) {
        rows.push({ row: r, height: rowHeight, customHeight: true });
      }

      // セル結合 (画像列の縦結合)
      const colLetter = colIndexToLetter(img.col);
      mergeCells.push(`${colLetter}${img.row}:${colLetter}${endRow}`);

      colSet.add(img.col);
    }

    // 画像が配置される列の幅を設定
    const cols = [...colSet].map((col) => ({
      col,
      width: colWidth,
      customWidth: true,
    }));

    return {
      sheetName: patch.sheetName,
      cells: [],
      images,
      rows,
      cols,
      mergeCells,
    };
  });

  const result = await patchWorkbook(workbook, updates);
  await writeFile(outputPath, Buffer.from(result.xlsxBuffer));
}
