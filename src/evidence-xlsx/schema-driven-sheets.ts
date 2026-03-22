/**
 * @file スキーマ駆動シートビルダー。
 *
 * ハードコードされた buildSummarySheet / buildEvidenceSheet を置き換え、
 * EvidenceSheetSchema に基づいて柔軟にシートを構築する。
 */

import { rowIdx, colIdx, styleId } from "aurochs/xlsx/domain";
import type {
  XlsxWorksheet, XlsxRow, XlsxDrawingAnchor, CellRange, CellAddress,
  Cell,
} from "aurochs/xlsx/domain";
import type { MediaPart } from "aurochs/xlsx/builder";
import type {
  EvidenceTestCase, EvidenceStep, EvidenceSheetSchema,
} from "../evidence-schema/types";
import { strCell, numCell, emptyCell, formatDateTime, sanitizeSheetName } from "./xlsx-cells";
import { screenshotFormatToMime, computeImageExtent } from "./png";

/** シート構築結果。 */
export type EvidenceSheetResult = {
  readonly sheet: XlsxWorksheet;
  readonly mediaMap: Map<string, MediaPart>;
};

/** スクリーンショット行の高さ (pt)。 */
const SCREENSHOT_ROW_HEIGHT = 20;

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

/**
 * スキーマ定義に基づいてエビデンスシートを構築する。
 */
export function buildEvidenceSheetFromSchema(
  schemaEvidence: EvidenceSheetSchema["evidenceSheet"],
  testCases: readonly EvidenceTestCase[],
): EvidenceSheetResult {
  const { columns, screenshot, headerRow } = schemaEvidence;
  const imageRowSpan = screenshot.imageRowSpan;
  const s = styleId(0);

  // ヘッダー行
  const headerCells: Cell[] = columns.map((col) =>
    strCell(col.columnIndex, headerRow, col.header, s),
  );
  const headerXlsxRow: XlsxRow = {
    rowNumber: rowIdx(headerRow),
    cells: headerCells,
  };

  const rows: XlsxRow[] = [headerXlsxRow];
  const anchors: XlsxDrawingAnchor[] = [];
  const mediaMap = new Map<string, MediaPart>();
  const mergeCells: CellRange[] = [];

  // 全テストケースのステップを平坦化
  const allSteps = testCases.flatMap((tc) =>
    tc.steps.map((step) => ({ step, testCase: tc })),
  );

  for (const [idx, { step, testCase }] of allSteps.entries()) {
    const dataRow = headerRow + 1 + idx * imageRowSpan;
    const blockEndRow = dataRow + imageRowSpan - 1;

    // 先頭行: フィールド値を埋める
    const dataCells: Cell[] = columns.map((col) => {
      const value = resolveFieldValue(col.field, step, testCase);
      if (col.field === "stepNumber") {
        return numCell(col.columnIndex, dataRow, step.stepNumber, s);
      }
      return strCell(col.columnIndex, dataRow, value, s);
    });
    // スクリーンショット列は空セル
    dataCells.push(emptyCell(screenshot.columnIndex, dataRow, s));

    rows.push({
      rowNumber: rowIdx(dataRow),
      height: SCREENSHOT_ROW_HEIGHT,
      customHeight: true,
      cells: dataCells,
    });

    // 残りの行 (空セル付きで dimension を正しく広げる)
    for (const r of Array.from({ length: imageRowSpan - 1 }, (_, i) => dataRow + 1 + i)) {
      rows.push({
        rowNumber: rowIdx(r),
        height: SCREENSHOT_ROW_HEIGHT,
        customHeight: true,
        cells: [emptyCell(1, r, s)],
      });
    }

    // 各カラムを縦結合
    for (const col of columns) {
      mergeCells.push(mergeRange(col.columnIndex, dataRow, col.columnIndex, blockEndRow));
    }
    // スクリーンショット列を結合
    mergeCells.push(mergeRange(screenshot.columnIndex, dataRow, screenshot.columnIndex, blockEndRow));

    // twoCellAnchor
    const relId = `rId${idx + 1}`;

    const extent = computeImageExtent(step.screenshot);

    anchors.push({
      type: "twoCellAnchor",
      editAs: "oneCell",
      from: {
        col: colIdx(screenshot.columnIndex - 1),
        colOff: 0,
        row: rowIdx(dataRow - 1),
        rowOff: 0,
      },
      to: {
        col: colIdx(screenshot.columnIndex),
        colOff: 0,
        row: rowIdx(blockEndRow),
        rowOff: 0,
      },
      content: {
        type: "picture",
        nvPicPr: { id: idx + 1, name: `Screenshot${idx + 1}` },
        blipRelId: relId,
        extent,
      },
    });

    mediaMap.set(relId, {
      data: step.screenshot,
      contentType: screenshotFormatToMime(step.screenshotFormat),
    });
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
        width: 70,
      },
    ],
    mergeCells,
    drawing: { anchors },
    xmlPath: "xl/worksheets/sheet1.xml",
  };

  return { sheet, mediaMap };
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
