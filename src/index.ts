/**
 * @file Screenshot Evidence Builder for LLM.
 *
 * ブラウザー操作のスクリーンショットエビデンスを
 * XLSX ファイルとして構築するライブラリ。
 *
 * 3つのキャプチャ戦略:
 * - headless: Playwright ベースのヘッドレスブラウザー
 * - cdp: Chrome DevTools Protocol 直接接続 (Electron 互換)
 * - chrome-mcp: chrome-devtools-mcp (Google 公式 MCP) 経由
 */

export { createHeadlessCaptureStrategy } from "./capture/headless/headless-capture";
export { createCdpCaptureStrategy } from "./capture/cdp/cdp-capture";
export { createChromeMcpCaptureStrategy } from "./capture/chrome-mcp/chrome-mcp-capture";

export type {
  CaptureStrategy,
  BrowserSession,
  LaunchOptions,
  Viewport,
  ScreenshotOptions,
  ClipRegion,
} from "./capture/types";

export { buildEvidenceXlsx } from "./evidence/xlsx-builder";
export type { BuildEvidenceXlsxOptions } from "./evidence/xlsx-builder";

export type {
  EvidenceStep,
  EvidenceTestCase,
  EvidenceReport,
} from "./evidence/types";
