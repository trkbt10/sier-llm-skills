/**
 * @file MCP サーバー経由のセッション操作 e2e テスト。
 *
 * 実際に Playwright を使って example.com を操作し、
 * 操作履歴 JSON と証跡 XLSX が正しく生成されることを検証する。
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { readFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { deserializeHistory } from "../src/operation-record/operation-io";

const OUTPUT_DIR = join(import.meta.dirname, "../output/e2e-mcp-session");

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; data: string; mimeType: string };
type ToolCallResult = Record<string, unknown>;

function extractText(result: ToolCallResult): string {
  const content = (result["content"] ?? []) as Array<TextContent | ImageContent>;
  const item = content.find((c): c is TextContent => c.type === "text");
  return item?.text ?? "";
}

function extractImage(result: ToolCallResult): ImageContent | undefined {
  const content = (result["content"] ?? []) as Array<TextContent | ImageContent>;
  return content.find((c): c is ImageContent => c.type === "image");
}

describe("MCP session e2e", () => {
  const timeout = 30_000;
  const clientHolder: { value: Client | undefined } = { value: undefined };

  beforeAll(async () => {
    if (existsSync(OUTPUT_DIR)) {
      await rm(OUTPUT_DIR, { recursive: true });
    }

    const transport = new StdioClientTransport({
      command: "bun",
      args: ["run", "src/mcp/serve.ts"],
      env: { ...process.env, OUTPUT_DIR },
    });

    const client = new Client({ name: "e2e-test", version: "0.1.0" });
    await client.connect(transport);
    clientHolder.value = client;
  }, timeout);

  afterAll(async () => {
    if (clientHolder.value !== undefined) {
      await clientHolder.value.close();
    }
  });

  it("lists all 16 tools", async () => {
    const { tools } = await clientHolder.value!.listTools();
    expect(tools).toHaveLength(16);
    const names = tools.map((t) => t.name);
    expect(names).toContain("session_start");
    expect(names).toContain("session_navigate");
    expect(names).toContain("session_click");
    expect(names).toContain("session_type");
    expect(names).toContain("session_evaluate");
    expect(names).toContain("session_screenshot");
    expect(names).toContain("session_end");
    expect(names).toContain("recording_start");
    expect(names).toContain("recording_stop");
    expect(names).toContain("replay");
    expect(names).toContain("build_evidence");
    expect(names).toContain("capture_screenshot");
    expect(names).toContain("read_test_spec");
    expect(names).toContain("write_test_result");
    expect(names).toContain("generate_schema");
    expect(names).toContain("patch_screenshots");
  });

  it("runs a full session: start → navigate → evaluate → click → screenshot → end", async () => {
    const client = clientHolder.value!;

    // session_start
    const startResult = await client.callTool({
      name: "session_start",
      arguments: { title: "e2e テスト", url: "https://example.com" },
    });
    expect(extractText(startResult)).toContain("セッション開始");

    // session_navigate
    const navResult = await client.callTool({
      name: "session_navigate",
      arguments: { url: "https://example.com" },
    });
    expect(extractText(navResult)).toContain("遷移完了");

    // session_evaluate
    const evalResult = await client.callTool({
      name: "session_evaluate",
      arguments: { expression: "document.title" },
    });
    expect(extractText(evalResult)).toContain("Example Domain");

    // session_click
    const clickResult = await client.callTool({
      name: "session_click",
      arguments: { selector: "a" },
    });
    expect(extractText(clickResult)).toContain("クリック完了");

    // session_screenshot
    const ssResult = await client.callTool({
      name: "session_screenshot",
      arguments: { fullPage: true },
    });
    const image = extractImage(ssResult);
    expect(image).toBeDefined();
    expect(image!.mimeType).toBe("image/png");
    expect(image!.data.length).toBeGreaterThan(100);

    // session_end
    const endResult = await client.callTool({
      name: "session_end",
      arguments: {},
    });
    const endText = extractText(endResult);
    expect(endText).toContain("セッション終了");
    expect(endText).toContain("操作履歴:");
    expect(endText).toContain("証跡 XLSX:");
  }, timeout);

  it("generates valid operation history JSON", async () => {
    const files = await readdir(OUTPUT_DIR);
    const historyFile = files.find((f) => f.startsWith("history-") && f.endsWith(".json"));
    expect(historyFile).toBeDefined();

    const json = await readFile(join(OUTPUT_DIR, historyFile!), "utf-8");
    const history = deserializeHistory(json);

    expect(history.version).toBe(1);
    expect(history.title).toBe("e2e テスト");
    expect(history.viewport).toEqual({ width: 1280, height: 800 });
    expect(history.entries.length).toBeGreaterThanOrEqual(4);

    // navigate エントリ
    const navEntry = history.entries.find((e) => e.operation.kind === "navigate");
    expect(navEntry).toBeDefined();
    expect(navEntry!.url).toBe("https://example.com");
    expect(navEntry!.screenshot).toBeInstanceOf(Uint8Array);

    // evaluate エントリ
    const evalEntry = history.entries.find((e) => e.operation.kind === "evaluate");
    expect(evalEntry).toBeDefined();
    expect(evalEntry!.evaluateResult).toBe("Example Domain");

    // click エントリ
    const clickEntry = history.entries.find((e) => e.operation.kind === "click");
    expect(clickEntry).toBeDefined();
  });

  it("generates evidence XLSX file", async () => {
    const files = await readdir(OUTPUT_DIR);
    const xlsxFile = files.find((f) => f.startsWith("evidence-") && f.endsWith(".xlsx"));
    expect(xlsxFile).toBeDefined();

    const xlsxData = await readFile(join(OUTPUT_DIR, xlsxFile!));
    // XLSX (ZIP) は PK ヘッダーで始まる
    expect(xlsxData[0]).toBe(0x50);
    expect(xlsxData[1]).toBe(0x4b);
    expect(xlsxData.length).toBeGreaterThan(1000);
  });

  it("rejects duplicate session_start", async () => {
    const client = clientHolder.value!;

    // 新しいセッションを開始
    await client.callTool({
      name: "session_start",
      arguments: { title: "dup test", url: "https://example.com" },
    });

    // 二重開始はエラーメッセージを返す
    const dupResult = await client.callTool({
      name: "session_start",
      arguments: { title: "dup test 2", url: "https://example.com" },
    });
    expect(extractText(dupResult)).toContain("エラー");

    // クリーンアップ
    await client.callTool({ name: "session_end", arguments: {} });
  }, timeout);

  it("returns error when no session is active", async () => {
    const client = clientHolder.value!;

    const navResult = await client.callTool({
      name: "session_navigate",
      arguments: { url: "https://example.com" },
    });
    expect(extractText(navResult)).toContain("エラー");
  });
});
