/**
 * @file 操作履歴 → EvidenceReport 変換。
 *
 * OperationHistory の各エントリを EvidenceStep にマッピングし、
 * EvidenceReport を生成する。
 */

import type { EvidenceReport, EvidenceStep, EvidenceTestCase } from "../evidence-schema/types";
import type { OperationEntry, OperationHistory } from "../operation-record/operation-types";

export type HistoryToEvidenceOptions = {
  readonly testCaseName: string;
  readonly testCaseUrl: string;
};

/** OperationHistory を EvidenceReport に変換する。 */
export function historyToEvidence(
  history: OperationHistory,
  options: HistoryToEvidenceOptions,
): EvidenceReport {
  const steps: EvidenceStep[] = [];
  for (const entry of history.entries) {
    if (entry.screenshot === undefined) {
      continue;
    }

    steps.push({
      stepNumber: steps.length + 1,
      action: entry.step?.action ?? describeAction(entry),
      url: entry.url,
      expected: entry.step?.expected ?? describeExpected(entry),
      actual: describeActual(entry),
      screenshot: entry.screenshot,
      screenshotFormat: entry.screenshotFormat ?? "png",
      timestamp: new Date(entry.timestamp),
    });
  }

  const testCase: EvidenceTestCase = {
    name: options.testCaseName,
    url: options.testCaseUrl,
    status: history.entries.some((e) => e.error !== undefined) ? "fail" : "pass",
    startedAt: new Date(history.startedAt),
    finishedAt: new Date(history.finishedAt ?? history.startedAt),
    steps,
  };

  return {
    title: history.title,
    createdAt: new Date(history.startedAt),
    testCases: [testCase],
  };
}

function targetLabel(operation: OperationEntry["operation"]): string {
  if (operation.kind === "click" || operation.kind === "input") {
    return operation.semantics?.humanLabel ?? operation.selector;
  }
  if (operation.kind === "type") {
    return operation.selector;
  }
  return "";
}

function dragLabels(operation: Extract<OperationEntry["operation"], { kind: "drag-and-drop" }>): { src: string; tgt: string } {
  return {
    src: operation.sourceSemantics?.humanLabel ?? operation.sourceSelector,
    tgt: operation.targetSemantics?.humanLabel ?? operation.targetSelector,
  };
}

function describeAction(entry: OperationEntry): string {
  const { operation } = entry;
  switch (operation.kind) {
    case "navigate":
      return `${operation.url} に遷移`;
    case "click":
      return `「${targetLabel(operation)}」をクリック`;
    case "type":
      return `${operation.selector} に "${operation.text}" を入力`;
    case "input":
      return `「${targetLabel(operation)}」に "${operation.value}" を入力`;
    case "drag-and-drop": {
      const { src, tgt } = dragLabels(operation);
      return `「${src}」を「${tgt}」へドラッグ`;
    }
    case "evaluate":
      return `スクリプト実行: ${operation.expression}`;
    case "screenshot":
      return "スクリーンショット取得";
    case "wait":
      return `${operation.ms}ms 待機`;
  }
}

function describeExpected(entry: OperationEntry): string {
  const { operation } = entry;
  switch (operation.kind) {
    case "navigate":
      return `${operation.url} が表示される`;
    case "click":
      return `「${targetLabel(operation)}」のクリックが受理される`;
    case "type":
      return `${operation.selector} にテキストが入力される`;
    case "input":
      return `「${targetLabel(operation)}」に値が確定する`;
    case "drag-and-drop": {
      const { src, tgt } = dragLabels(operation);
      return `「${src}」が「${tgt}」にドロップされる`;
    }
    case "evaluate":
      return "スクリプトが正常に実行される";
    case "screenshot":
      return "スクリーンショットが取得される";
    case "wait":
      return `${operation.ms}ms の待機が完了する`;
  }
}

function describeActual(entry: OperationEntry): string {
  if (entry.error !== undefined) {
    return `エラー: ${entry.error}`;
  }

  const { operation } = entry;
  switch (operation.kind) {
    case "navigate":
      return `${operation.url} が表示された`;
    case "click":
      return `「${targetLabel(operation)}」をクリックした`;
    case "type":
      return `${operation.selector} にテキストを入力した`;
    case "input":
      return `「${targetLabel(operation)}」に "${operation.value}" を入力した`;
    case "drag-and-drop": {
      const { src, tgt } = dragLabels(operation);
      return `「${src}」を「${tgt}」へドロップした`;
    }
    case "evaluate":
      return `実行結果: ${JSON.stringify(entry.evaluateResult)}`;
    case "screenshot":
      return "スクリーンショットを取得した";
    case "wait":
      return `${operation.ms}ms の待機が完了した`;
  }
}
