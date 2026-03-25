# @trkbt10/sier-llm-skills

LLM (大規模言語モデル) によるブラウザ操作のスクリーンショット証跡を XLSX ファイルとして自動生成するライブラリ。MCP (Model Context Protocol) サーバーとしても動作し、Claude Desktop などの AI アシスタントから直接利用できる。

## 特徴

- **3 つのキャプチャ戦略** - Playwright ヘッドレス / Chrome DevTools Protocol (CDP) / chrome-devtools-mcp (Google 公式 MCP)
- **操作の記録と再生** - ブラウザ操作を JSON として記録し、後から再生して証跡を再生成
- **スキーマ駆動の証跡生成** - テスト仕様書の構造を `EvidenceSheetSchema` で定義し、カスタムレイアウトの XLSX を出力
- **XLSX 読み書き** - 既存の XLSX テスト仕様書を読み取り、テスト結果やスクリーンショットを書き戻し
- **MCP サーバー** - 16 のツールを公開し、AI アシスタントがブラウザ操作・証跡生成を自律的に実行

## インストール

```bash
npm install @trkbt10/sier-llm-skills
```

Playwright をキャプチャ戦略として使う場合は、peer dependency としてインストールする:

```bash
npm install playwright
```

## クイックスタート

### スクリーンショット撮影

```typescript
import { writeFile } from "node:fs/promises";
import { createHeadlessCaptureStrategy } from "@trkbt10/sier-llm-skills";

const strategy = createHeadlessCaptureStrategy(async (opts) => {
  const pw = await import("playwright");
  return pw.chromium.launch({ headless: opts.headless });
});

const session = await strategy.launch({
  headless: true,
  viewport: { width: 1280, height: 800 },
});

try {
  await session.navigate("https://example.com");
  const screenshot = await session.screenshot({ fullPage: true });
  await writeFile("screenshot.png", screenshot);
} finally {
  await session.close();
}
```

### 操作記録 & 証跡 XLSX 生成

```typescript
import { writeFile } from "node:fs/promises";
import {
  createHeadlessCaptureStrategy,
  createRecordingSession,
  historyToEvidence,
  buildEvidenceXlsx,
} from "@trkbt10/sier-llm-skills";

const strategy = createHeadlessCaptureStrategy(async (opts) => {
  const pw = await import("playwright");
  return pw.chromium.launch({ headless: opts.headless });
});

const viewport = { width: 1280, height: 800 };
const session = await strategy.launch({ headless: true, viewport });
const recording = createRecordingSession({ inner: session, viewport });

await recording.navigateWithStep("https://example.com", {
  action: "トップページにアクセスする",
  expected: "トップページが正常に表示されること",
});

await recording.screenshotWithStep({
  action: "画面全体を確認する",
  expected: "正常に表示されていること",
});

const history = recording.finalizeHistory("テスト名");
await recording.close();

const report = historyToEvidence(history, {
  testCaseName: "テスト名",
  testCaseUrl: "https://example.com",
});

const xlsx = await buildEvidenceXlsx(report);
await writeFile("evidence.xlsx", xlsx);
```

## サンプルの実行

`examples/` 内のサンプルはリポジトリから直接実行できる:

```bash
# 操作記録 → 再生 → 証跡 XLSX 生成
bun run examples/record-and-replay.ts

# 既存 XLSX の読み取り・更新
bun run examples/xlsx-read-write.ts examples/fixtures/minimal.xlsx
```

出力は `output/` ディレクトリに保存される。生成された XLSX を Excel 等で開くと、操作手順・期待結果・確認結果とスクリーンショットが確認できる。

### テスト仕様書フィクスチャ

[`examples/fixtures/`](./examples/fixtures/) に様々なレイアウトのテスト仕様書 XLSX を用意している。MCP サーバーの `read_test_spec` でこれらを読み取り、`generate_schema` で構造を登録することで、どんなレイアウトでも証跡ワークフローを実行できることを示す。

| ファイル | 特徴 |
|----------|------|
| `minimal.xlsx` | 証跡シートのみ、基本 4 列の最小構成 |
| `with-metadata-columns.xlsx` | 表紙 + テストケースID・実施日時・URL 列を追加した構成 |
| `header-offset.xlsx` | 上部にメタ情報があり、ヘッダーが 4 行目から始まる |
| `multi-sheet.xlsx` | 機能別に複数シートにテストケースが分散 |
| `irregular.xlsx` | 英語ヘッダー、スクリーンショット列が中間、列順が非標準 |

フィクスチャの再生成: `bun run examples/generate-fixtures.ts`


## MCP サーバー

### Claude Desktop での設定

`claude_desktop_config.json` に以下を追加:

```json
{
  "mcpServers": {
    "evidence": {
      "command": "npx",
      "args": ["@trkbt10/sier-llm-skills"],
      "env": {
        "OUTPUT_DIR": "./evidence-output"
      }
    }
  }
}
```

### 提供ツール一覧

