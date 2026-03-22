/**
 * @file ブラウザ操作履歴の型定義。
 *
 * 操作の記録・再生・証跡生成の共通データ構造。
 */

import type { ScreenshotOptions } from "../browser-control/types";

/** ブラウザに対する個々の操作。 */
export type BrowserOperation =
  | { readonly kind: "navigate"; readonly url: string }
  | { readonly kind: "click"; readonly selector: string }
  | { readonly kind: "type"; readonly selector: string; readonly text: string }
  | { readonly kind: "evaluate"; readonly expression: string }
  | { readonly kind: "screenshot"; readonly options?: ScreenshotOptions }
  | { readonly kind: "wait"; readonly ms: number };

/** 操作実行後のエントリ (操作 + 実行結果メタデータ)。 */
export type OperationEntry = {
  readonly operation: BrowserOperation;
  /** 操作実行時刻 (ISO 8601)。 */
  readonly timestamp: string;
  /** 操作時点の URL。 */
  readonly url: string;
  /** 操作の実行時間 (ms)。 */
  readonly durationMs: number;
  /** 操作後のスクリーンショット。 */
  readonly screenshot?: Uint8Array;
  /** スクリーンショットのフォーマット。 */
  readonly screenshotFormat?: "png" | "jpeg" | "webp";
  /** evaluate の戻り値。 */
  readonly evaluateResult?: unknown;
  /** エラーメッセージ (操作失敗時)。 */
  readonly error?: string;
};

/** 操作履歴全体。 */
export type OperationHistory = {
  readonly version: 1;
  readonly title: string;
  /** セッション開始時刻 (ISO 8601)。 */
  readonly startedAt: string;
  /** セッション終了時刻 (ISO 8601)。 */
  readonly finishedAt?: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly entries: readonly OperationEntry[];
};
