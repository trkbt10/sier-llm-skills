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

/** EvidenceStep フィールド → テンプレート列番号 (1-based) のマッピング。 */
export type TemplateColumnMapping = {
  readonly stepNumber?: number;
  readonly action?: number;
  readonly expected?: number;
  readonly actual?: number;
  readonly status?: number;
  readonly timestamp?: number;
  readonly testCaseId?: number;
};

/** テンプレートへのデータ注入設定。 */
export type TemplateConfig = {
  /** エビデンスデータを注入するシート名 */
  readonly evidenceSheet: string;
  /** ヘッダー行番号 (この行の次からデータを挿入) */
  readonly headerRow: number;
  /** フィールド → 列番号のマッピング */
  readonly columns: TemplateColumnMapping;
  /** スクリーンショットを配置する列 (0-based, Drawing anchor 用) */
  readonly screenshotColumn: number;
  /** 画像1枚分の行スペース (デフォルト: 15) */
  readonly imageRowSpan?: number;
};