| ツール | 説明 |
|--------|------|
| `session_start` | ブラウザを起動し、操作記録セッションを開始する |
| `session_navigate` | 指定 URL に遷移する (自動スクリーンショット) |
| `session_click` | 要素をクリックする (自動スクリーンショット) |
| `session_type` | 要素にテキストを入力する (自動スクリーンショット) |
| `session_evaluate` | JavaScript 式を評価し、結果を返す |
| `session_screenshot` | スクリーンショットを取得する |
| `session_end` | セッションを終了し、操作履歴 JSON と XLSX 証跡を出力する |
| `recording_start` | CDP 傍受による手動操作レコーディングを開始する |
| `recording_stop` | レコーディングを停止し、操作履歴 JSON を出力する |
| `replay` | 操作履歴ファイルを再生し、XLSX 証跡を出力する |
| `build_evidence` | 操作履歴 JSON から XLSX 証跡ファイルを生成する |
| `capture_screenshot` | 指定 URL のスクリーンショットを単発撮影する |
| `read_test_spec` | XLSX テスト仕様書を読み取り、テキストとして返す |
| `write_test_result` | XLSX ファイルの指定セルに値を書き込む |
| `generate_schema` | テスト仕様書のマッピングスキーマを登録する |
| `patch_screenshots` | 既存 XLSX にスクリーンショット画像を注入する |

### MCP ワークフロー例

AI アシスタントとの対話で以下のようなワークフローが可能:

1. `read_test_spec` でテスト仕様書 (XLSX) を読み取る
2. `generate_schema` で仕様書の構造をスキーマとして登録する
3. `session_start` でブラウザセッションを開始する
4. `session_navigate` / `session_click` / `session_type` でテスト手順を実行する
5. `session_end` で証跡 XLSX を生成する
6. `write_test_result` でテスト結果を仕様書に書き戻す
7. `patch_screenshots` でスクリーンショットを仕様書に注入する

## ライブラリ API

### キャプチャ戦略

| 戦略 | 説明 | ユースケース |
|------|------|-------------|
| `createHeadlessCaptureStrategy` | Playwright ベースのヘッドレスブラウザ | CI/CD、自動テスト |
| `createCdpCaptureStrategy` | CDP 直接接続 | Electron アプリ、既存ブラウザ |
| `createChromeMcpCaptureStrategy` | chrome-devtools-mcp 経由 | Google 公式 MCP 連携 |

### BrowserSession

```typescript
type BrowserSession = {
  navigate(url: string): Promise<void>;
  screenshot(options?: ScreenshotOptions): Promise<Uint8Array>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  evaluate<T>(fn: string): Promise<T>;
  close(): Promise<void>;
};
```

### RecordingSession

`BrowserSession` を拡張し、全操作をスクリーンショット付きで記録する:

```typescript
const recording = createRecordingSession({ inner: session, viewport });

// テスト仕様書の操作手順・期待結果を付与して操作
await recording.navigateWithStep(url, { action: "...", expected: "..." });
await recording.clickWithStep(selector, { action: "...", expected: "..." });
await recording.typeWithStep(selector, text, { action: "...", expected: "..." });

// 操作履歴を確定
const history = recording.finalizeHistory("テスト名");
```

### 証跡生成

```typescript
import { historyToEvidence, buildEvidenceXlsx } from "@trkbt10/sier-llm-skills";

const report = historyToEvidence(history, {
  testCaseName: "テスト名",
  testCaseUrl: "https://example.com",
});

// デフォルトレイアウトで XLSX 生成
const xlsx = await buildEvidenceXlsx(report);

// カスタムスキーマで XLSX 生成
const xlsxCustom = await buildEvidenceXlsx(report, { schema: mySchema });
```

### XLSX 操作

```typescript
import {
  readXlsxAsText,
  formatXlsxForLlm,
  updateXlsxCells,
  patchXlsxWithImages,
} from "@trkbt10/sier-llm-skills";

// 読み取り
const result = await readXlsxAsText("test-spec.xlsx");
console.log(formatXlsxForLlm(result));

// セル更新
await updateXlsxCells("input.xlsx", "output.xlsx", [
  { sheetName: "Sheet1", cells: [{ col: "A", row: 1, value: "OK" }] },
]);

// 画像注入
await patchXlsxWithImages("input.xlsx", "output.xlsx", [
  {
    sheetName: "Evidence",
    images: [{ data: pngData, contentType: "image/png", fromCol: 0, fromRow: 0, toCol: 1, toRow: 10 }],
  },
]);
```

### EvidenceSheetSchema

LLM がテスト仕様書の構造を解釈し、カスタムレイアウトで証跡を生成するためのスキーマ:

```typescript
import type { EvidenceSheetSchema } from "@trkbt10/sier-llm-skills";

const schema: EvidenceSheetSchema = {
  version: 1,
  coverSheet: {
    sheetName: "表紙",
    fields: [
      { label: "プロジェクト名", valuePosition: { sheet: "表紙", col: "B", row: 2 } },
    ],
    summary: {
      okCount: { sheet: "表紙", col: "B", row: 7 },
      ngCount: { sheet: "表紙", col: "B", row: 8 },
    },
  },
  evidenceSheet: {
    sheetName: "証跡",
    headerRow: 1,
    columns: [
      { columnIndex: 1, field: "stepNumber", header: "No.", width: 6 },
      { columnIndex: 2, field: "action", header: "操作手順", width: 40 },
      { columnIndex: 3, field: "expected", header: "期待結果", width: 40 },
      { columnIndex: 4, field: "actual", header: "確認結果", width: 40 },
    ],
    screenshot: { columnIndex: 5, imageRowSpan: 20 },
  },
};
```

## ライセンス

[Apache License 2.0](./LICENSE)
