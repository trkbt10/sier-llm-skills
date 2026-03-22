/** @file TemplateConfig → EvidenceSheetSchema 互換ブリッジ。 */
import type { TemplateConfig, EvidenceSheetSchema, EvidenceColumnDef } from "./types";

const HEADER_MAP: Record<string, string> = {
  stepNumber: "No.",
  action: "操作手順",
  expected: "期待結果",
  actual: "確認結果",
  status: "ステータス",
  timestamp: "タイムスタンプ",
  testCaseId: "テストケース",
};

/**
 * 既存の TemplateConfig を EvidenceSheetSchema に変換する。
 */
export function templateConfigToSchema(config: TemplateConfig): EvidenceSheetSchema {
  const columns: EvidenceColumnDef[] = [];

  for (const [field, columnIndex] of Object.entries(config.columns)) {
    if (columnIndex === undefined) {
      continue;
    }
    const header = HEADER_MAP[field];
    if (!header) {
      continue;
    }
    columns.push({ columnIndex, field, header });
  }

  return {
    version: 1,
    evidenceSheet: {
      sheetName: config.evidenceSheet,
      headerRow: config.headerRow,
      columns,
      screenshot: {
        columnIndex: config.screenshotColumn + 1,
        imageRowSpan: config.imageRowSpan ?? 15,
      },
    },
  };
}
