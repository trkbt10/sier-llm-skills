/**
 * @file 操作履歴 → EvidenceReport 変換。
 *
 * OperationHistory の各エントリを EvidenceStep にマッピングし、
 * EvidenceReport を生成する。
 */

import type { EvidenceReport, EvidenceStep, EvidenceTestCase } from "../evidence-report/types";
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
      action: describeAction(entry),
      url: entry.url,
      expected: describeExpected(entry),
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

function describeAction(entry: OperationEntry): string {
  const { operation } = entry;
  switch (operation.kind) {
    case "navigate":
      return `${operation.url} に遷移`;
    case "click":
      return `${operation.selector} をクリック`;
    case "type":
      return `${operation.selector} に "${operation.text}" を入力`;
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
      return `${operation.selector} のクリックが成功する`;
    case "type":
      return `${operation.selector} にテキストが入力される`;
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
      return `${operation.url} が正常に表示された`;
    case "click":
      return `${operation.selector} のクリックが成功した`;
    case "type":
      return `${operation.selector} にテキストが入力された`;
    case "evaluate":
      return `実行結果: ${JSON.stringify(entry.evaluateResult)}`;
    case "screenshot":
      return "スクリーンショットを取得した";
    case "wait":
      return `${operation.ms}ms の待機が完了した`;
  }
}
