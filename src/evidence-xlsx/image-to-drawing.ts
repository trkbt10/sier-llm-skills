/**
 * @file 画像配置 → Drawing ドメインオブジェクト変換。
 *
 * ImagePlacement 的な入力仕様から XlsxDrawingAnchor + MediaPart を構築する。
 * twoCellAnchor (ECMA-376 §20.5.2.33) の構築ロジックの SoT。
 */

import { rowIdx, colIdx } from "aurochs/xlsx/domain";
import type { XlsxDrawingAnchor } from "aurochs/xlsx/domain";
import type { MediaPart } from "aurochs/xlsx/builder";
import { screenshotFormatToMime } from "./png";

/** 画像配置の入力仕様。 */
export type ImageSpec = {
  /** 画像データ。 */
  readonly data: Uint8Array;
  /** スクリーンショットフォーマット ("png" | "jpeg" | "webp")。 */
  readonly format: string;
  /** アンカー開始列 (1-based)。 */
  readonly fromCol: number;
  /** アンカー開始行 (1-based)。 */
  readonly fromRow: number;
  /** アンカー終了列 (1-based)。 */
  readonly toCol: number;
  /** アンカー終了行 (1-based)。 */
  readonly toRow: number;
  /** 表示名。 */
  readonly name?: string;
};

/** Drawing ドメインオブジェクト変換結果。 */
export type DrawingResult = {
  readonly anchors: readonly XlsxDrawingAnchor[];
  readonly mediaMap: Map<string, MediaPart>;
};

/**
 * 画像配置仕様から XlsxDrawingAnchor + MediaPart を構築する。
 *
 * relId 生成、twoCellAnchor 構築、MediaPart 紐付けの SoT。
 *
 * @see ECMA-376 Part 4, Section 20.5.2.33 (twoCellAnchor)
 * @see ECMA-376 Part 2, Section 9 (Relationships)
 */
export function buildDrawingFromImages(images: readonly ImageSpec[]): DrawingResult {
  const anchors: XlsxDrawingAnchor[] = [];
  const mediaMap = new Map<string, MediaPart>();

  for (const [idx, img] of images.entries()) {
    const relId = `rId${idx + 1}`;

    anchors.push({
      type: "twoCellAnchor",
      editAs: "oneCell",
      from: {
        col: colIdx(img.fromCol - 1),
        colOff: 0,
        row: rowIdx(img.fromRow - 1),
        rowOff: 0,
      },
      to: {
        col: colIdx(img.toCol - 1),
        colOff: 0,
        row: rowIdx(img.toRow),
        rowOff: 0,
      },
      content: {
        type: "picture",
        nvPicPr: { id: idx + 1, name: img.name ?? `Image${idx + 1}` },
        blipRelId: relId,
      },
    });

    mediaMap.set(relId, {
      data: img.data,
      contentType: screenshotFormatToMime(img.format),
    });
  }

  return { anchors, mediaMap };
}
