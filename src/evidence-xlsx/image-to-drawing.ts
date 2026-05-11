/**
 * @file 画像配置 → Drawing ドメインオブジェクト変換。
 *
 * ImagePlacement 的な入力仕様から XlsxDrawingAnchor + MediaPart を構築する。
 * twoCellAnchor (ECMA-376 §20.5.2.33) の構築ロジックの SoT。
 */

import { rowIdx, colIdx } from "aurochs/xlsx/domain";
import type { XlsxDrawingAnchor } from "aurochs/xlsx/domain";
import type { MediaPart } from "aurochs/xlsx/builder";
import { readPngDimensions, screenshotFormatToMime } from "./png";

/** 1 px = 9525 EMU @ 96 dpi (DrawingML 標準)。 */
const EMU_PER_PX = 9525;
/** Excel の標準列幅 1 文字 = 約 7.0 px。実測値は環境依存だが目安として使用。 */
const PX_PER_CHAR_WIDTH = 7;
/** ポイント = EMU 換算 (1 pt = 12700 EMU)。 */
const EMU_PER_POINT = 12700;

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
  /**
   * アンカー終了列 (1-based)。
   * 注意: 内部で colIdx(toCol - 1) する。「画像の右辺が来る列の 1-based 番号」
   * を渡す (= 最終占有列 + 1)。例: 列 5 だけを占める画像なら toCol = 6。
   */
  readonly toCol: number;
  /**
   * アンカー終了行 (1-based)。
   * 注意: 内部で rowIdx(toRow) (-1 なし) する。
   * 「画像が占める最終行 (inclusive) の 1-based 番号」を渡す。
   * 例: 行 2-11 を占める画像なら toRow = 11。toCol と慣習が違うので注意。
   */
  readonly toRow: number;
  /** 表示名。 */
  readonly name?: string;
};

/** Drawing ドメインオブジェクト変換結果。 */
export type DrawingResult = {
  readonly anchors: readonly XlsxDrawingAnchor[];
  readonly mediaMap: Map<string, MediaPart>;
};

/** アスペクト保持画像配置の入力仕様。 */
export type AspectAwareImageSpec = {
  readonly data: Uint8Array;
  readonly format: string;
  /** アンカー開始列 (1-based)。画像はこの列の左端から配置される。 */
  readonly fromCol: number;
  /** アンカー開始行 (1-based)。画像はこの行の上端から配置される。 */
  readonly fromRow: number;
  /**
   * 画像幅をフィットさせる対象の表示幅 (px)。
   * 縦長画像で displayMaxHeightPx を超える高さになる場合は、
   * 高さに合わせて幅も縮小される (アスペクト保持)。
   */
  readonly displayWidthPx: number;
  /**
   * 画像の最大表示高さ (px)。これを超える場合は幅を縮めて高さを抑える。
   * 省略時は displayWidthPx と同じ値 (= 最長辺 displayWidthPx)。
   */
  readonly displayMaxHeightPx?: number;
  readonly name?: string;
};

/** アスペクト保持配置の結果。 */
export type AspectAwarePlacement = {
  /** anchor 自体。 */
  readonly anchor: XlsxDrawingAnchor;
  /** 画像が占める高さ (px)。caller が行高さを設定するために使う。 */
  readonly heightPx: number;
};

export type AspectAwareDrawingResult = {
  readonly anchors: readonly XlsxDrawingAnchor[];
  readonly placements: readonly AspectAwarePlacement[];
  readonly mediaMap: Map<string, MediaPart>;
};

/**
 * 列幅にフィットさせ、アスペクト比を維持して oneCellAnchor で画像を配置する。
 *
 * 元画像の (width, height) を PNG ヘッダから読み、displayWidthPx に合わせて
 * 高さを比例縮小する。配置は oneCellAnchor (from セル + EMU 寸法) で行う。
 *
 * @see ECMA-376 Part 4, Section 20.5.2.18 (oneCellAnchor)
 */
export function buildAspectAwareDrawing(images: readonly AspectAwareImageSpec[]): AspectAwareDrawingResult {
  const anchors: XlsxDrawingAnchor[] = [];
  const placements: AspectAwarePlacement[] = [];
  const mediaMap = new Map<string, MediaPart>();

  for (const [idx, img] of images.entries()) {
    const relId = `rId${idx + 1}`;
    const dims = readPngDimensions(img.data);
    // PNG 寸法不明時は正方形と仮定 (壊さないためのフォールバック)。
    const aspect = dims !== undefined && dims.width > 0 ? dims.height / dims.width : 1;
    // displayMaxHeightPx が指定されてれば、高さがそれを超えないよう幅を再計算。
    const maxH = img.displayMaxHeightPx ?? img.displayWidthPx;
    const naive = { w: img.displayWidthPx, h: img.displayWidthPx * aspect };
    const fit = naive.h > maxH ? { w: maxH / aspect, h: maxH } : naive;
    const widthPx = Math.round(fit.w);
    const heightPx = Math.round(fit.h);
    const cx = widthPx * EMU_PER_PX;
    const cy = heightPx * EMU_PER_PX;

    anchors.push({
      type: "oneCellAnchor",
      from: {
        col: colIdx(img.fromCol - 1),
        colOff: 0,
        row: rowIdx(img.fromRow - 1),
        rowOff: 0,
      },
      ext: { cx, cy },
      content: {
        type: "picture",
        nvPicPr: { id: idx + 1, name: img.name ?? `Image${idx + 1}` },
        blipRelId: relId,
      },
    });

    placements.push({ anchor: anchors[anchors.length - 1], heightPx });

    mediaMap.set(relId, {
      data: img.data,
      contentType: screenshotFormatToMime(img.format),
    });
  }

  return { anchors, placements, mediaMap };
}

/**
 * 列幅 (文字単位) から、表示幅 (px) を概算する。
 * Excel の列幅は「'0'..'9' の文字を 7 px 幅と仮定」が伝統的な近似値。
 */
export function colWidthToPx(columnWidthChars: number): number {
  return Math.round(columnWidthChars * PX_PER_CHAR_WIDTH);
}

/** px → 行高さ (point)。Excel の行高さは pt 単位。1 pt = 12700 EMU、1 px = 9525 EMU。 */
export function pxToRowHeightPt(heightPx: number): number {
  // px → EMU → pt
  return (heightPx * EMU_PER_PX) / EMU_PER_POINT;
}

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
