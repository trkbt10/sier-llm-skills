/**
 * @file スキーマ駆動シートビルダー。
 *
 * ハードコードされた buildSummarySheet / buildEvidenceSheet を置き換え、
 * EvidenceSheetSchema に基づいて柔軟にシートを構築する。
 */

import { rowIdx, colIdx, styleId } from "aurochs/xlsx/domain";
import type {
  XlsxWorksheet, XlsxRow, CellRange, CellAddress,
  Cell, StyleId,
} from "aurochs/xlsx/domain";
import type { MediaPart } from "aurochs/xlsx/builder";
import type {
  EvidenceTestCase, EvidenceStep, EvidenceSheetSchema,
} from "../evidence-schema/types";
import { strCell, numCell, emptyCell, formatDateTime, sanitizeSheetName } from "./xlsx-cells";
import {
  buildAspectAwareDrawing,
  pxToRowHeightPt,
  type AspectAwareImageSpec,
} from "./image-to-drawing";

/** シート構築結果。 */
export type EvidenceSheetResult = {
  readonly sheet: XlsxWorksheet;
  readonly mediaMap: Map<string, MediaPart>;
};

/** スクリーンショット列のデフォルト幅 (文字単位)。 */
const DEFAULT_SCREENSHOT_COL_WIDTH = 50;
/**
 * 画像の長辺ターゲット (px)。長辺をこのサイズに合わせ、短辺はアスペクト比から計算。
 * 横長画像は幅 = 300, 縦長画像は高さ = 300 になる。
 * 紙ベースで「読める」サイズ目安: 300px @ 96 dpi ≈ 8 cm。
 */
const LONG_EDGE_TARGET_PX = 320;
/** 操作行の最低行高さ (pt)。テキスト 3-4 行入る目安。 */
const MIN_OP_ROW_HEIGHT_PT = 80;

/** CellAddress を簡易に作成する。 */
function addr(col: number, row: number): CellAddress {
  return { col: colIdx(col), row: rowIdx(row), colAbsolute: false, rowAbsolute: false };
}

/** セル結合範囲を作成する。 */
function mergeRange(startCol: number, startRow: number, endCol: number, endRow: number): CellRange {
  return { start: addr(startCol, startRow), end: addr(endCol, endRow) };
}

/**
 * 既知のフィールド名からステップ/テストケースの値を解決する。
 *
 * 未知のフィールドは空文字列を返す (LLM が write_test_result で埋める想定)。
 */
export function resolveFieldValue(field: string, step: EvidenceStep, testCase: EvidenceTestCase): string {
  switch (field) {
    case "stepNumber":
      return String(step.stepNumber);
    case "action":
      return step.action;
    case "expected":
      return step.expected;
    case "actual":
      return step.actual;
    case "status":
      return testCase.status.toUpperCase();
    case "timestamp":
      return formatDateTime(step.timestamp);
    case "testCaseId":
      return testCase.name;
    case "url":
      return step.url;
    default:
      return "";
  }
}

/** EvidenceStep が section (見出し) 行かを判定する。 */
function isSectionStepLocal(step: EvidenceStep): boolean {
  return step.screenshot.length === 0;
}

/**
 * 列幅 (文字単位) とテキスト長から、wrapText 後に必要な行数を概算する。
 *
 * 厳密には font/dpi 依存だが、ヒューリスティクスとして
 * 「文字数 / 列幅(文字数) を切り上げ + 改行数」を使う。
 * 全角文字は 2 文字幅相当として粗く扱う。
 */
function estimateWrappedLines(text: string, columnWidthChars: number): number {
  if (text === "") {
    return 1;
  }
  const lines = text.split("\n");
  const total = lines.reduce((sum, line) => {
    // 全角文字 = 2 幅。簡易判定: 半角範囲外は全角。
    const width = [...line].reduce((w, ch) => {
      const code = ch.charCodeAt(0);
      return w + (code < 0x80 ? 1 : 2);
    }, 0);
    return sum + Math.max(1, Math.ceil(width / columnWidthChars));
  }, 0);
  return total;
}

/** 行数からテキスト表示に必要な pt 高さを概算 (1 行 ≈ 15 pt @ Calibri 11)。 */
function linesToHeightPt(lines: number): number {
  return lines * 15;
}

