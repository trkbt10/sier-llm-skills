/**
 * @file 操作履歴の再生。
 *
 * 記録済み OperationHistory を BrowserSession 上で順次実行し、
 * 新しいスクリーンショット付きの OperationHistory を返す。
 */

import type { BrowserSession } from "../browser-control/types";
import type { OperationEntry, OperationHistory } from "../operation-record/operation-types";

async function executeOperation(
  session: BrowserSession,
  operation: OperationEntry["operation"],
): Promise<{ evaluateResult?: unknown; url?: string }> {
  switch (operation.kind) {
    case "navigate": {
      await session.navigate(operation.url);
      return { url: operation.url };
    }
    case "click": {
      await session.click(operation.selector);
      return {};
    }
    case "type": {
      await session.type(operation.selector, operation.text);
      return {};
    }
    case "input": {
      // 手動観測の確定入力。再生時は能動入力として扱う。
      await session.type(operation.selector, operation.value);
      return {};
    }
    case "drag-and-drop": {
      // 現状は再生未対応 (synthetic dragstart/drop の合成が必要)。
      // entry の error にメッセージを残せるよう throw する。
      throw new Error("drag-and-drop replay is not implemented");
    }
    case "evaluate": {
      const evaluateResult = await session.evaluate(operation.expression);
      return { evaluateResult };
    }
    case "screenshot": {
      return {};
    }
    case "wait": {
      await new Promise((resolve) => {
        setTimeout(resolve, operation.ms);
      });
      return {};
    }
  }
}

async function screenshotIfNeeded(
  session: BrowserSession,
  kind: string,
  format: "png" | "jpeg" | "webp",
): Promise<Uint8Array | undefined> {
  if (kind === "evaluate") {
    return undefined;
  }
  return tryScreenshot(session, format);
}

async function tryScreenshot(
  session: BrowserSession,
  format: "png" | "jpeg" | "webp",
): Promise<Uint8Array | undefined> {
  try {
    return await session.screenshot({ format });
  } catch {
    return undefined;
  }
}

async function replayEntry(
  session: BrowserSession,
  original: OperationEntry,
  screenshotFormat: "png" | "jpeg" | "webp",
): Promise<OperationEntry> {
  const { operation } = original;
  const start = performance.now();
  const fallbackUrl = operation.kind === "navigate" ? operation.url : original.url;

  const outcome = await executeOperation(session, operation).then(
    (result) => ({ result, error: undefined as string | undefined }),
    (err: unknown) => ({ result: {} as { evaluateResult?: unknown; url?: string }, error: String(err) }),
  );

  const durationMs = Math.round(performance.now() - start);
  const screenshot = await screenshotIfNeeded(session, operation.kind, screenshotFormat);

  return {
    operation,
    timestamp: new Date().toISOString(),
    url: outcome.result.url ?? fallbackUrl,
    durationMs,
    ...(screenshot !== undefined ? { screenshot, screenshotFormat } : {}),
    ...(outcome.result.evaluateResult !== undefined ? { evaluateResult: outcome.result.evaluateResult } : {}),
    ...(outcome.error !== undefined ? { error: outcome.error } : {}),
  };
}

/** 操作履歴を BrowserSession 上で再生し、新たな操作履歴を返す。 */
export async function replayHistory(
  session: BrowserSession,
  history: OperationHistory,
): Promise<OperationHistory> {
  const startedAt = new Date().toISOString();
  const entries: OperationEntry[] = [];
  const screenshotFormat = history.entries.find((e) => e.screenshotFormat !== undefined)?.screenshotFormat ?? "png";

  for (const original of history.entries) {
    const entry = await replayEntry(session, original, screenshotFormat);
    entries.push(entry);
  }

  return {
    version: 1,
    title: history.title,
    startedAt,
    finishedAt: new Date().toISOString(),
    viewport: history.viewport,
    entries,
  };
}
