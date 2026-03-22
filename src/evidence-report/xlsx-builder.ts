/**
 * @file XLSX Evidence Builder。
 *
 * テンプレートあり: テンプレートのシート構造を維持し、設定ファイルに従って
 * エビデンスデータを既存シートに注入する。
 * テンプレートなし: 自前の Summary + Evidence シートを生成する。
 */

import { exportXlsx } from "aurochs/xlsx/builder";
import type { MediaPart } from "aurochs/xlsx/builder";
import { parseXlsxWorkbook } from "aurochs/xlsx/parser/full";
import { loadZipPackage } from "aurochs/zip";
import type { XlsxWorkbook, XlsxWorksheet } from "aurochs/xlsx/domain";
import type { ZipPackage } from "aurochs/zip";
import { readFile } from "node:fs/promises";
import type { EvidenceReport, EvidenceSheetSchema, TemplateConfig } from "./types";
import { buildEvidenceStyleSheet } from "./xlsx-cells";
import {
  buildSummarySheet, buildEvidenceSheet, injectIntoTemplateSheet,
  type EvidenceSheetResult,
} from "./evidence-sheets";
import { buildEvidenceSheetFromSchema } from "./schema-driven-sheets";

/** buildEvidenceXlsx のオプション。 */
export type BuildEvidenceXlsxOptions = {
  /** .xltx テンプレートファイルパス。 */
  readonly templatePath?: string;
  /** テンプレート設定 JSON パス。省略時は templatePath の拡張子を .json に変えて探索。 */
  readonly templateConfigPath?: string;
  /** LLM が生成したマッピングスキーマ。指定時はスキーマ駆動で構築する。 */
  readonly schema?: EvidenceSheetSchema;
};

type TemplateData = {
  readonly sourcePackage: ZipPackage;
  readonly workbook: XlsxWorkbook;
  readonly config: TemplateConfig;
};

/**
 * EvidenceReport から XLSX ファイルを構築する。
 */
export async function buildEvidenceXlsx(
  report: EvidenceReport,
  options?: BuildEvidenceXlsxOptions,
): Promise<Uint8Array> {
  if (options?.schema) {
    return buildWithSchema(report, options.schema);
  }

  const template = await loadTemplate(options);

  if (template) {
    return buildWithTemplate(report, template);
  }
  return buildWithoutTemplate(report);
}

function buildWithSchema(report: EvidenceReport, schema: EvidenceSheetSchema): Promise<Uint8Array> {
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

function buildWithoutTemplate(report: EvidenceReport): Promise<Uint8Array> {
  const summarySheet = buildSummarySheet(report);
  const evidenceResults: EvidenceSheetResult[] = report.testCases.map(
    (tc, i) => buildEvidenceSheet(tc, i + 2),
  );

  const workbook: XlsxWorkbook = {
    dateSystem: "1900",
    sheets: [summarySheet, ...evidenceResults.map((e) => e.sheet)],
    styles: buildEvidenceStyleSheet(),
    sharedStrings: [],
  };

  const sheetMedia = collectSheetMedia(evidenceResults, 1);
  return exportXlsx(workbook, { sheetMedia });
}

function buildWithTemplate(report: EvidenceReport, template: TemplateData): Promise<Uint8Array> {
  const { workbook: templateWb, sourcePackage, config } = template;

  // テンプレートの対象シートを見つける
  const targetSheetIndex = templateWb.sheets.findIndex(
    (s: XlsxWorksheet) => s.name === config.evidenceSheet,
  );
  if (targetSheetIndex === -1) {
    throw new Error(
      `Template sheet "${config.evidenceSheet}" not found. ` +
      `Available: ${templateWb.sheets.map((s: XlsxWorksheet) => s.name).join(", ")}`,
    );
  }

  // 対象シートにデータを注入
  const injected = injectIntoTemplateSheet(
    templateWb.sheets[targetSheetIndex],
    report.testCases,
    config,
  );

  // テンプレートのシート群を再構築 (対象シートだけ差し替え)
  const sheets: XlsxWorksheet[] = templateWb.sheets.map(
    (s: XlsxWorksheet, i: number) => (i === targetSheetIndex ? injected.sheet : s),
  );

  const workbook: XlsxWorkbook = {
    ...templateWb,
    sheets,
    sharedStrings: [],
  };

  const sheetMedia = new Map<number, ReadonlyMap<string, MediaPart>>();
  if (injected.mediaMap.size > 0) {
    sheetMedia.set(targetSheetIndex, injected.mediaMap);
  }

  return exportXlsx(workbook, { sourcePackage, sheetMedia });
}

function collectSheetMedia(
  results: readonly EvidenceSheetResult[],
  offset: number,
): Map<number, ReadonlyMap<string, MediaPart>> {
  const sheetMedia = new Map<number, ReadonlyMap<string, MediaPart>>();
  for (const [i, { mediaMap }] of results.entries()) {
    if (mediaMap.size > 0) {
      sheetMedia.set(offset + i, mediaMap);
    }
  }
  return sheetMedia;
}

async function loadTemplate(
  options: BuildEvidenceXlsxOptions | undefined,
): Promise<TemplateData | undefined> {
  if (!options?.templatePath) {
    return undefined;
  }

  const configPath = options.templateConfigPath
    ?? options.templatePath.replace(/\.xltx$/i, ".json");

  const [templateData, configData] = await Promise.all([
    readFile(options.templatePath),
    readFile(configPath, "utf-8"),
  ]);

  const sourcePackage = await loadZipPackage(templateData);
  const workbook = await parseXlsxWorkbook(
    async (path) => sourcePackage.readText(path) ?? undefined,
  );
  const config: TemplateConfig = JSON.parse(configData);

  return { sourcePackage, workbook, config };
}