/** 列ごとのテキストから「セルに wrap して入れたとき必要な高さ」を概算する。 */
function estimateTextRowHeightPt(
  step: EvidenceStep,
  testCase: EvidenceTestCase,
  columns: EvidenceSheetSchema["evidenceSheet"]["columns"],
): number {
  const heights = columns.map((col) => {
    const value = resolveFieldValue(col.field, step, testCase);
    const widthChars = col.width ?? 20;
    return linesToHeightPt(estimateWrappedLines(value, widthChars));
  });
  return Math.max(...heights);
}

/** Section 行を 1 行だけ描画する。データ列を結合して action を表示。 */
function renderSectionRow(args: {
  readonly dataRow: number;
  readonly step: EvidenceStep;
  readonly columns: EvidenceSheetSchema["evidenceSheet"]["columns"];
  readonly screenshot: EvidenceSheetSchema["evidenceSheet"]["screenshot"];
  readonly rows: XlsxRow[];
  readonly mergeCells: CellRange[];
  readonly styleId: StyleId;
}): void {
  const { dataRow, step, columns, screenshot, rows, mergeCells } = args;
  const minCol = Math.min(...columns.map((c) => c.columnIndex));
  const maxCol = Math.max(...columns.map((c) => c.columnIndex));

  const cells: Cell[] = [
    strCell(minCol, dataRow, `■ ${step.action}`, args.styleId),
  ];
  // 結合される側 (visual 上は隠れる) のために空セルを並べる
  for (const col of columns) {
    if (col.columnIndex === minCol) {
      continue;
    }
    cells.push(emptyCell(col.columnIndex, dataRow, args.styleId));
  }
  cells.push(emptyCell(screenshot.columnIndex, dataRow, args.styleId));

  rows.push({
    rowNumber: rowIdx(dataRow),
    cells,
  });

  if (maxCol > minCol) {
    mergeCells.push(mergeRange(minCol, dataRow, maxCol, dataRow));
  }
}

/**
 * 1 つの操作行を描画する。
 * 行は 1 行で、スクリーンショット画像のアスペクト比に合わせて高さを設定する。
 */
function renderOperationRow(args: {
  readonly dataRow: number;
  readonly step: EvidenceStep;
  readonly testCase: EvidenceTestCase;
  readonly columns: EvidenceSheetSchema["evidenceSheet"]["columns"];
  readonly screenshot: EvidenceSheetSchema["evidenceSheet"]["screenshot"];
  readonly screenshotColWidthPx: number;
  readonly rows: XlsxRow[];
  readonly imageSpecs: AspectAwareImageSpec[];
  readonly imageCount: number;
  readonly styleId: StyleId;
}): void {
  const { dataRow, step, testCase, columns, screenshot, screenshotColWidthPx, rows, imageSpecs, imageCount } = args;

  const dataCells: Cell[] = columns.map((col) => {
    const value = resolveFieldValue(col.field, step, testCase);
    if (col.field === "stepNumber") {
      return numCell(col.columnIndex, dataRow, step.stepNumber, args.styleId);
    }
    return strCell(col.columnIndex, dataRow, value, args.styleId);
  });
  dataCells.push(emptyCell(screenshot.columnIndex, dataRow, args.styleId));

  imageSpecs.push({
    data: step.screenshot,
    format: step.screenshotFormat,
    fromCol: screenshot.columnIndex,
    fromRow: dataRow,
    // 長辺ターゲットを displayWidthPx に渡し、displayMaxHeightPx で
    // 縦長画像の場合の高さ上限を同じ値にする (= 長辺 = 320px)。
    displayWidthPx: screenshotColWidthPx,
    displayMaxHeightPx: screenshotColWidthPx,
    name: `Screenshot${imageCount}`,
  });

  rows.push({
    rowNumber: rowIdx(dataRow),
    // 行の高さは後で placement を見て更新する (この時点では仮設定)。
    cells: dataCells,
  });
}

/**
 * スキーマ定義に基づいてエビデンスシートを構築する。
 *
 * 操作行は 1 行ずつ。スクリーンショット画像はスクリーンショット列の幅に
 * フィットし、アスペクト比を保って縮小される。行高さは画像高さに合わせる。
 * セクション行は 1 行で、データ列を横結合して見出しを表示する。
 */
