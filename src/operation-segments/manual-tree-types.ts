/**
 * @file ManualTree 関連の型定義。
 *
 * OperationHistory (flat entries) を URL 境界で PageSegment に分割し、
 * 推敲を経て 1 ページの xlsx 操作説明書 (マニュアル) に変換するための
 * 中間ツリー構造の SoT。
 */

import type { OperationEntry } from "../operation-record/operation-types";

/**
 * 単一のページ区間に属する操作群。
 *
 * 推敲フェーズでサブ見出しや章タイトルが付与される。
 */
export type OperationGroup = {
  /** 任意の見出し (推敲で付与)。 */
  readonly heading?: string;
  /** 操作エントリ群 (元 OperationHistory のサブセット)。 */
  readonly entries: readonly OperationEntry[];
};

/**
 * URL 変化を境界に区切られた 1 ページ分のセグメント。
 *
 * URL のみで境界を判定するため、シングルページアプリの内部状態遷移は
 * 取り込まれない (要求仕様どおり)。
 */
export type PageSegment = {
  /** このセグメントの URL。 */
  readonly url: string;
  /** ページ見出し (推敲で付与、未推敲時は host/path から推測値またはなし)。 */
  readonly pageTitle?: string;
  /** セグメント開始時刻 (ISO 8601)。 */
  readonly startedAt: string;
  /** セグメント終了時刻 (ISO 8601、最終セグメントは履歴 finishedAt と同値)。 */
  readonly endedAt: string;
  /** 操作グループ。推敲前は groups[0] に全 entries が入る。 */
  readonly groups: readonly OperationGroup[];
};

/**
 * 操作の木 (マニュアルツリー)。
 *
 * History → buildManualTree → ManualTree → refine → tree-to-evidence の流れで、
 * 1 ページの xlsx 操作説明書を組み立てる中間表現。
 */
export type ManualTree = {
  readonly version: 1;
  readonly title: string;
  /** 元 History の開始時刻 (ISO 8601)。 */
  readonly startedAt: string;
  /** 元 History の終了時刻 (ISO 8601)。 */
  readonly finishedAt?: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly pages: readonly PageSegment[];
};

/**
 * 推敲 (refine) で適用するパッチ定義。
 *
 * ユーザー手編集と LLM 補助の双方から流し込めるよう、座標 (pageIndex,
 * groupIndex, entryIndex) ベースでフィールドを差し替える。
 */
export type ManualTreeEdits = {
  /** マニュアル全体のタイトル差し替え。 */
  readonly title?: string;
  readonly pages?: readonly ManualTreePageEdit[];
};

export type ManualTreePageEdit = {
  readonly pageIndex: number;
  readonly pageTitle?: string;
  readonly groups?: readonly ManualTreeGroupEdit[];
};

export type ManualTreeGroupEdit = {
  readonly groupIndex: number;
  readonly heading?: string;
  readonly entries?: readonly ManualTreeEntryEdit[];
};

/**
 * エントリへのパッチ。
 *
 * entry 自体の差し替えではなく、operation を覆い隠さない範囲で
 * step (action/expected) を後付けする。
 */
export type ManualTreeEntryEdit = {
  readonly entryIndex: number;
  readonly action?: string;
  readonly expected?: string;
};
