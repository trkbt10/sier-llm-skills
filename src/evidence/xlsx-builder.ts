/**
 * @file XLSX Evidence Builder。
 *
 * aurochs の exportXlsx に XlsxWorkbook ドメインオブジェクトと sheetMedia を渡し、
 * ECMA-376 準拠の OPC Drawing/Media 出力を委譲する。
 */

import { exportXlsx } from "aurochs/xlsx/builder";
import type { MediaPart } from "aurochs/xlsx/builder";
import type { XlsxWorkbook } from "aurochs/xlsx/domain";
import type { EvidenceReport } from "./types";
import { buildEvidenceStyleSheet } from "./xlsx-cells";
import { buildSummarySheet, buildEvidenceSheet, type EvidenceSheetResult } from "./evidence-sheets";

/**
 * EvidenceReport から XLSX ファイルを構築する。
 */
export async function buildEvidenceXlsx(report: EvidenceReport): Promise<Uint8Array> {
  const summarySheet = buildSummarySheet(report);

  const evidenceResults: EvidenceSheetResult[] = [];
  for (let i = 0; i < report.testCases.length; i++) {
    evidenceResults.push(buildEvidenceSheet(report.testCases[i], i + 2));
  }

  const workbook: XlsxWorkbook = {
    dateSystem: "1900",
    sheets: [summarySheet, ...evidenceResults.map((e) => e.sheet)],
    styles: buildEvidenceStyleSheet(),
    sharedStrings: [],
  };

  const sheetMedia = new Map<number, ReadonlyMap<string, MediaPart>>();
  for (let i = 0; i < evidenceResults.length; i++) {
    const { mediaMap } = evidenceResults[i];
    if (mediaMap.size > 0) {
      sheetMedia.set(i + 1, mediaMap);
    }
  }

  return exportXlsx(workbook, { sheetMedia });
}
