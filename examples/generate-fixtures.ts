/**
 * @file テスト仕様書の XLSX フィクスチャを一括生成する。
 *
 * 様々なレイアウトの XLSX を生成し、examples/fixtures/ に保存する。
 * MCP の read_test_spec → generate_schema がどんな構造でも対応できることを示す。
 * 操作手順は実在する公開サイトで実際に実行可能な内容にしている。
 *
 * 実行: bun run examples/generate-fixtures.ts
 */

import { writeFile, mkdir } from "node:fs/promises";
import { exportXlsx } from "aurochs/xlsx/builder";
import type { XlsxWorkbook, XlsxWorksheet, XlsxRow } from "aurochs/xlsx/domain";
import { rowIdx, colIdx } from "aurochs/xlsx/domain";
import { strCell, emptyCell, buildEvidenceStyleSheet } from "../src/evidence-xlsx/xlsx-cells";

const FIXTURES_DIR = "examples/fixtures";
const styles = buildEvidenceStyleSheet();

async function save(name: string, workbook: XlsxWorkbook): Promise<void> {
  const xlsx = await exportXlsx(workbook);
  const path = `${FIXTURES_DIR}/${name}.xlsx`;
  await writeFile(path, xlsx);
  console.log(`${path} (${xlsx.length} bytes)`);
}

function sheet(
  name: string,
  sheetId: number,
  columns: Array<{ col: number; width: number }>,
  rows: XlsxRow[],
): XlsxWorksheet {
  return {
    dateSystem: "1900",
    name,
    sheetId,
    state: "visible",
    columns: columns.map((c) => ({ min: colIdx(c.col), max: colIdx(c.col), width: c.width })),
    rows,
    mergeCells: [],
    xmlPath: `xl/worksheets/sheet${sheetId}.xml`,
  };
}

function row(r: number, cells: ReturnType<typeof strCell>[]): XlsxRow {
  return { rowNumber: rowIdx(r), cells };
}

await mkdir(FIXTURES_DIR, { recursive: true });

// -------------------------------------------------------
// 1. minimal - Wikipedia 日本語版で記事検索・表示
// -------------------------------------------------------
await save("minimal", {
  dateSystem: "1900",
  sheets: [
    sheet("証跡", 1, [
      { col: 1, width: 6 }, { col: 2, width: 40 }, { col: 3, width: 40 },
      { col: 4, width: 40 }, { col: 5, width: 50 },
    ], [
      row(1, [strCell(1, 1, "No."), strCell(2, 1, "操作手順"), strCell(3, 1, "期待結果"), strCell(4, 1, "確認結果"), strCell(5, 1, "スクリーンショット")]),
      row(2, [strCell(1, 2, "1"), strCell(2, 2, "https://ja.wikipedia.org にアクセスする"), strCell(3, 2, "Wikipedia のトップページが表示されること"), emptyCell(4, 2), emptyCell(5, 2)]),
      row(3, [strCell(1, 3, "2"), strCell(2, 3, "検索ボックスに「東京タワー」と入力し検索する"), strCell(3, 3, "東京タワーの記事が表示されること"), emptyCell(4, 3), emptyCell(5, 3)]),
    ]),
  ],
  styles,
  sharedStrings: [],
});

