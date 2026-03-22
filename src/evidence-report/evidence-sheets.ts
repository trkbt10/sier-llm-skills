/**
 * @file エビデンスシート構築。
 *
 * Summary シートと各テストケースの Evidence シートを
 * aurochs ドメインオブジェクトとして組み立てる。
 */

import { rowIdx, colIdx, styleId } from "aurochs/xlsx/domain";
import type {
  XlsxWorksheet, XlsxRow, XlsxDrawingAnchor, CellRange, CellAddress,
  Cell,
} from "aurochs/xlsx/domain";
import type { MediaPart } from "aurochs/xlsx/builder";
import type { EvidenceReport, EvidenceTestCase, TemplateConfig } from "./types";
import { strCell, numCell, emptyCell, formatDateTime, sanitizeSheetName } from "./xlsx-cells";
import { screenshotFormatToMime } from "./png";

/** 画像1枚分の行スペース */
const IMAGE_ROW_SPAN = 15;
/** スクリーンショット行の高さ (pt) */
const SCREENSHOT_ROW_HEIGHT = 20;
/** CellAddress を簡易に作成する。 */
function addr(col: number, row: number): CellAddress {
  return { col: colIdx(col), row: rowIdx(row), colAbsolute: false, rowAbsolute: false };
}

/** セル結合範囲を作成する。 */
function mergeRange(startCol: number, startRow: number, endCol: number, endRow: number): CellRange {
  return { start: addr(startCol, startRow), end: addr(endCol, endRow) };
}

/** テスト結果サマリーシートを構築する。 */
export function buildSummarySheet(report: EvidenceReport, sheetIndex = 1): XlsxWorksheet {
  const headers = ["No.", "Test Case", "URL", "Status", "Started At", "Duration (sec)"];
  const headerRow: XlsxRow = {
    rowNumber: rowIdx(1),
    cells: headers.map((h, i) => strCell(i + 1, 1, h, styleId(1))),
    height: 24,
    customHeight: true,
  };

  const dataRows: XlsxRow[] = report.testCases.map((tc, i) => {
    const rowNum = i + 2;
    const durationSec = (tc.finishedAt.getTime() - tc.startedAt.getTime()) / 1000;
    const statusStyle = tc.status === "pass" ? styleId(3) : styleId(4);
    const cellStyle = i % 2 === 0 ? styleId(2) : styleId(6);

    return {
      rowNumber: rowIdx(rowNum),
      cells: [
        numCell(1, rowNum, i + 1, cellStyle),
        strCell(2, rowNum, tc.name, cellStyle),
        strCell(3, rowNum, tc.url, cellStyle),
        strCell(4, rowNum, tc.status.toUpperCase(), statusStyle),
        strCell(5, rowNum, formatDateTime(tc.startedAt), cellStyle),
        numCell(6, rowNum, Math.round(durationSec * 100) / 100, cellStyle),
      ],
    };
  });

  return {
    dateSystem: "1900",
    name: "Summary",
    sheetId: sheetIndex,
    state: "visible",
    rows: [headerRow, ...dataRows],
    columns: [
      { min: colIdx(1), max: colIdx(1), width: 6 },
      { min: colIdx(2), max: colIdx(2), width: 30 },
      { min: colIdx(3), max: colIdx(3), width: 40 },
      { min: colIdx(4), max: colIdx(4), width: 10 },
      { min: colIdx(5), max: colIdx(5), width: 22 },
      { min: colIdx(6), max: colIdx(6), width: 16 },
    ],
    xmlPath: `xl/worksheets/sheet${sheetIndex}.xml`,
  };
}

export type EvidenceSheetResult = {
  sheet: XlsxWorksheet;
  mediaMap: ReadonlyMap<string, MediaPart>;
};

