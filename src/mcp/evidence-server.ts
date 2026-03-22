/**
 * @file 証跡エビデンス MCP サーバー。
 *
 * ブラウザ操作の記録・再生・証跡生成を MCP ツールとして公開する。
 * 低レベル Server API を使い、zod の型推論コストを回避する。
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CaptureStrategy, LaunchOptions, BrowserSession } from "../browser-control/types";
import { createRecordingSession, type RecordingSession } from "../operation-capture/recording-session";
import { replayHistory } from "../operation-replay/replay";
import { serializeHistory, deserializeHistory } from "../operation-record/operation-io";
import { historyToEvidence } from "../operation-replay/history-to-evidence";
import { buildEvidenceXlsx } from "../evidence-report/xlsx-builder";
import { createCdpRecorder, type CdpRecorder } from "../operation-capture/cdp-recorder";
import type { StepDescription } from "../operation-record/operation-types";
import { readXlsxAsText, formatXlsxForLlm, formatSheetForLlm } from "../evidence-report/xlsx-reader";
import { updateXlsxCells } from "../evidence-report/xlsx-writer";
import type { SheetUpdate } from "../evidence-report/xlsx-writer";
import type { EvidenceSheetSchema } from "../evidence-report/types";
import { validateEvidenceSheetSchema } from "../evidence-report/schema-validator";

export type EvidenceServerConfig = {
  readonly strategy: CaptureStrategy;
  readonly launchOptions?: LaunchOptions;
  readonly outputDir: string;
};

type ToolDef = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Record<string, unknown>;
    readonly required?: readonly string[];
  };
};

const TOOLS: readonly ToolDef[] = [
  {
    name: "session_start",
    description: "ブラウザを起動し、操作記録セッションを開始する",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "セッションタイトル" },
        url: { type: "string", description: "テスト対象の URL" },
        viewportWidth: { type: "number", description: "ビューポート幅" },
        viewportHeight: { type: "number", description: "ビューポート高さ" },
        format: { type: "string", enum: ["png", "jpeg", "webp"], description: "スクリーンショットフォーマット" },
      },
      required: ["title", "url"],
    },
  },
  {
    name: "session_navigate",
    description: "指定 URL に遷移する (自動スクリーンショット)",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        stepAction: { type: "string", description: "テスト仕様書の操作手順 (例: 'ログイン画面を表示する')" },
        stepExpected: { type: "string", description: "テスト仕様書の期待結果 (例: 'ログイン画面が表示されること')" },
      },
      required: ["url"],
    },
  },
  {
    name: "session_click",
    description: "要素をクリックする (自動スクリーンショット)",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        stepAction: { type: "string", description: "テスト仕様書の操作手順 (例: 'ログインボタンを押下する')" },
        stepExpected: { type: "string", description: "テスト仕様書の期待結果 (例: 'ダッシュボード画面に遷移すること')" },
      },
      required: ["selector"],
    },
  },
  {
    name: "session_type",
    description: "要素にテキストを入力する (自動スクリーンショット)",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        text: { type: "string" },
        stepAction: { type: "string", description: "テスト仕様書の操作手順 (例: 'ユーザー名に「admin」を入力する')" },
        stepExpected: { type: "string", description: "テスト仕様書の期待結果 (例: 'ユーザー名欄に「admin」が入力されること')" },
      },
      required: ["selector", "text"],
    },
  },
  {
    name: "session_evaluate",
    description: "JavaScript 式を評価し、結果を返す",
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string" },
        stepAction: { type: "string", description: "テスト仕様書の操作手順 (例: 'ページタイトルを確認する')" },
        stepExpected: { type: "string", description: "テスト仕様書の期待結果 (例: 'タイトルが「Example Domain」であること')" },
      },
      required: ["expression"],
    },
  },
  {
    name: "session_screenshot",
    description: "スクリーンショットを取得する (base64 画像を返す)",
    inputSchema: {
      type: "object",
      properties: {
        fullPage: { type: "boolean" },
        stepAction: { type: "string", description: "テスト仕様書の操作手順 (例: '画面全体のスクリーンショットを取得する')" },
        stepExpected: { type: "string", description: "テスト仕様書の期待結果 (例: '正常に画面が表示されていること')" },
      },
    },
  },
  {
    name: "session_end",
    description: "セッションを終了し、操作履歴 JSON と XLSX 証跡を出力する",
    inputSchema: { type: "object", properties: { templatePath: { type: "string" } } },
  },
  {
    name: "recording_start",
    description: "CDP 傍受による手動操作レコーディングを開始する",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        debugPort: { type: "number" },
        viewportWidth: { type: "number" },
        viewportHeight: { type: "number" },
      },
      required: ["title"],
    },
  },
  {
    name: "recording_stop",
    description: "レコーディングを停止し、操作履歴 JSON を出力する",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "replay",
    description: "操作履歴ファイルを再生し、XLSX 証跡を出力する",
    inputSchema: {
      type: "object",
      properties: { historyPath: { type: "string" }, templatePath: { type: "string" } },
      required: ["historyPath"],
    },
  },
  {
    name: "build_evidence",
    description: "操作履歴 JSON から XLSX 証跡ファイルを生成する (セッション不要)",
    inputSchema: {
      type: "object",
      properties: {
        historyPath: { type: "string", description: "操作履歴 JSON ファイルパス" },
        templatePath: { type: "string", description: "XLSX テンプレートファイルパス" },
        testCaseName: { type: "string", description: "テストケース名" },
        testCaseUrl: { type: "string", description: "テスト対象 URL" },
      },
      required: ["historyPath"],
    },
  },
  {
    name: "capture_screenshot",
    description: "指定 URL のスクリーンショットを撮影する (セッション不要、単発)",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "撮影対象の URL" },
        fullPage: { type: "boolean", description: "フルページスクリーンショット" },
        viewportWidth: { type: "number", description: "ビューポート幅" },
        viewportHeight: { type: "number", description: "ビューポート高さ" },
        outputPath: { type: "string", description: "PNG ファイル保存先パス (省略時は base64 のみ返却)" },
      },
      required: ["url"],
    },
  },
  {
    name: "read_test_spec",
    description: "XLSX テスト仕様書を読み取り、シート内容をテキストとして返す。LLM がテスト仕様書の構造（ヘッダー、操作手順、期待結果、メタデータ等）を動的に解釈するために使用する",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "XLSX ファイルパス" },
        sheetName: { type: "string", description: "読み取るシート名 (省略時は全シート)" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "write_test_result",
    description: "XLSX ファイルの指定セルに値を書き込む。テスト結果（実施日、確認結果、OK/NG数、サマリ等）を書き戻すために使用する",
    inputSchema: {
      type: "object",
      properties: {
        inputPath: { type: "string", description: "入力 XLSX ファイルパス" },
        outputPath: { type: "string", description: "出力 XLSX ファイルパス" },
        updates: {
          type: "array",
          description: "シートごとのセル更新",
          items: {
            type: "object",
            properties: {
              sheetName: { type: "string" },
              cells: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    col: { type: "string", description: "列名 (A, B, C...)" },
                    row: { type: "number", description: "行番号 (1始まり)" },
                    value: { description: "書き込む値 (文字列または数値)" },
                  },
                  required: ["col", "row", "value"],
                },
              },
            },
            required: ["sheetName", "cells"],
          },
        },
      },
      required: ["inputPath", "outputPath", "updates"],
    },
  },
  {
    name: "generate_schema",
    description: "LLM が read_test_spec で推測したテスト仕様書のマッピングスキーマを登録する。後続の build_evidence / session_end / replay がこのスキーマを使用する",
    inputSchema: {
      type: "object",
      properties: {
        schema: { type: "object", description: "EvidenceSheetSchema JSON" },
      },
      required: ["schema"],
    },
  },
];

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; data: string; mimeType: string };
type ToolResult = { content: (TextContent | ImageContent)[] };

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function extractStep(args: Record<string, unknown>): StepDescription | undefined {
  const action = args["stepAction"] as string | undefined;
  const expected = args["stepExpected"] as string | undefined;
  if (action !== undefined && expected !== undefined) {
    return { action, expected };
  }
  return undefined;
}

/** 証跡エビデンス MCP サーバーを生成する。 */
export function createEvidenceServer(config: EvidenceServerConfig): Server {
  const server = new Server(
    { name: "evidence-server", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  const state: {
    activeRecording: RecordingSession | undefined;
    activeSession: BrowserSession | undefined;
    sessionTitle: string;
    sessionUrl: string;
    activeCdpRecorder: CdpRecorder | undefined;
    activeSchema: EvidenceSheetSchema | undefined;
  } = {
    activeRecording: undefined,
    activeSession: undefined,
    sessionTitle: "",
    sessionUrl: "",
    activeCdpRecorder: undefined,
    activeSchema: undefined,
  };

  const defaultViewport = config.launchOptions?.viewport ?? { width: 1280, height: 800 };

  async function ensureOutputDir(): Promise<string> {
    await mkdir(config.outputDir, { recursive: true });
    return config.outputDir;
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    switch (name) {
      case "session_start":
        return handleSessionStart(args);
      case "session_navigate":
        return handleSessionNavigate(args);
      case "session_click":
        return handleSessionClick(args);
      case "session_type":
        return handleSessionType(args);
      case "session_evaluate":
        return handleSessionEvaluate(args);
      case "session_screenshot":
        return handleSessionScreenshot(args);
      case "session_end":
        return handleSessionEnd(args);
      case "recording_start":
        return handleRecordingStart(args);
      case "recording_stop":
        return handleRecordingStop();
      case "replay":
        return handleReplay(args);
      case "build_evidence":
        return handleBuildEvidence(args);
      case "capture_screenshot":
        return handleCaptureScreenshot(args);
      case "read_test_spec":
        return handleReadTestSpec(args);
      case "write_test_result":
        return handleWriteTestResult(args);
      case "generate_schema":
        return handleGenerateSchema(args);
      default:
        return textResult(`不明なツール: ${name}`);
    }
  });

  async function handleSessionStart(args: Record<string, unknown>): Promise<ToolResult> {
    if (state.activeRecording !== undefined) {
      return textResult("エラー: 既にセッションが開始されています。先に session_end を呼んでください。");
    }

    const title = args["title"] as string;
    const url = args["url"] as string;
    const vw = args["viewportWidth"] as number | undefined;
    const vh = args["viewportHeight"] as number | undefined;
    const format = args["format"] as "png" | "jpeg" | "webp" | undefined;

    const viewport = (vw !== undefined && vh !== undefined) ? { width: vw, height: vh } : defaultViewport;
    const launchOptions: LaunchOptions = { ...config.launchOptions, viewport };

    state.activeSession = await config.strategy.launch(launchOptions);
    state.activeRecording = createRecordingSession({
      inner: state.activeSession,
      viewport,
      screenshotFormat: format,
    });
    state.sessionTitle = title;
    state.sessionUrl = url;

    return textResult(`セッション開始: ${title}`);
  }

  async function handleSessionNavigate(args: Record<string, unknown>): Promise<ToolResult> {
    if (state.activeRecording === undefined) {
      return textResult("エラー: セッションが開始されていません。");
    }
    const url = args["url"] as string;
    const step = extractStep(args);
    if (step !== undefined) {
      await state.activeRecording.navigateWithStep(url, step);
    } else {
      await state.activeRecording.navigate(url);
    }
    return textResult(`遷移完了: ${url}`);
  }

  async function handleSessionClick(args: Record<string, unknown>): Promise<ToolResult> {
    if (state.activeRecording === undefined) {
      return textResult("エラー: セッションが開始されていません。");
    }
    const selector = args["selector"] as string;
    const step = extractStep(args);
    if (step !== undefined) {
      await state.activeRecording.clickWithStep(selector, step);
    } else {
      await state.activeRecording.click(selector);
    }
    return textResult(`クリック完了: ${selector}`);
  }

  async function handleSessionType(args: Record<string, unknown>): Promise<ToolResult> {
    if (state.activeRecording === undefined) {
      return textResult("エラー: セッションが開始されていません。");
    }
    const selector = args["selector"] as string;
    const text = args["text"] as string;
    const step = extractStep(args);
    if (step !== undefined) {
      await state.activeRecording.typeWithStep(selector, text, step);
    } else {
      await state.activeRecording.type(selector, text);
    }
    return textResult(`入力完了: ${selector}`);
  }

  async function handleSessionEvaluate(args: Record<string, unknown>): Promise<ToolResult> {
    if (state.activeRecording === undefined) {
      return textResult("エラー: セッションが開始されていません。");
    }
    const expression = args["expression"] as string;
    const step = extractStep(args);
    if (step !== undefined) {
      const result = await state.activeRecording.evaluateWithStep(expression, step);
      return textResult(JSON.stringify(result));
    }
    const result = await state.activeRecording.evaluate(expression);
    return textResult(JSON.stringify(result));
  }

  async function handleSessionScreenshot(args: Record<string, unknown>): Promise<ToolResult> {
    if (state.activeRecording === undefined) {
      return textResult("エラー: セッションが開始されていません。");
    }
    const fullPage = args["fullPage"] as boolean | undefined;
    const step = extractStep(args);
    if (step !== undefined) {
      const data = await state.activeRecording.screenshotWithStep(step, { fullPage });
      return { content: [{ type: "image", data: uint8ArrayToBase64(data), mimeType: "image/png" }] };
    }
    const data = await state.activeRecording.screenshot({ fullPage });
    return { content: [{ type: "image", data: uint8ArrayToBase64(data), mimeType: "image/png" }] };
  }

  async function handleSessionEnd(args: Record<string, unknown>): Promise<ToolResult> {
    if (state.activeRecording === undefined) {
      return textResult("エラー: セッションが開始されていません。");
    }

    const history = state.activeRecording.finalizeHistory(state.sessionTitle);
    await state.activeRecording.close();

    const outputDir = await ensureOutputDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    const historyPath = join(outputDir, `history-${timestamp}.json`);
    await writeFile(historyPath, serializeHistory(history));

    const templatePath = args["templatePath"] as string | undefined;
    const report = historyToEvidence(history, { testCaseName: state.sessionTitle, testCaseUrl: state.sessionUrl });
    const xlsxData = await buildEvidenceXlsx(report, { templatePath, schema: state.activeSchema });
    const xlsxPath = join(outputDir, `evidence-${timestamp}.xlsx`);
    await writeFile(xlsxPath, xlsxData);

    state.activeRecording = undefined;
    state.activeSession = undefined;

    return textResult(`セッション終了\n操作履歴: ${historyPath}\n証跡 XLSX: ${xlsxPath}`);
  }

  async function handleRecordingStart(args: Record<string, unknown>): Promise<ToolResult> {
    if (state.activeCdpRecorder !== undefined) {
      return textResult("エラー: 既にレコーディング中です。");
    }

    const title = args["title"] as string;
    const debugPort = (args["debugPort"] as number | undefined) ?? 9222;
    const vw = args["viewportWidth"] as number | undefined;
    const vh = args["viewportHeight"] as number | undefined;
    const viewport = (vw !== undefined && vh !== undefined) ? { width: vw, height: vh } : defaultViewport;

    state.sessionTitle = title;
    state.activeCdpRecorder = createCdpRecorder({ debugPort, viewport });
    await state.activeCdpRecorder.start();

    return textResult(`レコーディング開始: ${title}`);
  }

  async function handleRecordingStop(): Promise<ToolResult> {
    if (state.activeCdpRecorder === undefined) {
      return textResult("エラー: レコーディングが開始されていません。");
    }

    const history = await state.activeCdpRecorder.stop(state.sessionTitle);
    const outputDir = await ensureOutputDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    const historyPath = join(outputDir, `recording-${timestamp}.json`);
    await writeFile(historyPath, serializeHistory(history));

    state.activeCdpRecorder = undefined;

    return textResult(`レコーディング停止\n操作履歴: ${historyPath}`);
  }

  async function handleReplay(args: Record<string, unknown>): Promise<ToolResult> {
    const historyPath = args["historyPath"] as string;
    const templatePath = args["templatePath"] as string | undefined;

    const json = await readFile(historyPath, "utf-8");
    const history = deserializeHistory(json);

    const viewport = history.viewport;
    const launchOptions: LaunchOptions = { ...config.launchOptions, viewport };

    const session = await config.strategy.launch(launchOptions);
    try {
      const replayed = await replayHistory(session, history);

      const outputDir = await ensureOutputDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

      const replayedHistoryPath = join(outputDir, `replayed-${timestamp}.json`);
      await writeFile(replayedHistoryPath, serializeHistory(replayed));

      const testCaseUrl = extractNavigateUrl(history);

      const report = historyToEvidence(replayed, { testCaseName: history.title, testCaseUrl });
      const xlsxData = await buildEvidenceXlsx(report, { templatePath, schema: state.activeSchema });
      const xlsxPath = join(outputDir, `evidence-replayed-${timestamp}.xlsx`);
      await writeFile(xlsxPath, xlsxData);

      return textResult(`再生完了\n操作履歴: ${replayedHistoryPath}\n証跡 XLSX: ${xlsxPath}`);
    } finally {
      await session.close();
    }
  }

  async function handleBuildEvidence(args: Record<string, unknown>): Promise<ToolResult> {
    const historyPath = args["historyPath"] as string;
    const templatePath = args["templatePath"] as string | undefined;
    const testCaseName = args["testCaseName"] as string | undefined;
    const testCaseUrl = args["testCaseUrl"] as string | undefined;

    const json = await readFile(historyPath, "utf-8");
    const history = deserializeHistory(json);

    const report = historyToEvidence(history, {
      testCaseName: testCaseName ?? history.title,
      testCaseUrl: testCaseUrl ?? extractNavigateUrl(history),
    });

    const xlsxData = await buildEvidenceXlsx(report, { templatePath, schema: state.activeSchema });
    const outputDir = await ensureOutputDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const xlsxPath = join(outputDir, `evidence-${timestamp}.xlsx`);
    await writeFile(xlsxPath, xlsxData);

    return textResult(`証跡 XLSX 生成完了: ${xlsxPath}`);
  }

  async function handleCaptureScreenshot(args: Record<string, unknown>): Promise<ToolResult> {
    const url = args["url"] as string;
    const fullPage = args["fullPage"] as boolean | undefined;
    const vw = args["viewportWidth"] as number | undefined;
    const vh = args["viewportHeight"] as number | undefined;
    const outputPath = args["outputPath"] as string | undefined;

    const viewport = (vw !== undefined && vh !== undefined) ? { width: vw, height: vh } : defaultViewport;
    const launchOptions: LaunchOptions = { ...config.launchOptions, viewport };

    const session = await config.strategy.launch(launchOptions);
    try {
      await session.navigate(url);
      const data = await session.screenshot({ fullPage: fullPage ?? true });

      if (outputPath !== undefined) {
        await writeFile(outputPath, data);
        return textResult(`スクリーンショット保存: ${outputPath} (${data.length} bytes)`);
      }

      const base64 = uint8ArrayToBase64(data);
      return { content: [{ type: "image", data: base64, mimeType: "image/png" }] };
    } finally {
      await session.close();
    }
  }

  async function handleReadTestSpec(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = args["filePath"] as string;
    const sheetName = args["sheetName"] as string | undefined;

    const result = await readXlsxAsText(filePath);

    if (sheetName !== undefined) {
      const sheet = result.sheets.find((s) => s.name === sheetName);
      if (sheet === undefined) {
        return textResult(`エラー: シート "${sheetName}" が見つかりません。利用可能: ${result.sheetNames.join(", ")}`);
      }
      return textResult(formatSheetForLlm(sheet));
    }

    return textResult(formatXlsxForLlm(result));
  }

  async function handleWriteTestResult(args: Record<string, unknown>): Promise<ToolResult> {
    const inputPath = args["inputPath"] as string;
    const outputPath = args["outputPath"] as string;
    const rawUpdates = args["updates"] as Array<{
      sheetName: string;
      cells: Array<{ col: string; row: number; value: string | number }>;
    }>;

    const updates: SheetUpdate[] = rawUpdates.map((u) => ({
      sheetName: u.sheetName,
      cells: u.cells.map((c) => ({ col: c.col, row: c.row, value: c.value })),
    }));

    await updateXlsxCells(inputPath, outputPath, updates);
    const totalCells = updates.reduce((sum, u) => sum + u.cells.length, 0);
    return textResult(`XLSX 更新完了: ${outputPath} (${totalCells} セル更新)`);
  }

  async function handleGenerateSchema(args: Record<string, unknown>): Promise<ToolResult> {
    const rawSchema = args["schema"];
    try {
      const schema = validateEvidenceSheetSchema(rawSchema);
      state.activeSchema = schema;

      const outputDir = await ensureOutputDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const schemaPath = join(outputDir, `schema-${timestamp}.json`);
      await writeFile(schemaPath, JSON.stringify(schema, undefined, 2));

      const colCount = schema.evidenceSheet.columns.length;
      const fields = schema.evidenceSheet.columns.map((c) => c.field).join(", ");
      const coverInfo = formatCoverInfo(schema);
      return textResult(
        `スキーマ登録完了\n` +
        `証跡シート: ${schema.evidenceSheet.sheetName} (${colCount} カラム: ${fields})${coverInfo}\n` +
        `保存先: ${schemaPath}`,
      );
    } catch (err) {
      return textResult(`スキーマバリデーションエラー: ${String(err)}`);
    }
  }

  return server;
}

function formatCoverInfo(schema: EvidenceSheetSchema): string {
  if (schema.coverSheet === undefined) {
    return "";
  }
  return `\n表紙シート: ${schema.coverSheet.sheetName} (${schema.coverSheet.fields.length} フィールド)`;
}

function extractNavigateUrl(history: { readonly entries: readonly { readonly operation: { readonly kind: string } }[] }): string {
  const navEntry = history.entries.find((e) => e.operation.kind === "navigate");
  if (navEntry === undefined) {
    return "unknown";
  }
  const op = navEntry.operation as { kind: "navigate"; url: string };
  return op.url;
}

function uint8ArrayToBase64(data: Uint8Array): string {
  const chunks: string[] = [];
  for (const byte of data) {
    chunks.push(String.fromCharCode(byte));
  }
  return btoa(chunks.join(""));
}
