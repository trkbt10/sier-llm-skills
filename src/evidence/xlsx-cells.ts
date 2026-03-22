/**
 * @file XLSX セル・スタイルシート構築ヘルパー。
 */

import {
  rowIdx, colIdx, fontId, fillId, borderId, numFmtId,
} from "aurochs/xlsx/domain";
import type {
  StyleId, Cell, CellValue, XlsxStyleSheet,
} from "aurochs/xlsx/domain";

/** 指定位置にセルを作成する。 */
export function makeCell(col: number, row: number, value: CellValue, style?: StyleId): Cell {
  return {
    address: {
      col: colIdx(col),
      row: rowIdx(row),
      colAbsolute: false,
      rowAbsolute: false,
    },
    value,
    styleId: style,
  };
}

/** 文字列セルを作成する。 */
export function strCell(col: number, row: number, text: string, style?: StyleId): Cell {
  return makeCell(col, row, { type: "string", value: text }, style);
}

/** 数値セルを作成する。 */
export function numCell(col: number, row: number, num: number, style?: StyleId): Cell {
  return makeCell(col, row, { type: "number", value: num }, style);
}

/** 空セルを作成する。 */
export function emptyCell(col: number, row: number, style?: StyleId): Cell {
  return makeCell(col, row, { type: "empty" }, style);
}

/**
 * エビデンス用スタイルシートを構築する。
 *
 * Style ID 対応:
 *   0: デフォルト
 *   1: ヘッダー (白太字 + 青背景 + 罫線)
 *   2: 通常セル + 罫線
 *   3: Pass ステータス (緑太字)
 *   4: Fail ステータス (赤太字)
 *   5: 日時セル
 *   6: 偶数行セル (薄いグレー背景)
 */
export function buildEvidenceStyleSheet(): XlsxStyleSheet {
  return {
    numberFormats: [
      { numFmtId: numFmtId(164), formatCode: "yyyy-mm-dd hh:mm:ss" },
    ],
    fonts: [
      { name: "Calibri", size: 11 },
      { name: "Calibri", size: 11, bold: true, color: { rgb: "FFFFFF" } },
      { name: "Calibri", size: 11, bold: true, color: { rgb: "008000" } },
      { name: "Calibri", size: 11, bold: true, color: { rgb: "FF0000" } },
    ],
    fills: [
      { type: "none" },
      { type: "pattern", pattern: { patternType: "gray125" } },
      { type: "pattern", pattern: { patternType: "solid", fgColor: { rgb: "4472C4" } } },
      { type: "pattern", pattern: { patternType: "solid", fgColor: { rgb: "F2F2F2" } } },
    ],
    borders: [
      {},
      {
        left: { style: "thin", color: { rgb: "D0D0D0" } },
        right: { style: "thin", color: { rgb: "D0D0D0" } },
        top: { style: "thin", color: { rgb: "D0D0D0" } },
        bottom: { style: "thin", color: { rgb: "D0D0D0" } },
      },
    ],
    cellXfs: [
      { numFmtId: numFmtId(0), fontId: fontId(0), fillId: fillId(0), borderId: borderId(0) },
      { numFmtId: numFmtId(0), fontId: fontId(1), fillId: fillId(2), borderId: borderId(1), applyFont: true, applyFill: true, applyBorder: true, alignment: { horizontal: "center", vertical: "center" }, applyAlignment: true },
      { numFmtId: numFmtId(0), fontId: fontId(0), fillId: fillId(0), borderId: borderId(1), applyBorder: true },
      { numFmtId: numFmtId(0), fontId: fontId(2), fillId: fillId(0), borderId: borderId(1), applyFont: true, applyBorder: true, alignment: { horizontal: "center" }, applyAlignment: true },
      { numFmtId: numFmtId(0), fontId: fontId(3), fillId: fillId(0), borderId: borderId(1), applyFont: true, applyBorder: true, alignment: { horizontal: "center" }, applyAlignment: true },
      { numFmtId: numFmtId(164), fontId: fontId(0), fillId: fillId(0), borderId: borderId(1), applyNumberFormat: true, applyBorder: true },
      { numFmtId: numFmtId(0), fontId: fontId(0), fillId: fillId(3), borderId: borderId(1), applyFill: true, applyBorder: true },
    ],
    cellStyleXfs: [
      { numFmtId: numFmtId(0), fontId: fontId(0), fillId: fillId(0), borderId: borderId(0) },
    ],
    cellStyles: [
      { name: "Normal", xfId: 0, builtinId: 0 },
    ],
  };
}

/** Date を "yyyy-mm-dd hh:mm:ss" 文字列に変換する。 */
export function formatDateTime(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

/** Excel シート名の制約 (31文字以下、特定文字禁止) に従いサニタイズする。 */
export function sanitizeSheetName(name: string): string {
  return name.replace(/[\\/*?[\]:]/g, "_").slice(0, 31);
}