/** テストケースのエビデンスシートを構築する。 */
export function buildEvidenceSheet(
  tc: EvidenceTestCase,
  sheetIndex: number,
): EvidenceSheetResult {
  const headers = ["Step", "Action", "Expected", "Actual", "Screenshot"];
  const headerRow: XlsxRow = {
    rowNumber: rowIdx(1),
    cells: headers.map((h, i) => strCell(i + 1, 1, h, styleId(1))),
    height: 24,
    customHeight: true,
  };

  const rows: XlsxRow[] = [headerRow];
  const anchors: XlsxDrawingAnchor[] = [];
  const mediaMap = new Map<string, MediaPart>();
  const mergeCells: CellRange[] = [];

  for (const [stepIdx, step] of tc.steps.entries()) {
    const dataRow = 2 + stepIdx * IMAGE_ROW_SPAN;
    const screenshotEndRow = dataRow + IMAGE_ROW_SPAN - 1;

    // データ行 (先頭行にテキスト、残り行は行高さのみ)
    rows.push({
      rowNumber: rowIdx(dataRow),
      height: SCREENSHOT_ROW_HEIGHT,
      customHeight: true,
      cells: [
        numCell(1, dataRow, step.stepNumber, styleId(2)),
        strCell(2, dataRow, step.action, styleId(2)),
        strCell(3, dataRow, step.expected, styleId(2)),
        strCell(4, dataRow, step.actual, styleId(2)),
        emptyCell(5, dataRow, styleId(2)),
      ],
    });

    for (const r of Array.from({ length: IMAGE_ROW_SPAN - 1 }, (_, i) => dataRow + 1 + i)) {
      rows.push({
        rowNumber: rowIdx(r),
        height: SCREENSHOT_ROW_HEIGHT,
        customHeight: true,
        cells: [],
      });
    }

    // データセルを縦結合 (A〜D列)
    for (const col of [1, 2, 3, 4]) {
      mergeCells.push(mergeRange(col, dataRow, col, screenshotEndRow));
    }
    // スクリーンショット列を結合 (E列)
    mergeCells.push(mergeRange(5, dataRow, 5, screenshotEndRow));

    // twoCellAnchor: セル範囲にぴったり合わせる
    const relId = `rId${stepIdx + 1}`;

    anchors.push({
      type: "twoCellAnchor",
      editAs: "oneCell",
      from: {
        col: colIdx(4), colOff: 0,
        row: rowIdx(dataRow - 1), rowOff: 0,
      },
      to: {
        col: colIdx(5), colOff: 0,
        row: rowIdx(screenshotEndRow), rowOff: 0,
      },
      content: {
        type: "picture",
        nvPicPr: { id: stepIdx + 1, name: `Screenshot${stepIdx + 1}` },
        blipRelId: relId,
      },
    });

    mediaMap.set(relId, {
      data: step.screenshot,
      contentType: screenshotFormatToMime(step.screenshotFormat),
    });
  }

  const sheet: XlsxWorksheet = {
    dateSystem: "1900",
    name: sanitizeSheetName(tc.name),
    sheetId: sheetIndex,
    state: "visible",
    rows,
    columns: [
      { min: colIdx(1), max: colIdx(1), width: 8 },
      { min: colIdx(2), max: colIdx(2), width: 30 },
      { min: colIdx(3), max: colIdx(3), width: 30 },
      { min: colIdx(4), max: colIdx(4), width: 30 },
      { min: colIdx(5), max: colIdx(5), width: 70 },
    ],
    mergeCells,
    drawing: { anchors },
    xmlPath: `xl/worksheets/sheet${sheetIndex}.xml`,
  };

  return { sheet, mediaMap };
}

// =============================================================================
// テンプレートシートへのデータ注入
// =============================================================================

/**
 * テンプレートのシートにエビデンスデータを注入する。
 * テンプレートのヘッダー行と列幅を維持し、データ行を追加する。
 */
