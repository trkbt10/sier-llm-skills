/**
 * @file XLSX Evidence Builder。
 *
 * aurochs の exportXlsx に XlsxWorkbook ドメインオブジェクトと sheetMedia を渡し、
 * ECMA-376 準拠の OPC Drawing/Media 出力を委譲する。
 * .xltx テンプレートからの生成にも対応: テンプレートのスタイル・テーマを継承する。
 */

import { exportXlsx } from "aurochs/xlsx/builder";
import type { MediaPart } from "aurochs/xlsx/builder";
import { parseXlsxWorkbook } from "aurochs/xlsx/parser/full";
import { loadZipPackage } from "aurochs/zip";
import type { XlsxWorkbook, XlsxStyleSheet } from "aurochs/xlsx/domain";
import type { ZipPackage } from "aurochs/zip";
import { readFile } from "node:fs/promises";
import type { EvidenceReport } from "./types";
import { buildEvidenceStyleSheet } from "./xlsx-cells";
import { buildSummarySheet, buildEvidenceSheet, type EvidenceSheetResult } from "./evidence-sheets";

/** buildEvidenceXlsx のオプション。 */
export type BuildEvidenceXlsxOptions = {
  /**
   * .xltx テンプレートファイルパス。
   * 指定時、テンプレートのスタイル・テーマを継承し、
   * エビデンスデータを流し込んだ .xlsx を出力する。
   */
  readonly templatePath?: string;
};

type TemplateData = {
  readonly sourcePackage: ZipPackage;
  readonly styles: XlsxStyleSheet;
};

/**
 * EvidenceReport から XLSX ファイルを構築する。
 * テンプレート指定時はテンプレートのスタイルとテーマを継承する。
 */
export async function buildEvidenceXlsx(
  report: EvidenceReport,
  options?: BuildEvidenceXlsxOptions,
): Promise<Uint8Array> {
  const template = await loadTemplate(options?.templatePath);
  const styles = template?.styles ?? buildEvidenceStyleSheet();

  const summarySheet = buildSummarySheet(report);
  const evidenceResults: EvidenceSheetResult[] = report.testCases.map((tc, i) => buildEvidenceSheet(tc, i + 2));

  const workbook: XlsxWorkbook = {
    dateSystem: "1900",
    sheets: [summarySheet, ...evidenceResults.map((e) => e.sheet)],
    styles,
    sharedStrings: [],
  };

  const sheetMedia = new Map<number, ReadonlyMap<string, MediaPart>>();
  for (const [i, { mediaMap }] of evidenceResults.entries()) {
    if (mediaMap.size > 0) {
      sheetMedia.set(i + 1, mediaMap);
    }
  }

  return exportXlsx(workbook, {
    sourcePackage: template?.sourcePackage,
    sheetMedia,
  });
}

async function loadTemplate(templatePath: string | undefined): Promise<TemplateData | undefined> {
  if (!templatePath) {
    return undefined;
  }
  const data = await readFile(templatePath);
  const sourcePackage = await loadZipPackage(data);
  const parsed = await parseXlsxWorkbook(async (path) => sourcePackage.readText(path) ?? undefined);
  return { sourcePackage, styles: parsed.styles };
}
