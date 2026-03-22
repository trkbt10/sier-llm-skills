/**
 * @file MCP サーバー経由の操作履歴再生 e2e テスト。
 *
 * セッションで操作を記録 → 操作履歴を保存 → replay で再生し、
 * 新しい証跡が生成されることを検証する。
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { readFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { deserializeHistory } from "../src/operation-record/operation-io";

const OUTPUT_DIR = join(import.meta.dirname, "../output/e2e-replay-session");

type TextContent = { type: "text"; text: string };

function extractText(result: Record<string, unknown>): string {
  const content = (result["content"] ?? []) as Array<TextContent>;
  const item = content.find((c): c is TextContent => c.type === "text");
  return item?.text ?? "";
}

describe("MCP replay e2e", () => {
  const timeout = 60_000;
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

    const client = new Client({ name: "e2e-replay", version: "0.1.0" });
    await client.connect(transport);
    clientHolder.value = client;
  }, timeout);

  afterAll(async () => {
    if (clientHolder.value !== undefined) {
      await clientHolder.value.close();
    }
  });

  it("records a session, then replays it to produce fresh evidence", async () => {
    const client = clientHolder.value!;

    // --- Phase 1: 操作を記録 ---
    await client.callTool({
      name: "session_start",
      arguments: { title: "replay 元セッション", url: "https://example.com" },
    });
    await client.callTool({
      name: "session_navigate",
      arguments: { url: "https://example.com" },
    });
    await client.callTool({
      name: "session_evaluate",
      arguments: { expression: "document.title" },
    });

    const endResult = await client.callTool({
      name: "session_end",
      arguments: {},
    });
    const endText = extractText(endResult);
    expect(endText).toContain("操作履歴:");

    // 操作履歴ファイルパスを取得
    const historyPathMatch = endText.match(/操作履歴: (.+\.json)/);
    expect(historyPathMatch).not.toBeNull();
    const historyPath = historyPathMatch![1];

    // --- Phase 2: 操作履歴を再生 ---
    const replayResult = await client.callTool({
      name: "replay",
      arguments: { historyPath },
    });
    const replayText = extractText(replayResult);
    expect(replayText).toContain("再生完了");
    expect(replayText).toContain("操作履歴:");
    expect(replayText).toContain("証跡 XLSX:");

    // --- Phase 3: 生成されたファイルを検証 ---
    const files = await readdir(OUTPUT_DIR);

    // 元の操作履歴
    const originalFiles = files.filter((f) => f.startsWith("history-"));
    expect(originalFiles).toHaveLength(1);

    // 再生後の操作履歴
    const replayedFiles = files.filter((f) => f.startsWith("replayed-"));
    expect(replayedFiles).toHaveLength(1);

    // 証跡 XLSX (元 + 再生)
    const xlsxFiles = files.filter((f) => f.endsWith(".xlsx"));
    expect(xlsxFiles.length).toBeGreaterThanOrEqual(2);

    // 再生後の操作履歴を検証
    const replayedJson = await readFile(join(OUTPUT_DIR, replayedFiles[0]), "utf-8");
    const replayed = deserializeHistory(replayedJson);
    expect(replayed.version).toBe(1);
    expect(replayed.title).toBe("replay 元セッション");

    // 元の操作履歴を読んでエントリ数が一致するか
    const originalJson = await readFile(join(OUTPUT_DIR, originalFiles[0]), "utf-8");
    const original = deserializeHistory(originalJson);
    expect(replayed.entries).toHaveLength(original.entries.length);

    // 再生で新しいタイムスタンプが付与されている
    expect(replayed.startedAt).not.toBe(original.startedAt);

    // 再生後も navigate エントリにスクリーンショットがある
    const navEntry = replayed.entries.find((e) => e.operation.kind === "navigate");
    expect(navEntry).toBeDefined();
    expect(navEntry!.screenshot).toBeInstanceOf(Uint8Array);
    expect(navEntry!.screenshot!.length).toBeGreaterThan(0);
  }, timeout);
});
