/** @file templateConfigToSchema の単体テスト。 */
import { templateConfigToSchema } from "./schema-compat";
import type { TemplateConfig } from "./types";

/** evidence-standard.json 相当の設定。 */
const standardConfig: TemplateConfig = {
  evidenceSheet: "証跡",
  headerRow: 1,
  columns: {
    stepNumber: 1,
    testCaseId: 2,
    action: 3,
    expected: 4,
    status: 5,
    timestamp: 6,
  },
  screenshotColumn: 6,
  imageRowSpan: 15,
};

/** evidence-minimal.json 相当の設定。 */
const minimalConfig: TemplateConfig = {
  evidenceSheet: "テスト証跡",
  headerRow: 2,
  columns: {
    stepNumber: 1,
    action: 2,
    expected: 3,
    status: 4,
  },
  screenshotColumn: 4,
  imageRowSpan: 15,
};

describe("templateConfigToSchema", () => {
  it("converts standard config (all 6 columns)", () => {
    const schema = templateConfigToSchema(standardConfig);

    expect(schema.version).toBe(1);
    expect(schema.evidenceSheet.sheetName).toBe("証跡");
    expect(schema.evidenceSheet.headerRow).toBe(1);
    expect(schema.evidenceSheet.columns).toHaveLength(6);

    const fields = schema.evidenceSheet.columns.map((c) => c.field);
    expect(fields).toContain("stepNumber");
    expect(fields).toContain("testCaseId");
    expect(fields).toContain("action");
    expect(fields).toContain("expected");
    expect(fields).toContain("status");
    expect(fields).toContain("timestamp");
  });

  it("converts minimal config (only 4 columns)", () => {
    const schema = templateConfigToSchema(minimalConfig);

    expect(schema.evidenceSheet.sheetName).toBe("テスト証跡");
    expect(schema.evidenceSheet.headerRow).toBe(2);
    expect(schema.evidenceSheet.columns).toHaveLength(4);

    const fields = schema.evidenceSheet.columns.map((c) => c.field);
    expect(fields).toContain("stepNumber");
    expect(fields).toContain("action");
    expect(fields).toContain("expected");
    expect(fields).toContain("status");
  });

  it("screenshotColumn is converted from 0-based to 1-based", () => {
    const schema = templateConfigToSchema(standardConfig);
    expect(schema.evidenceSheet.screenshot.columnIndex).toBe(7);

    const minSchema = templateConfigToSchema(minimalConfig);
    expect(minSchema.evidenceSheet.screenshot.columnIndex).toBe(5);
  });

  it("imageRowSpan defaults to 15", () => {
    const configWithoutSpan: TemplateConfig = {
      ...standardConfig,
      imageRowSpan: undefined,
    };
    const schema = templateConfigToSchema(configWithoutSpan);
    expect(schema.evidenceSheet.screenshot.imageRowSpan).toBe(15);
  });

  it("missing columns are excluded from schema", () => {
    const schema = templateConfigToSchema(minimalConfig);
    const fields = schema.evidenceSheet.columns.map((c) => c.field);

    expect(fields).not.toContain("actual");
    expect(fields).not.toContain("timestamp");
    expect(fields).not.toContain("testCaseId");
  });

  it("does not include coverSheet", () => {
    const schema = templateConfigToSchema(standardConfig);
    expect(schema.coverSheet).toBeUndefined();
  });

  it("maps correct Japanese headers", () => {
    const schema = templateConfigToSchema(standardConfig);
    const headerMap = Object.fromEntries(
      schema.evidenceSheet.columns.map((c) => [c.field, c.header]),
    );

    expect(headerMap["stepNumber"]).toBe("No.");
    expect(headerMap["action"]).toBe("操作手順");
    expect(headerMap["expected"]).toBe("期待結果");
    expect(headerMap["status"]).toBe("ステータス");
    expect(headerMap["timestamp"]).toBe("タイムスタンプ");
    expect(headerMap["testCaseId"]).toBe("テストケース");
  });
});
