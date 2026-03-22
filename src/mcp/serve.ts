/**
 * @file 証跡エビデンス MCP サーバーの CLI エントリポイント。
 *
 * bun run src/mcp/serve.ts で起動する。
 * stdio トランスポートで MCP クライアントと通信する。
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHeadlessCaptureStrategy } from "../browser-control/headless/headless-capture";
import { createEvidenceServer } from "./evidence-server";

const OUTPUT_DIR = process.env["OUTPUT_DIR"] ?? "./output";

const strategy = createHeadlessCaptureStrategy(async (opts) => {
  // eslint-disable-next-line no-restricted-syntax -- dynamic import: playwright is a peer dependency
  const pw = await import("playwright");
  return pw.chromium.launch({ headless: opts.headless }) as ReturnType<
    Parameters<typeof createHeadlessCaptureStrategy>[0]
  >;
});

const server = createEvidenceServer({
  strategy,
  launchOptions: {
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  outputDir: OUTPUT_DIR,
});

const transport = new StdioServerTransport();
await server.connect(transport);
