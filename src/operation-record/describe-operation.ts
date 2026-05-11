/**
 * @file OperationEntry を日本語の自然文 (進行形/過去形) に整形する。
 *
 * 進捗表示・LLM への中間出力・xlsx 既定説明文の生成元として共有する SoT。
 */

import type { OperationEntry, PointerType } from "./operation-types";

type CommitTrigger = "blur" | "enter" | "navigate-flush";

function pressVerb(pointerType: PointerType | undefined): string {
  if (pointerType === "touch") {
    return "タップ";
  }
  if (pointerType === "pen") {
    return "ペン操作";
  }
  return "クリック";
}

/**
 * "〜をしました" / "〜が表示されました" など、操作完了済みを示す日本語文。
 *
 * error が付いていればエラー文を優先する。
 */
export function describeOperationDone(entry: OperationEntry): string {
  if (entry.error !== undefined) {
    return `エラー: ${entry.error}`;
  }
  const { operation } = entry;
  switch (operation.kind) {
    case "navigate":
      return `${operation.url} に遷移しました`;
    case "click": {
      const label = operation.semantics?.humanLabel ?? operation.selector;
      const role = operation.semantics?.role;
      const roleSuffix = role !== undefined && role !== label ? ` (${role})` : "";
      return `「${label}」${roleSuffix} を${pressVerb(operation.pointerType)}しました`;
    }
    case "type":
      return `${operation.selector} に "${operation.text}" を入力しました`;
    case "input": {
      const label = operation.semantics?.humanLabel ?? operation.selector;
      return `「${label}」に "${operation.value}" を入力しました (${commitTriggerLabel(operation.commitTrigger)})`;
    }
    case "drag-and-drop": {
      const src = operation.sourceSemantics?.humanLabel ?? operation.sourceSelector;
      const tgt = operation.targetSemantics?.humanLabel ?? operation.targetSelector;
      const verb = operation.pointerType === "touch" ? "ドラッグ" : "ドラッグ";
      return `「${src}」を「${tgt}」へ${verb}しました`;
    }
    case "evaluate":
      return `スクリプトを実行しました: ${operation.expression}`;
    case "screenshot":
      return "スクリーンショットを取得しました";
    case "wait":
      return `${operation.ms}ms 待機しました`;
  }
}

function commitTriggerLabel(trigger: CommitTrigger | undefined): string {
  switch (trigger) {
    case "blur":
      return "フォーカスアウトで確定";
    case "enter":
      return "Enter で確定";
    case "navigate-flush":
      return "ページ遷移で確定";
    case undefined:
      return "確定";
  }
}