export function buildEvidenceSheetFromSchema(
  schemaEvidence: EvidenceSheetSchema["evidenceSheet"],
  testCases: readonly EvidenceTestCase[],
): EvidenceSheetResult {
  const { columns, screenshot, headerRow } = schemaEvidence;
  // style id 1 = ヘッダー (中央寄せ青背景白文字), 2 = データ (wrapText+top+border)
  const headerStyle = styleId(1);
  const dataStyle = styleId(2);

  const screenshotColWidthChars = DEFAULT_SCREENSHOT_COL_WIDTH;
  // 画像の長辺ターゲット (px)。横長 → 幅 = この値、縦長 → 高さ = この値。
  const imageLongEdgePx = LONG_EDGE_TARGET_PX;

  // ヘッダー行
  const headerCells: Cell[] = columns.map((col) =>
    strCell(col.columnIndex, headerRow, col.header, headerStyle),
  );
  const headerXlsxRow: XlsxRow = {
    rowNumber: rowIdx(headerRow),
    cells: headerCells,
  };

  const rows: XlsxRow[] = [headerXlsxRow];
  const imageSpecs: AspectAwareImageSpec[] = [];
  const mergeCells: CellRange[] = [];
  // 操作行の rowNumber → rows[] の index (placement 確定後に高さを更新するため)
  const opRowIndices: number[] = [];

  const allSteps = testCases.flatMap((tc) =>
    tc.steps.map((step) => ({ step, testCase: tc })),
  );

  const ctx = { cursorRow: headerRow + 1, imageCount: 0 };

  for (const { step, testCase } of allSteps) {
    const isSection = isSectionStepLocal(step);
    const dataRow = ctx.cursorRow;

    if (isSection) {
      renderSectionRow({ dataRow, step, columns, screenshot, rows, mergeCells, styleId: dataStyle });
      ctx.cursorRow += 1;
      continue;
    }

    ctx.imageCount += 1;
    renderOperationRow({
      dataRow, step, testCase, columns, screenshot,
      screenshotColWidthPx: imageLongEdgePx,
      rows, imageSpecs, imageCount: ctx.imageCount, styleId: dataStyle,
    });
    opRowIndices.push(rows.length - 1);
    ctx.cursorRow += 1;
  }

  const drawingResult = buildAspectAwareDrawing(imageSpecs);

  // 行高さは「画像高さ」「テキストを wrap した時に必要な高さ」「最低高さ」の max。
  // これにより縦長画像と長文テキストの両方を 1 行で見せられる。
  const opStepIter = allSteps.filter((s) => !isSectionStepLocal(s.step));
  for (const [i, placement] of drawingResult.placements.entries()) {
    const rowIndex = opRowIndices[i];
    const imgHeightPt = pxToRowHeightPt(placement.heightPx);
    const { step, testCase } = opStepIter[i];
    const textHeightPt = estimateTextRowHeightPt(step, testCase, columns);
    const heightPt = Math.max(imgHeightPt, textHeightPt, MIN_OP_ROW_HEIGHT_PT);
    rows[rowIndex] = {
      ...rows[rowIndex],
      height: heightPt,
      customHeight: true,
    };
  }

  const sheet: XlsxWorksheet = {
    dateSystem: "1900",
    name: sanitizeSheetName(schemaEvidence.sheetName),
    sheetId: 1,
    state: "visible",
    rows,
    columns: [
      ...columns.map((col) => ({
        min: colIdx(col.columnIndex),
        max: colIdx(col.columnIndex),
        width: col.width ?? 20,
      })),
      {
        min: colIdx(screenshot.columnIndex),
        max: colIdx(screenshot.columnIndex),
        width: screenshotColWidthChars,
      },
    ],
    mergeCells,
    drawing: { anchors: drawingResult.anchors },
    xmlPath: "xl/worksheets/sheet1.xml",
  };

  return { sheet, mediaMap: drawingResult.mediaMap };
}

/**
 * 表紙シートのフィールドからセル更新リストを返す。
 *
 * 実際の値は LLM が write_test_result で埋めるため、
 * ここではフィールド定義から位置情報のみを抽出する。
 */
export function buildCoverSheetValues(
  schema: EvidenceSheetSchema["coverSheet"],
): Array<{ col: string; row: number; value: string | number }> {
  if (!schema) {
    return [];
  }
  return schema.fields.map((f) => ({
    col: f.valuePosition.col,
    row: f.valuePosition.row,
    value: f.label,
  }));
}
