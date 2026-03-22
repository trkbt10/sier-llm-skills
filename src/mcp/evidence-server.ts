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
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "session_click",
    description: "要素をクリックする (自動スクリーンショット)",
    inputSchema: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] },
  },
  {
    name: "session_type",
    description: "要素にテキストを入力する (自動スクリーンショット)",
    inputSchema: {
      type: "object",
      properties: { selector: { type: "string" }, text: { type: "string" } },
      required: ["selector", "text"],
    },
  },
  {
    name: "session_evaluate",
    description: "JavaScript 式を評価し、結果を返す",
    inputSchema: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
  },
  {
    name: "session_screenshot",
    description: "スクリーンショットを取得する (base64 画像を返す)",
    inputSchema: { type: "object", properties: { fullPage: { type: "boolean" } } },
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
];

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; data: string; mimeType: string };
type ToolResult = { content: (TextContent | ImageContent)[] };

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
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
  } = {
    activeRecording: undefined,
    activeSession: undefined,
    sessionTitle: "",
    sessionUrl: "",
    activeCdpRecorder: undefined,
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
    await state.activeRecording.navigate(url);
    return textResult(`遷移完了: ${url}`);
  }

  async function handleSessionClick(args: Record<string, unknown>): Promise<ToolResult> {
    if (state.activeRecording === undefined) {
      return textResult("エラー: セッションが開始されていません。");
    }
    const selector = args["selector"] as string;
    await state.activeRecording.click(selector);
    return textResult(`クリック完了: ${selector}`);
  }

  async function handleSessionType(args: Record<string, unknown>): Promise<ToolResult> {
    if (state.activeRecording === undefined) {
      return textResult("エラー: セッションが開始されていません。");
    }
    const selector = args["selector"] as string;
    const text = args["text"] as string;
    await state.activeRecording.type(selector, text);
    return textResult(`入力完了: ${selector}`);
  }

  async function handleSessionEvaluate(args: Record<string, unknown>): Promise<ToolResult> {
    if (state.activeRecording === undefined) {
      return textResult("エラー: セッションが開始されていません。");
    }
    const expression = args["expression"] as string;
    const result = await state.activeRecording.evaluate(expression);
    return textResult(JSON.stringify(result));
  }

  async function handleSessionScreenshot(args: Record<string, unknown>): Promise<ToolResult> {
    if (state.activeRecording === undefined) {
      return textResult("エラー: セッションが開始されていません。");
    }
    const fullPage = args["fullPage"] as boolean | undefined;
    const data = await state.activeRecording.screenshot({ fullPage });
    const base64 = uint8ArrayToBase64(data);
    return { content: [{ type: "image", data: base64, mimeType: "image/png" }] };
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
    const xlsxData = await buildEvidenceXlsx(report, { templatePath });
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
      const xlsxData = await buildEvidenceXlsx(report, { templatePath });
      const xlsxPath = join(outputDir, `evidence-replayed-${timestamp}.xlsx`);
      await writeFile(xlsxPath, xlsxData);

      return textResult(`再生完了\n操作履歴: ${replayedHistoryPath}\n証跡 XLSX: ${xlsxPath}`);
    } finally {
      await session.close();
    }
  }

  return server;
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
