/**
 * @file XLSX への画像注入。
 *
 * aurochs の patchWorkbook (drawing サポート) を使って
 * 既存 XLSX に画像を埋め込む。
 */

import { parseWorkbook } from "aurochs/xlsx/parser";
import { patchWorkbook } from "aurochs/xlsx/patcher";
import type { SheetUpdate } from "aurochs/xlsx/patcher";
import type { MediaPart } from "aurochs/xlsx/builder";
import { rowIdx, colIdx } from "aurochs/xlsx/domain";
import type { XlsxDrawing, XlsxDrawingAnchor } from "aurochs/xlsx/domain";
import { readFile, writeFile } from "node:fs/promises";
import { computeImageExtent } from "../evidence-xlsx/png";

/** 画像挿入指定。 */
export type ImageInsert = {
  /** 画像データ (PNG)。 */
  readonly data: Uint8Array;
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

  const updates: SheetUpdate[] = patches.map((patch) => {
    const anchors: XlsxDrawingAnchor[] = [];
    const mediaMap = new Map<string, MediaPart>();

    for (const [idx, img] of patch.images.entries()) {
      const relId = `rId_img_${idx + 1}`;
      const extent = computeImageExtent(img.data);

      anchors.push({
        type: "twoCellAnchor",
        editAs: "oneCell",
        from: { col: colIdx(img.fromCol), colOff: 0, row: rowIdx(img.fromRow), rowOff: 0 },
        to: { col: colIdx(img.toCol), colOff: 0, row: rowIdx(img.toRow), rowOff: 0 },
        content: {
          type: "picture",
          nvPicPr: { id: idx + 1, name: `Screenshot${idx + 1}` },
          blipRelId: relId,
          extent,
        },
      });

      mediaMap.set(relId, {
        data: img.data,
        contentType: "image/png",
      });
    }

    const drawing: XlsxDrawing = { anchors };

    return {
      sheetName: patch.sheetName,
      cells: [],
      drawing,
      media: mediaMap,
    };
  });

  const result = await patchWorkbook(workbook, updates);
  await writeFile(outputPath, Buffer.from(result.xlsxBuffer));
}
