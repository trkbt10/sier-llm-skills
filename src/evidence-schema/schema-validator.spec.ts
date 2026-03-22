/** @file validateEvidenceSheetSchema の単体テスト。 */
import { validateEvidenceSheetSchema } from "./schema-validator";

const validMinimal = {
  version: 1,
  evidenceSheet: {
    sheetName: "証跡",
    headerRow: 3,
    columns: [
      { columnIndex: 1, field: "stepNumber", header: "No." },
    ],
    screenshot: { columnIndex: 5, imageRowSpan: 10 },
  },
} as const;

const validWithCoverSheet = {
  ...validMinimal,
  coverSheet: {
    sheetName: "表紙",
    fields: [
      {
        label: "プロジェクト名",
        valuePosition: { sheet: "表紙", col: "C", row: 3 },
      },
    ],
  },
} as const;

describe("validateEvidenceSheetSchema", () => {
  it("accepts a valid minimal schema", () => {
    const result = validateEvidenceSheetSchema(validMinimal);
    expect(result.version).toBe(1);
    expect(result.evidenceSheet.sheetName).toBe("証跡");
  });

  it("accepts a valid schema with coverSheet", () => {
    const result = validateEvidenceSheetSchema(validWithCoverSheet);
    expect(result.coverSheet?.sheetName).toBe("表紙");
    expect(result.coverSheet?.fields).toHaveLength(1);
  });

  it("rejects missing version", () => {
    const { evidenceSheet } = validMinimal;
    expect(() => validateEvidenceSheetSchema({ evidenceSheet })).toThrow("version");
  });

  it("rejects wrong version", () => {
    expect(() =>
      validateEvidenceSheetSchema({ ...validMinimal, version: 2 }),
    ).toThrow("version must be 1");
  });

  it("rejects missing evidenceSheet", () => {
    expect(() =>
      validateEvidenceSheetSchema({ version: 1 }),
    ).toThrow("evidenceSheet is required");
  });

  it("rejects empty columns array", () => {
    const input = {
      ...validMinimal,
      evidenceSheet: {
        ...validMinimal.evidenceSheet,
        columns: [],
      },
    };
    expect(() => validateEvidenceSheetSchema(input)).toThrow(
      "columns must not be empty",
    );
  });

  it("rejects invalid screenshot placement", () => {
    const input = {
      ...validMinimal,
      evidenceSheet: {
        ...validMinimal.evidenceSheet,
        screenshot: { columnIndex: -1, imageRowSpan: 0 },
      },
    };
    expect(() => validateEvidenceSheetSchema(input)).toThrow(
      "screenshot.columnIndex must be a positive integer",
    );
  });

  it("rejects coverSheet with invalid fields", () => {
    const input = {
      ...validMinimal,
      coverSheet: {
        sheetName: "表紙",
        fields: [{ label: 123, valuePosition: "bad" }],
      },
    };
    expect(() => validateEvidenceSheetSchema(input)).toThrow("label");
  });
});