// -------------------------------------------------------
// 2. with-metadata-columns - GitHub リポジトリの Issues 確認
// -------------------------------------------------------
await save("with-metadata-columns", {
  dateSystem: "1900",
  sheets: [
    sheet("表紙", 1, [
      { col: 1, width: 20 }, { col: 2, width: 40 },
    ], [
      row(1, [strCell(1, 1, "プロジェクト名"), strCell(2, 1, "GitHub Issue 表示確認")]),
      row(2, [strCell(1, 2, "テスト実施日"), emptyCell(2, 2)]),
      row(3, [strCell(1, 3, "テスト実施者"), emptyCell(2, 3)]),
      row(5, [strCell(1, 5, "実施件数"), emptyCell(2, 5)]),
      row(6, [strCell(1, 6, "OK 件数"), emptyCell(2, 6)]),
      row(7, [strCell(1, 7, "NG 件数"), emptyCell(2, 7)]),
    ]),
    sheet("証跡", 2, [
      { col: 1, width: 12 }, { col: 2, width: 6 }, { col: 3, width: 40 },
      { col: 4, width: 40 }, { col: 5, width: 40 }, { col: 6, width: 10 },
      { col: 7, width: 20 }, { col: 8, width: 40 }, { col: 9, width: 50 },
    ], [
      row(1, [
        strCell(1, 1, "テストケースID"), strCell(2, 1, "No."), strCell(3, 1, "操作手順"),
        strCell(4, 1, "期待結果"), strCell(5, 1, "確認結果"), strCell(6, 1, "判定"),
        strCell(7, 1, "実施日時"), strCell(8, 1, "URL"), strCell(9, 1, "スクリーンショット"),
      ]),
      row(2, [
        strCell(1, 2, "TC-001"), strCell(2, 2, "1"), strCell(3, 2, "https://github.com/facebook/react にアクセスする"),
        strCell(4, 2, "React リポジトリのトップページが表示されること"), emptyCell(5, 2), emptyCell(6, 2),
        emptyCell(7, 2), emptyCell(8, 2), emptyCell(9, 2),
      ]),
      row(3, [
        strCell(1, 3, "TC-001"), strCell(2, 3, "2"), strCell(3, 3, "「Issues」タブをクリックする"),
        strCell(4, 3, "Issues 一覧が表示されること"), emptyCell(5, 3), emptyCell(6, 3),
        emptyCell(7, 3), emptyCell(8, 3), emptyCell(9, 3),
      ]),
      row(4, [
        strCell(1, 4, "TC-002"), strCell(2, 4, "1"), strCell(3, 4, "https://github.com/microsoft/TypeScript にアクセスする"),
        strCell(4, 4, "TypeScript リポジトリのトップページが表示されること"), emptyCell(5, 4), emptyCell(6, 4),
        emptyCell(7, 4), emptyCell(8, 4), emptyCell(9, 4),
      ]),
    ]),
  ],
  styles,
  sharedStrings: [],
});

// -------------------------------------------------------
// 3. header-offset - MDN Web Docs でドキュメント検索
// -------------------------------------------------------
await save("header-offset", {
  dateSystem: "1900",
  sheets: [
    sheet("テスト証跡", 1, [
      { col: 1, width: 6 }, { col: 2, width: 40 }, { col: 3, width: 40 },
      { col: 4, width: 40 }, { col: 5, width: 10 }, { col: 6, width: 50 },
    ], [
      row(1, [strCell(1, 1, "テスト名:"), strCell(2, 1, "MDN Web Docs 閲覧確認")]),
      row(2, [strCell(1, 2, "対象 URL:"), strCell(2, 2, "https://developer.mozilla.org")]),
      row(3, [strCell(1, 3, "備考:"), strCell(2, 3, "ドキュメント検索と記事表示の確認")]),
      row(4, [
        strCell(1, 4, "No."), strCell(2, 4, "操作手順"), strCell(3, 4, "期待結果"),
        strCell(4, 4, "確認結果"), strCell(5, 4, "判定"), strCell(6, 4, "スクリーンショット"),
      ]),
      row(5, [
        strCell(1, 5, "1"), strCell(2, 5, "https://developer.mozilla.org にアクセスする"),
        strCell(3, 5, "MDN のトップページが表示されること"), emptyCell(4, 5), emptyCell(5, 5), emptyCell(6, 5),
      ]),
      row(6, [
        strCell(1, 6, "2"), strCell(2, 6, "検索ボックスに「Array.prototype.map」と入力し検索する"),
        strCell(3, 6, "Array.prototype.map のドキュメントが表示されること"), emptyCell(4, 6), emptyCell(5, 6), emptyCell(6, 6),
      ]),
      row(7, [
        strCell(1, 7, "3"), strCell(2, 7, "ページ内の「構文」セクションまでスクロールする"),
        strCell(3, 7, "構文セクションが表示されること"), emptyCell(4, 7), emptyCell(5, 7), emptyCell(6, 7),
      ]),
    ]),
  ],
  styles,
  sharedStrings: [],
});

