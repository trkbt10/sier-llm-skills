/** @file schema-driven-sheets の単体テスト。 */
import { resolveFieldValue, buildEvidenceSheetFromSchema, buildCoverSheetValues } from "./schema-driven-sheets";
import type { EvidenceTestCase, EvidenceSheetSchema } from "../evidence-schema/types";

const timestamp = new Date("2025-06-15T10:30:00Z");

const testCase: EvidenceTestCase = {
  name: "TC-001",
  url: "https://example.com",
  status: "pass",
  startedAt: new Date("2025-06-15T10:00:00Z"),
  finishedAt: new Date("2025-06-15T10:35:00Z"),
  steps: [
    {
      stepNumber: 1,
      action: "Click login",
      url: "https://example.com/login",
      expected: "Login page shown",
      actual: "Login page shown",
      screenshot: new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      screenshotFormat: "png",
      timestamp,
    },
    {
      stepNumber: 2,
      action: "Enter credentials",
      url: "https://example.com/login",
      expected: "Fields populated",
      actual: "Fields populated",
      screenshot: new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      screenshotFormat: "png",
      timestamp,
    },
  ],
} as const;

const step = testCase.steps[0];

const schemaEvidence: EvidenceSheetSchema["evidenceSheet"] = {
  sheetName: "証跡",
  headerRow: 1,
  columns: [
    { columnIndex: 1, field: "stepNumber", header: "No.", width: 8 },
    { columnIndex: 2, field: "action", header: "操作手順", width: 30 },
    { columnIndex: 3, field: "expected", header: "期待結果", width: 30 },
    { columnIndex: 4, field: "actual", header: "実績結果", width: 30 },
  ],
  screenshot: { columnIndex: 5, imageRowSpan: 10 },
};

describe("resolveFieldValue", () => {
  it("returns correct value for stepNumber", () => {
    expect(resolveFieldValue("stepNumber", step, testCase)).toBe("1");
  });

  it("returns correct value for action", () => {
    expect(resolveFieldValue("action", step, testCase)).toBe("Click login");
  });

  it("returns correct value for expected", () => {
    expect(resolveFieldValue("expected", step, testCase)).toBe("Login page shown");
  });

  it("returns correct value for actual", () => {
    expect(resolveFieldValue("actual", step, testCase)).toBe("Login page shown");
  });

  it("returns correct value for status", () => {
    expect(resolveFieldValue("status", step, testCase)).toBe("PASS");
  });

  it("returns correct value for timestamp", () => {
    const result = resolveFieldValue("timestamp", step, testCase);
    expect(result).toContain("2025");
  });

  it("returns correct value for testCaseId", () => {
    expect(resolveFieldValue("testCaseId", step, testCase)).toBe("TC-001");
  });

  it("returns correct value for url", () => {
    expect(resolveFieldValue("url", step, testCase)).toBe("https://example.com/login");
  });

  it("returns empty string for unknown fields", () => {
    expect(resolveFieldValue("unknownField", step, testCase)).toBe("");
    expect(resolveFieldValue("memo", step, testCase)).toBe("");
  });
});

describe("buildEvidenceSheetFromSchema", () => {
  it("produces correct number of rows", () => {
    const result = buildEvidenceSheetFromSchema(schemaEvidence, [testCase]);
    // 1 header row + 2 steps * 10 rows each = 21 rows
    expect(result.sheet.rows).toHaveLength(1 + 2 * 10);
  });

  it("creates media entries for screenshots", () => {
    const result = buildEvidenceSheetFromSchema(schemaEvidence, [testCase]);
    expect(result.mediaMap.size).toBe(2);
    expect(result.mediaMap.has("rId1")).toBe(true);
    expect(result.mediaMap.has("rId2")).toBe(true);
    const media = result.mediaMap.get("rId1")!;
    expect(media.contentType).toBe("image/png");
  });

  it("respects column ordering from schema", () => {
    const result = buildEvidenceSheetFromSchema(schemaEvidence, [testCase]);
    // Header row is first
    const headerRow = result.sheet.rows[0];
    expect(headerRow.cells).toHaveLength(4);
    expect(headerRow.cells[0].value).toEqual({ type: "string", value: "No." });
    expect(headerRow.cells[1].value).toEqual({ type: "string", value: "操作手順" });
    expect(headerRow.cells[2].value).toEqual({ type: "string", value: "期待結果" });
    expect(headerRow.cells[3].value).toEqual({ type: "string", value: "実績結果" });
  });

  it("uses column widths from schema", () => {
    const result = buildEvidenceSheetFromSchema(schemaEvidence, [testCase]);
    const colDefs = result.sheet.columns!;
    expect(colDefs[0].width).toBe(8);
    expect(colDefs[1].width).toBe(30);
  });

  it("creates drawing anchors for each step", () => {
    const result = buildEvidenceSheetFromSchema(schemaEvidence, [testCase]);
    expect(result.sheet.drawing?.anchors).toHaveLength(2);
  });
});

describe("buildCoverSheetValues", () => {
  it("returns cell updates from cover sheet fields", () => {
    const coverSheet: EvidenceSheetSchema["coverSheet"] = {
      sheetName: "表紙",
      fields: [
        { label: "プロジェクト名", valuePosition: { sheet: "表紙", col: "C", row: 3 } },
        { label: "テスト日", valuePosition: { sheet: "表紙", col: "C", row: 5 } },
      ],
    };
    const result = buildCoverSheetValues(coverSheet);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ col: "C", row: 3, value: "プロジェクト名" });
    expect(result[1]).toEqual({ col: "C", row: 5, value: "テスト日" });
  });

  it("returns empty array when schema is undefined", () => {
    const result = buildCoverSheetValues(undefined);
    expect(result).toHaveLength(0);
  });
});
