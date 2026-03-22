/**
 * @file 操作記録付き BrowserSession ラッパー。
 *
 * BrowserSession の全操作を OperationEntry として蓄積し、
 * finalizeHistory() で OperationHistory を返す。
 */

import type { BrowserSession, ScreenshotOptions } from "../browser-control/types";
import type { OperationEntry, OperationHistory } from "../operation-record/operation-types";

/** 操作を記録する BrowserSession 拡張。 */
export type RecordingSession = BrowserSession & {
  /** 蓄積された操作履歴を確定して返す。 */
  finalizeHistory(title: string): OperationHistory;
  /** 現在の操作エントリ一覧。 */
  readonly entries: readonly OperationEntry[];
};

export type RecordingSessionConfig = {
  readonly inner: BrowserSession;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly screenshotFormat?: "png" | "jpeg" | "webp";
};

/** RecordingSession を生成する。 */
export function createRecordingSession(config: RecordingSessionConfig): RecordingSession {
  const { inner, viewport, screenshotFormat = "png" } = config;
  const entries: OperationEntry[] = [];
  const startedAt = new Date().toISOString();
  const ctx = { currentUrl: "" };

  async function captureScreenshot(): Promise<{
    screenshot: Uint8Array;
    screenshotFormat: "png" | "jpeg" | "webp";
  }> {
    const screenshot = await inner.screenshot({ format: screenshotFormat });
    return { screenshot, screenshotFormat };
  }

  async function tryCaptureScreenshot(): Promise<
    { screenshot: Uint8Array; screenshotFormat: "png" | "jpeg" | "webp" } | undefined
  > {
    try {
      return await captureScreenshot();
    } catch {
      // スクリーンショット取得失敗は無視
      return undefined;
    }
  }

  function buildEntry(
    operation: OperationEntry["operation"],
    durationMs: number,
    screenshotData: { screenshot: Uint8Array; screenshotFormat: "png" | "jpeg" | "webp" } | undefined,
    error: string | undefined,
  ): OperationEntry {
    return {
      operation,
      timestamp: new Date().toISOString(),
      url: ctx.currentUrl,
      durationMs,
      ...(screenshotData ?? {}),
      ...(error !== undefined ? { error } : {}),
    };
  }

  async function recordAction(
    fn: () => Promise<void>,
    operation: OperationEntry["operation"],
  ): Promise<void> {
    const start = performance.now();
    const outcome = await fn().then(
      () => ({ error: undefined }),
      (err: unknown) => ({ error: String(err), rethrow: err }),
    );
    const durationMs = Math.round(performance.now() - start);
    const screenshotData = await tryCaptureScreenshot();
    entries.push(buildEntry(operation, durationMs, screenshotData, outcome.error));
    if ("rethrow" in outcome) {
      throw outcome.rethrow;
    }
  }

  return {
    get entries(): readonly OperationEntry[] {
      return entries;
    },

    async navigate(url: string): Promise<void> {
      await recordAction(
        async () => {
          await inner.navigate(url);
          ctx.currentUrl = url;
        },
        { kind: "navigate", url },
      );
    },

    async click(selector: string): Promise<void> {
      await recordAction(
        () => inner.click(selector),
        { kind: "click", selector },
      );
    },

    async type(selector: string, text: string): Promise<void> {
      await recordAction(
        () => inner.type(selector, text),
        { kind: "type", selector, text },
      );
    },

    async evaluate<T>(expression: string): Promise<T> {
      const start = performance.now();
      const outcome = await inner.evaluate<T>(expression).then(
        (value) => ({ value, error: undefined as string | undefined }),
        (err: unknown) => ({ value: undefined, error: String(err), rethrow: err }),
      );
      const durationMs = Math.round(performance.now() - start);
      entries.push({
        operation: { kind: "evaluate", expression },
        timestamp: new Date().toISOString(),
        url: ctx.currentUrl,
        durationMs,
        evaluateResult: outcome.error === undefined ? outcome.value : undefined,
        ...(outcome.error !== undefined ? { error: outcome.error } : {}),
      });
      if ("rethrow" in outcome) {
        throw outcome.rethrow;
      }
      return outcome.value as T;
    },

    async screenshot(options?: ScreenshotOptions): Promise<Uint8Array> {
      const start = performance.now();
      const data = await inner.screenshot(options);
      const durationMs = Math.round(performance.now() - start);
      entries.push({
        operation: { kind: "screenshot", options },
        timestamp: new Date().toISOString(),
        url: ctx.currentUrl,
        durationMs,
        screenshot: data,
        screenshotFormat: options?.format ?? screenshotFormat,
      });
      return data;
    },

    async close(): Promise<void> {
      await inner.close();
    },

    finalizeHistory(title: string): OperationHistory {
      return {
        version: 1,
        title,
        startedAt,
        finishedAt: new Date().toISOString(),
        viewport,
        entries,
      };
    },
  };
}
