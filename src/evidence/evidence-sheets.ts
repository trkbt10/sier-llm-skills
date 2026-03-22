/**
 * @file エビデンスシート構築。
 *
 * Summary シートと各テストケースの Evidence シートを
 * aurochs ドメインオブジェクトとして組み立てる。
 */

import { rowIdx, colIdx, styleId } from "aurochs/xlsx/domain";
import type {
  XlsxWorksheet, XlsxRow, XlsxDrawing, XlsxDrawingAnchor,
} from "aurochs/xlsx/domain";
import type { MediaPart } from "aurochs/xlsx/builder";
import type { EvidenceReport, EvidenceTestCase } from "./types";
import { strCell, numCell, emptyCell, formatDateTime, sanitizeSheetName } from "./xlsx-cells";
import { computeImageExtent, screenshotFormatToMime } from "./png";

/** 画像1枚分の行スペース */
const IMAGE_ROW_SPAN = 15;

/** テスト結果サマリーシートを構築する。 */
export function buildSummarySheet(report: EvidenceReport): XlsxWorksheet {
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
    sheetId: 1,
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
    xmlPath: "xl/worksheets/sheet1.xml",
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

  for (const [stepIdx, step] of tc.steps.entries()) {
    const currentRow = 2 + stepIdx * (IMAGE_ROW_SPAN + 1);

    rows.push({
      rowNumber: rowIdx(currentRow),
      cells: [
        numCell(1, currentRow, step.stepNumber, styleId(2)),
        strCell(2, currentRow, step.action, styleId(2)),
        strCell(3, currentRow, step.expected, styleId(2)),
        strCell(4, currentRow, step.actual, styleId(2)),
        emptyCell(5, currentRow, styleId(2)),
      ],
    });

    const relId = `rId${stepIdx + 1}`;
    const mime = screenshotFormatToMime(step.screenshotFormat);
    const extent = computeImageExtent(step.screenshot);

    anchors.push({
      type: "oneCellAnchor",
      from: {
        col: colIdx(4),
        colOff: 0,
        row: rowIdx(currentRow - 1),
        rowOff: 0,
      },
      ext: extent,
      content: {
        type: "picture",
        nvPicPr: { id: stepIdx + 1, name: `Screenshot${stepIdx + 1}` },
        blipRelId: relId,
      },
    });

    mediaMap.set(relId, {
      data: step.screenshot,
      contentType: mime,
    });
  }

  const drawing: XlsxDrawing = { anchors };

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
      { min: colIdx(5), max: colIdx(5), width: 50 },
    ],
    drawing,
    xmlPath: `xl/worksheets/sheet${sheetIndex}.xml`,
  };

  return { sheet, mediaMap };
}
