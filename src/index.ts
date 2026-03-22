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

export { createHeadlessCaptureStrategy } from "./browser-control/headless/headless-capture";
export { createCdpCaptureStrategy } from "./browser-control/cdp/cdp-capture";
export { createChromeMcpCaptureStrategy } from "./browser-control/chrome-mcp/chrome-mcp-capture";

export type {
  CaptureStrategy,
  BrowserSession,
  LaunchOptions,
  Viewport,
  ScreenshotOptions,
  ClipRegion,
} from "./browser-control/types";

export { buildEvidenceXlsx } from "./evidence-xlsx/xlsx-builder";
export type { BuildEvidenceXlsxOptions } from "./evidence-xlsx/xlsx-builder";

export type {
  EvidenceStep,
  EvidenceTestCase,
  EvidenceReport,
  EvidenceSheetSchema,
  EvidenceColumnDef,
  ScreenshotPlacement,
  CoverSheetField,
  SummaryCells,
  CellPosition,
} from "./evidence-schema/types";

// スキーマ
export { validateEvidenceSheetSchema } from "./evidence-schema/schema-validator";
export { resolveFieldValue, buildEvidenceSheetFromSchema, buildCoverSheetValues } from "./evidence-xlsx/schema-driven-sheets";
export type { EvidenceSheetResult } from "./evidence-xlsx/schema-driven-sheets";

// 操作履歴
export type {
  BrowserOperation,
  OperationEntry,
  OperationHistory,
  StepDescription,
} from "./operation-record/operation-types";
export { serializeHistory, deserializeHistory } from "./operation-record/operation-io";
export { createRecordingSession } from "./operation-capture/recording-session";
export type { RecordingSession, RecordingSessionConfig } from "./operation-capture/recording-session";
export { replayHistory } from "./operation-replay/replay";
export { historyToEvidence } from "./operation-replay/history-to-evidence";
export type { HistoryToEvidenceOptions } from "./operation-replay/history-to-evidence";
export { createCdpRecorder } from "./operation-capture/cdp-recorder";
export type { CdpRecorder, CdpRecorderConfig } from "./operation-capture/cdp-recorder";

// XLSX 読み書き
export { readXlsxAsText, formatXlsxForLlm, formatSheetForLlm } from "./evidence-io/xlsx-reader";
export type { SheetText, SheetRow, SheetCell, XlsxReadResult } from "./evidence-io/xlsx-reader";
export { updateXlsxCells } from "./evidence-io/xlsx-writer";
export { patchXlsxWithImages } from "./evidence-io/xlsx-image-patcher";
export type { ImageInsert, SheetImagePatch } from "./evidence-io/xlsx-image-patcher";

// MCP サーバー
export { createEvidenceServer } from "./mcp/evidence-server";
export type { EvidenceServerConfig } from "./mcp/evidence-server";