// -------------------------------------------------------
// 4. multi-sheet - Wikipedia / GitHub / npm を別シートで
// -------------------------------------------------------
await save("multi-sheet", {
  dateSystem: "1900",
  sheets: [
    sheet("Wikipedia", 1, [
      { col: 1, width: 6 }, { col: 2, width: 40 }, { col: 3, width: 40 },
      { col: 4, width: 40 }, { col: 5, width: 50 },
    ], [
      row(1, [strCell(1, 1, "No."), strCell(2, 1, "操作"), strCell(3, 1, "期待"), strCell(4, 1, "結果"), strCell(5, 1, "画面キャプチャ")]),
      row(2, [strCell(1, 2, "1"), strCell(2, 2, "https://ja.wikipedia.org にアクセスする"), strCell(3, 2, "トップページが表示される"), emptyCell(4, 2), emptyCell(5, 2)]),
      row(3, [strCell(1, 3, "2"), strCell(2, 3, "「富士山」を検索する"), strCell(3, 3, "富士山の記事が表示される"), emptyCell(4, 3), emptyCell(5, 3)]),
    ]),
    sheet("GitHub", 2, [
      { col: 1, width: 6 }, { col: 2, width: 40 }, { col: 3, width: 40 },
      { col: 4, width: 40 }, { col: 5, width: 50 },
    ], [
      row(1, [strCell(1, 1, "No."), strCell(2, 1, "操作"), strCell(3, 1, "期待"), strCell(4, 1, "結果"), strCell(5, 1, "画面キャプチャ")]),
      row(2, [strCell(1, 2, "1"), strCell(2, 2, "https://github.com/nodejs/node にアクセスする"), strCell(3, 2, "Node.js リポジトリが表示される"), emptyCell(4, 2), emptyCell(5, 2)]),
      row(3, [strCell(1, 3, "2"), strCell(2, 3, "README.md の内容を確認する"), strCell(3, 3, "README が表示される"), emptyCell(4, 3), emptyCell(5, 3)]),
    ]),
    sheet("npm", 3, [
      { col: 1, width: 6 }, { col: 2, width: 40 }, { col: 3, width: 40 },
      { col: 4, width: 40 }, { col: 5, width: 50 },
    ], [
      row(1, [strCell(1, 1, "No."), strCell(2, 1, "操作"), strCell(3, 1, "期待"), strCell(4, 1, "結果"), strCell(5, 1, "画面キャプチャ")]),
      row(2, [strCell(1, 2, "1"), strCell(2, 2, "https://www.npmjs.com にアクセスする"), strCell(3, 2, "npm トップページが表示される"), emptyCell(4, 2), emptyCell(5, 2)]),
      row(3, [strCell(1, 3, "2"), strCell(2, 3, "「express」を検索する"), strCell(3, 3, "express パッケージが検索結果に表示される"), emptyCell(4, 3), emptyCell(5, 3)]),
    ]),
  ],
  styles,
  sharedStrings: [],
});

// -------------------------------------------------------
// 5. irregular - Google 検索 (英語ヘッダー、スクリーンショットが中間列、列順非標準)
// -------------------------------------------------------
await save("irregular", {
  dateSystem: "1900",
  sheets: [
    sheet("Summary", 1, [
      { col: 1, width: 15 }, { col: 2, width: 30 },
    ], [
      row(1, [strCell(1, 1, "Project"), strCell(2, 1, "Google Search Verification")]),
      row(2, [strCell(1, 2, "Environment"), strCell(2, 2, "Production")]),
      row(3, [strCell(1, 3, "Tester"), emptyCell(2, 3)]),
      row(4, [strCell(1, 4, "Date"), emptyCell(2, 4)]),
      row(5, [strCell(1, 5, "Total"), emptyCell(2, 5)]),
      row(6, [strCell(1, 6, "Pass"), emptyCell(2, 6)]),
      row(7, [strCell(1, 7, "Fail"), emptyCell(2, 7)]),
    ]),
    sheet("Test Evidence", 2, [
      { col: 1, width: 6 }, { col: 2, width: 35 }, { col: 3, width: 50 },
      { col: 4, width: 35 }, { col: 5, width: 10 }, { col: 6, width: 35 },
      { col: 7, width: 20 },
    ], [
      row(1, [
        strCell(1, 1, "#"), strCell(2, 1, "Action"), strCell(3, 1, "Screenshot"),
        strCell(4, 1, "Expected"), strCell(5, 1, "Result"), strCell(6, 1, "Actual"),
        strCell(7, 1, "Timestamp"),
      ]),
      row(2, [
        strCell(1, 2, "1"), strCell(2, 2, "Navigate to https://www.google.com"),
        emptyCell(3, 2), strCell(4, 2, "Google search page is displayed"),
        emptyCell(5, 2), emptyCell(6, 2), emptyCell(7, 2),
      ]),
      row(3, [
        strCell(1, 3, "2"), strCell(2, 3, "Type \"MDN JavaScript\" in the search box and press Enter"),
        emptyCell(3, 3), strCell(4, 3, "Search results are displayed"),
        emptyCell(5, 3), emptyCell(6, 3), emptyCell(7, 3),
      ]),
      row(4, [
        strCell(1, 4, "3"), strCell(2, 4, "Click the first search result link"),
        emptyCell(3, 4), strCell(4, 4, "MDN JavaScript page is displayed"),
        emptyCell(5, 4), emptyCell(6, 4), emptyCell(7, 4),
      ]),
    ]),
  ],
  styles,
  sharedStrings: [],
});

console.log("\nAll fixtures generated.");
