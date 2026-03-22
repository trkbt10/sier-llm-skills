/**
 * @file EvidenceSheetSchema のランタイムバリデーション。
 */
import type { EvidenceSheetSchema } from "./types";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function validateCellPosition(
  pos: unknown,
  context: string,
): void {
  if (!isObject(pos)) {
    throw new Error(`${context} must be an object`);
  }
  if (!isString(pos["sheet"])) {
    throw new Error(`${context}.sheet must be a string`);
  }
  if (!isString(pos["col"])) {
    throw new Error(`${context}.col must be a string`);
  }
  if (typeof pos["row"] !== "number" || !Number.isInteger(pos["row"])) {
    throw new Error(`${context}.row must be an integer`);
  }
}

function validateCoverSheet(coverSheet: unknown): void {
  if (!isObject(coverSheet)) {
    throw new Error("coverSheet must be an object");
  }
  if (!isString(coverSheet["sheetName"])) {
    throw new Error("coverSheet.sheetName must be a string");
  }
  if (!Array.isArray(coverSheet["fields"])) {
    throw new Error("coverSheet.fields must be an array");
  }
  for (const [i, field] of (coverSheet["fields"] as unknown[]).entries()) {
    if (!isObject(field)) {
      throw new Error(`coverSheet.fields[${i}] must be an object`);
    }
    if (!isString(field["label"])) {
      throw new Error(`coverSheet.fields[${i}].label must be a string`);
    }
    validateCellPosition(
      field["valuePosition"],
      `coverSheet.fields[${i}].valuePosition`,
    );
  }
}

function validateScreenshot(screenshot: unknown): void {
  if (!isObject(screenshot)) {
    throw new Error("evidenceSheet.screenshot must be an object");
  }
  if (!isPositiveInt(screenshot["columnIndex"])) {
    throw new Error(
      "evidenceSheet.screenshot.columnIndex must be a positive integer",
    );
  }
  if (!isPositiveInt(screenshot["imageRowSpan"])) {
    throw new Error(
      "evidenceSheet.screenshot.imageRowSpan must be a positive integer",
    );
  }
}

function validateColumns(columns: unknown): void {
  if (!Array.isArray(columns)) {
    throw new Error("evidenceSheet.columns must be an array");
  }
  if (columns.length === 0) {
    throw new Error("evidenceSheet.columns must not be empty");
  }
  for (const [i, col] of (columns as unknown[]).entries()) {
    if (!isObject(col)) {
      throw new Error(`evidenceSheet.columns[${i}] must be an object`);
    }
    if (!isPositiveInt(col["columnIndex"])) {
      throw new Error(
        `evidenceSheet.columns[${i}].columnIndex must be a positive integer`,
      );
    }
    if (!isString(col["field"])) {
      throw new Error(`evidenceSheet.columns[${i}].field must be a string`);
    }
    if (!isString(col["header"])) {
      throw new Error(`evidenceSheet.columns[${i}].header must be a string`);
    }
  }
}

function validateEvidenceSheet(evidenceSheet: unknown): void {
  if (!isObject(evidenceSheet)) {
    throw new Error("evidenceSheet must be an object");
  }
  if (!isString(evidenceSheet["sheetName"])) {
    throw new Error("evidenceSheet.sheetName must be a string");
  }
  if (!isPositiveInt(evidenceSheet["headerRow"])) {
    throw new Error("evidenceSheet.headerRow must be a positive integer");
  }
  validateColumns(evidenceSheet["columns"]);
  validateScreenshot(evidenceSheet["screenshot"]);
}

/** EvidenceSheetSchema のランタイムバリデーション。 */
export function validateEvidenceSheetSchema(
  input: unknown,
): EvidenceSheetSchema {
  if (!isObject(input)) {
    throw new Error("input must be an object");
  }
  if (input["version"] !== 1) {
    throw new Error("version must be 1");
  }
  if (input["evidenceSheet"] === undefined) {
    throw new Error("evidenceSheet is required");
  }
  validateEvidenceSheet(input["evidenceSheet"]);
  if (input["coverSheet"] !== undefined) {
    validateCoverSheet(input["coverSheet"]);
  }
  return input as EvidenceSheetSchema;
}
