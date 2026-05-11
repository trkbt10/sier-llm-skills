/**
 * @file ブラウザ操作履歴の型定義。
 *
 * 操作の記録・再生・証跡生成の共通データ構造。
 */

import type { ScreenshotOptions } from "../browser-control/types";

/**
 * 要素の意味的な役割。
 * label/aria-label/placeholder などから類推した「人間がその要素を呼ぶ呼称」。
 */
export type ElementSemantics = {
  /** 人間向けの呼称 (例: "検索ボタン", "ユーザー名入力欄")。 */
  readonly humanLabel: string;
  /** セマンティックな役割 (例: "button", "textbox", "link", "submit-button")。 */
  readonly role: string;
};

/** 要素の画面上矩形 (px、viewport 座標系)。 */
export type TargetRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * 入力デバイス種別。
 * PointerEvent.pointerType に対応 (mouse/touch/pen)。
 * 不明な場合 (CLI からの能動操作など) は undefined。
 */
export type PointerType = "mouse" | "touch" | "pen";

/** ブラウザに対する個々の操作。 */
export type BrowserOperation =
  | { readonly kind: "navigate"; readonly url: string }
  | {
      readonly kind: "click";
      readonly selector: string;
      /** 要素の意味情報。手動観測時のみ DOM から抽出して付与。 */
      readonly semantics?: ElementSemantics;
      /** 入力デバイス種別 (手動観測時のみ)。 */
      readonly pointerType?: PointerType;
    }
  | { readonly kind: "type"; readonly selector: string; readonly text: string }
  | {
      /**
       * 手動観測されたフォーム入力の確定値。
       * "type" は CLI/MCP からの能動入力。"input" は cdp-recorder が
       * blur/Enter を境界に「入力し切り」を 1 イベントとして記録した値。
       */
      readonly kind: "input";
      readonly selector: string;
      readonly value: string;
      /** 入力確定のトリガー (blur / enter / navigate-flush)。 */
      readonly commitTrigger?: "blur" | "enter" | "navigate-flush";
      /** 要素の意味情報。手動観測時のみ DOM から抽出して付与。 */
      readonly semantics?: ElementSemantics;
      /** 入力デバイス種別 (手動観測時のみ)。 */
      readonly pointerType?: PointerType;
    }
  | {
      /**
       * 手動観測されたドラッグ＆ドロップ操作。
       * HTML5 DnD (dragstart/drop) または touch ドラッグから記録される。
       * sourceRect/targetRect は OperationEntry.targetRect ではなく、
       * ここに 2 つ並べる (1 操作で 2 つの矩形が必要なため)。
       */
      readonly kind: "drag-and-drop";
      readonly sourceSelector: string;
      readonly targetSelector: string;
      readonly sourceSemantics?: ElementSemantics;
      readonly targetSemantics?: ElementSemantics;
      readonly sourceRect?: TargetRect;
      readonly targetRect?: TargetRect;
      readonly pointerType?: PointerType;
    }
  | { readonly kind: "evaluate"; readonly expression: string }
  | { readonly kind: "screenshot"; readonly options?: ScreenshotOptions }
  | { readonly kind: "wait"; readonly ms: number };

/** テスト仕様書における操作ステップの記述。 */
export type StepDescription = {
  /** 操作手順 (例: "ログインボタンを押下する")。 */
  readonly action: string;
  /** 期待結果 (例: "ダッシュボード画面に遷移すること")。 */
  readonly expected: string;
};

/** 操作実行後のエントリ (操作 + 実行結果メタデータ)。 */
export type OperationEntry = {
  readonly operation: BrowserOperation;
  /** テスト仕様書の操作手順・期待結果。省略時は operation から自動生成。 */
  readonly step?: StepDescription;
  /** 操作実行時刻 (ISO 8601)。 */
  readonly timestamp: string;
  /** 操作時点の URL。 */
  readonly url: string;
  /** 操作の実行時間 (ms)。 */
  readonly durationMs: number;
  /** 操作後のスクリーンショット (after)。 */
  readonly screenshot?: Uint8Array;
  /** スクリーンショットのフォーマット (after)。 */
  readonly screenshotFormat?: "png" | "jpeg" | "webp";
  /**
   * 操作直前のスクリーンショット (before)。
   * 手動観測 (cdp-recorder) で mousedown/keydown 時点に撮る。
   * 「これからこの画面で X をします」式のマニュアル素材に使う。
   */
  readonly screenshotBefore?: Uint8Array;
  readonly screenshotBeforeFormat?: "png" | "jpeg" | "webp";
  /** evaluate の戻り値。 */
  readonly evaluateResult?: unknown;
  /** エラーメッセージ (操作失敗時)。 */
  readonly error?: string;
  /** 操作対象要素の画面上矩形。後段のハイライト描画などで利用する。 */
  readonly targetRect?: TargetRect;
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