export function injectIntoTemplateSheet(
  templateSheet: XlsxWorksheet,
  testCases: readonly EvidenceTestCase[],
  config: TemplateConfig,
): EvidenceSheetResult {
  const imageRowSpan = config.imageRowSpan ?? IMAGE_ROW_SPAN;

  // テンプレートのヘッダー行までの既存行を保持
  const existingRows = templateSheet.rows.filter(
    (r: XlsxRow) => r.rowNumber <= config.headerRow,
  );

  // ヘッダー行直下のテンプレート行からデータ行のスタイルを取得 (あれば)
  const templateDataRow = templateSheet.rows.find(
    (r: XlsxRow) => r.rowNumber === config.headerRow + 1,
  );
  const templateDataStyleId = templateDataRow?.cells[0]?.styleId;

  const dataRows: XlsxRow[] = [];
  const anchors: XlsxDrawingAnchor[] = [];
  const mediaMap = new Map<string, MediaPart>();
  const mergeCells: CellRange[] = [...(templateSheet.mergeCells ?? [])];
  const cols = config.columns;

  // 使用されている列番号を収集 (セル結合用)
  const usedColumns = Object.values(cols).filter((v): v is number => v !== undefined);
  const maxCol = Math.max(...usedColumns, config.screenshotColumn);

  const allSteps = testCases.flatMap((tc) =>
    tc.steps.map((step) => ({ step, testCase: tc })),
  );

  for (const [idx, { step, testCase }] of allSteps.entries()) {
    const dataRow = config.headerRow + 1 + idx * imageRowSpan;
    const screenshotEndRow = dataRow + imageRowSpan - 1;
    const s = templateDataStyleId;

    const cells: Cell[] = [];
    if (cols.stepNumber) {
      cells.push(numCell(cols.stepNumber, dataRow, step.stepNumber, s));
    }
    if (cols.testCaseId) {
      cells.push(strCell(cols.testCaseId, dataRow, testCase.name, s));
    }
    if (cols.action) {
      cells.push(strCell(cols.action, dataRow, step.action, s));
    }
    if (cols.expected) {
      cells.push(strCell(cols.expected, dataRow, step.expected, s));
    }
    if (cols.actual) {
      cells.push(strCell(cols.actual, dataRow, step.actual, s));
    }
    if (cols.status) {
      cells.push(strCell(cols.status, dataRow, testCase.status.toUpperCase(), s));
    }
    if (cols.timestamp) {
      cells.push(strCell(cols.timestamp, dataRow, formatDateTime(step.timestamp), s));
    }

    dataRows.push({
      rowNumber: rowIdx(dataRow),
      height: SCREENSHOT_ROW_HEIGHT,
      customHeight: true,
      cells,
    });

    // スクリーンショット領域の行高さ
    for (const r of Array.from({ length: imageRowSpan - 1 }, (_, i) => dataRow + 1 + i)) {
      dataRows.push({
        rowNumber: rowIdx(r),
        height: SCREENSHOT_ROW_HEIGHT,
        customHeight: true,
        cells: [],
      });
    }

    // データ列を縦結合
    for (const col of usedColumns) {
      mergeCells.push(mergeRange(col, dataRow, col, screenshotEndRow));
    }
    // スクリーンショット列を結合
    mergeCells.push(mergeRange(config.screenshotColumn + 1, dataRow, maxCol + 1, screenshotEndRow));

    // twoCellAnchor: セル範囲にぴったり合わせる
    const relId = `rId${idx + 1}`;

    anchors.push({
      type: "twoCellAnchor",
      editAs: "oneCell",
      from: {
        col: colIdx(config.screenshotColumn),
        colOff: 0,
        row: rowIdx(dataRow - 1),
        rowOff: 0,
      },
      to: {
        col: colIdx(maxCol + 1),
        colOff: 0,
        row: rowIdx(screenshotEndRow),
        rowOff: 0,
      },
      content: {
        type: "picture",
        nvPicPr: { id: idx + 1, name: `Screenshot${idx + 1}` },
        blipRelId: relId,
      },
    });

    mediaMap.set(relId, {
      data: step.screenshot,
      contentType: screenshotFormatToMime(step.screenshotFormat),
    });
  }

  const sheet: XlsxWorksheet = {
    ...templateSheet,
    rows: [...existingRows, ...dataRows],
    mergeCells,
    drawing: { anchors },
  };

  return { sheet, mediaMap };
}
