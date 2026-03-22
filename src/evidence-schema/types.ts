/**
 * @file スクリーンショットエビデンスの型定義。
 */

export type EvidenceStep = {
  readonly stepNumber: number;
  readonly action: string;
  readonly url: string;
  readonly expected: string;
  readonly actual: string;
  readonly screenshot: Uint8Array;
  readonly screenshotFormat: "png" | "jpeg" | "webp";
  readonly timestamp: Date;
};

export type EvidenceTestCase = {
  readonly name: string;
  readonly url: string;
  readonly status: "pass" | "fail" | "error";
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly steps: readonly EvidenceStep[];
};

export type EvidenceReport = {
  readonly title: string;
  readonly createdAt: Date;
  readonly testCases: readonly EvidenceTestCase[];
};

// --- EvidenceSheetSchema: LLM がテスト仕様書から推測するマッピングスキーマ ---

/** XLSX 上のセル位置指定。 */
export type CellPosition = {
  readonly sheet: string;
  readonly col: string;
  readonly row: number;
};

/** 表紙シートのメタデータフィールド。 */
export type CoverSheetField = {
  /** ラベル (例: "プロジェクト名")。 */
  readonly label: string;
  /** 値を書き込むセル位置。 */
  readonly valuePosition: CellPosition;
};

/** サマリセル群。 */
export type SummaryCells = {
  readonly plannedCases?: CellPosition;
  readonly executedCases?: CellPosition;
  readonly okCount?: CellPosition;
  readonly ngCount?: CellPosition;
};

/** 証跡シートの 1 カラム定義。 */
export type EvidenceColumnDef = {
  /** 列番号 (1-based)。 */
  readonly columnIndex: number;
  /** フィールド名。"stepNumber" | "action" | "expected" | "actual" | "status" | "timestamp" | "testCaseId" | 任意。 */
  readonly field: string;
  /** ヘッダーテキスト (例: "操作手順")。 */
  readonly header: string;
  /** 列幅。 */
  readonly width?: number;
};

/** スクリーンショット配置設定。 */
export type ScreenshotPlacement = {
  /** 列番号 (1-based)。 */
  readonly columnIndex: number;
  /** 画像 1 枚分の行スペース。 */
  readonly imageRowSpan: number;
};

/** LLM がテスト仕様書から推測して生成するマッピングスキーマ。 */
export type EvidenceSheetSchema = {
  readonly version: 1;
  /** 表紙シートのメタデータ定義。 */
  readonly coverSheet?: {
    readonly sheetName: string;
    readonly fields: readonly CoverSheetField[];
    readonly summary?: SummaryCells;
  };
  /** 証跡シートの構成。 */
  readonly evidenceSheet: {
    readonly sheetName: string;
    readonly headerRow: number;
    readonly columns: readonly EvidenceColumnDef[];
    readonly screenshot: ScreenshotPlacement;
  };
};

