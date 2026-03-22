/**
 * @file XLSX Evidence Builder。
 *
 * EvidenceSheetSchema に基づいてスキーマ駆動で証跡 XLSX を生成する。
 * スキーマ未指定時はデフォルトスキーマで構築する。
 */

import { exportXlsx } from "aurochs/xlsx/builder";
import type { MediaPart } from "aurochs/xlsx/builder";
import type { XlsxWorkbook } from "aurochs/xlsx/domain";
import type { EvidenceReport, EvidenceSheetSchema } from "./types";
import { buildEvidenceStyleSheet } from "./xlsx-cells";
import { buildEvidenceSheetFromSchema } from "./schema-driven-sheets";

/** デフォルトスキーマ (スキーマ未指定時に使用)。 */
const DEFAULT_SCHEMA: EvidenceSheetSchema = {
  version: 1,
  evidenceSheet: {
    sheetName: "Evidence",
    headerRow: 1,
    columns: [
      { columnIndex: 1, field: "stepNumber", header: "No.", width: 8 },
      { columnIndex: 2, field: "action", header: "操作手順", width: 30 },
      { columnIndex: 3, field: "expected", header: "期待結果", width: 30 },
      { columnIndex: 4, field: "actual", header: "確認結果", width: 30 },
    ],
    screenshot: { columnIndex: 5, imageRowSpan: 15 },
  },
};

/** buildEvidenceXlsx のオプション。 */
export type BuildEvidenceXlsxOptions = {
  /** LLM が生成したマッピングスキーマ。省略時はデフォルトスキーマで構築する。 */
  readonly schema?: EvidenceSheetSchema;
};

/**
 * EvidenceReport から XLSX ファイルを構築する。
 */
export async function buildEvidenceXlsx(
  report: EvidenceReport,
  options?: BuildEvidenceXlsxOptions,
): Promise<Uint8Array> {
  const schema = options?.schema ?? DEFAULT_SCHEMA;
  const evidenceResult = buildEvidenceSheetFromSchema(
    schema.evidenceSheet,
    report.testCases,
  );

  const workbook: XlsxWorkbook = {
    dateSystem: "1900",
    sheets: [evidenceResult.sheet],
    styles: buildEvidenceStyleSheet(),
    sharedStrings: [],
  };

  const sheetMedia = new Map<number, ReadonlyMap<string, MediaPart>>();
  if (evidenceResult.mediaMap.size > 0) {
    sheetMedia.set(0, evidenceResult.mediaMap);
  }

  return exportXlsx(workbook, { sheetMedia });
}
