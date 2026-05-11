/**
 * @file ManualTree → EvidenceReport 変換。
 *
 * 1 ページの xlsx 操作説明書に対応する EvidenceReport を組み立てる。
 * ページごとに見出し行 (section step) を挿入し、続けて操作行を並べる。
 *
 * Section step の判別:
 *   screenshot が 0 バイトの Uint8Array であれば「見出し行」として描画する。
 *   この sentinel は schema-driven-sheets.ts 側でレイアウト分岐に用いる。
 */

import type { EvidenceReport, EvidenceStep, EvidenceTestCase } from "../evidence-schema/types";
import type { OperationEntry } from "../operation-record/operation-types";
import type { ManualTree, OperationGroup, PageSegment } from "../operation-segments/manual-tree-types";

export type TreeToEvidenceOptions = {
  /** EvidenceTestCase.name に用いる名称。省略時は tree.title。 */
  readonly testCaseName?: string;
  /** EvidenceTestCase.url に用いる URL。省略時は最初の PageSegment の URL。 */
  readonly testCaseUrl?: string;
};

/** Section step の sentinel screenshot。 */
const SECTION_SCREENSHOT: Uint8Array = new Uint8Array(0);

/**
 * Section step かどうかを判定する。
 * tree-to-evidence と schema-driven-sheets が共有する SoT。
 */
export function isSectionStep(step: EvidenceStep): boolean {
  return step.screenshot.length === 0;
}

/** ManualTree を EvidenceReport に変換する。 */
export function treeToEvidence(tree: ManualTree, options?: TreeToEvidenceOptions): EvidenceReport {
  const steps: EvidenceStep[] = [];
  const counter = { operationStepNumber: 0 };

  for (const page of tree.pages) {
    steps.push(buildPageSectionStep(page, steps.length + 1));

    for (const group of page.groups) {
      if (group.heading !== undefined && group.heading.length > 0) {
        steps.push(buildGroupSectionStep(group, page, steps.length + 1));
      }
      for (const entry of group.entries) {
        if (entry.screenshot === undefined) {
          continue;
        }
        counter.operationStepNumber += 1;
        steps.push(buildOperationStep(entry, counter.operationStepNumber));
      }
    }
  }

  const startedAt = new Date(tree.startedAt);
  const finishedAt = new Date(tree.finishedAt ?? tree.startedAt);
  const firstUrl = tree.pages[0]?.url ?? "";

  const status: EvidenceTestCase["status"] = hasError(tree) ? "fail" : "pass";

  const testCase: EvidenceTestCase = {
    name: options?.testCaseName ?? tree.title,
    url: options?.testCaseUrl ?? firstUrl,
    status,
    startedAt,
    finishedAt,
    steps,
  };

  return {
    title: tree.title,
    createdAt: startedAt,
    testCases: [testCase],
  };
}

function resolvePageHeading(page: PageSegment): string {
  if (page.pageTitle !== undefined && page.pageTitle.length > 0) {
    return page.pageTitle;
  }
  return page.url;
}

function buildPageSectionStep(page: PageSegment, stepNumber: number): EvidenceStep {
  const heading = resolvePageHeading(page);
  return {
    stepNumber,
    action: heading,
    url: page.url,
    expected: "",
    actual: "",
    screenshot: SECTION_SCREENSHOT,
    screenshotFormat: "png",
    timestamp: new Date(page.startedAt),
  };
}

function buildGroupSectionStep(
  group: OperationGroup,
  page: PageSegment,
  stepNumber: number,
): EvidenceStep {
  return {
    stepNumber,
    action: group.heading ?? "",
    url: page.url,
    expected: "",
    actual: "",
    screenshot: SECTION_SCREENSHOT,
    screenshotFormat: "png",
    timestamp: new Date(page.startedAt),
  };
}

function buildOperationStep(entry: OperationEntry, stepNumber: number): EvidenceStep {
  const screenshot = entry.screenshot;
  if (screenshot === undefined) {
    throw new Error("buildOperationStep called with entry lacking screenshot");
  }
  return {
    stepNumber,
    action: entry.step?.action ?? describeAction(entry),
    url: entry.url,
    expected: entry.step?.expected ?? describeExpected(entry),
    actual: describeActual(entry),
    screenshot,
    screenshotFormat: entry.screenshotFormat ?? "png",
    timestamp: new Date(entry.timestamp),
  };
}

function hasError(tree: ManualTree): boolean {
  for (const page of tree.pages) {
    for (const group of page.groups) {
      for (const entry of group.entries) {
        if (entry.error !== undefined) {
          return true;
        }
      }
    }
  }
  return false;
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
      return `${operation.ms}ms 待機を完了した`;
  }
}
