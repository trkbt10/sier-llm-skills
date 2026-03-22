/**
 * @file 操作記録 → シリアライズ → 再生 → 証跡変換の統合テスト。
 *
 * RecordingSession で操作を記録し、serializeHistory / deserializeHistory で
 * JSON ラウンドトリップした後、replayHistory で再生、
 * historyToEvidence で EvidenceReport に変換するまでの一連のフローを検証する。
 */

import type { BrowserSession } from "../src/browser-control/types";
import { createRecordingSession } from "../src/operation-capture/recording-session";
import { serializeHistory, deserializeHistory } from "../src/operation-record/operation-io";
import { replayHistory } from "../src/operation-replay/replay";
import { historyToEvidence } from "../src/operation-replay/history-to-evidence";

function createFakeSession(): BrowserSession {
  const state = { currentUrl: "", callCount: 0 };

  return {
    async navigate(url: string) {
      state.currentUrl = url;
      state.callCount += 1;
    },
    async screenshot() {
      state.callCount += 1;
      return new Uint8Array([0x89, 0x50, state.callCount]);
    },
    async click() {
      state.callCount += 1;
    },
    async type() {
      state.callCount += 1;
    },
    async evaluate<T>(expression: string): Promise<T> {
      state.callCount += 1;
      if (expression === "document.title") {
        return "Fake Title" as T;
      }
      return `eval:${expression}` as T;
    },
    async close() {
      /* noop */
    },
  };
}

describe("record → serialize → replay → evidence", () => {
  it("full pipeline produces valid EvidenceReport", async () => {
    // --- Phase 1: 操作を記録 ---
    const innerSession = createFakeSession();
    const recording = createRecordingSession({
      inner: innerSession,
      viewport: { width: 1024, height: 768 },
      screenshotFormat: "png",
    });

    await recording.navigate("https://example.com");
    await recording.click("a.link");
    await recording.type("input#search", "hello");
    await recording.evaluate("document.title");
    await recording.screenshot({ fullPage: true });

    const history = recording.finalizeHistory("統合テスト");

    // 記録されたエントリの検証
    expect(history.version).toBe(1);
    expect(history.title).toBe("統合テスト");
    expect(history.viewport).toEqual({ width: 1024, height: 768 });
    expect(history.entries).toHaveLength(5);
    expect(history.startedAt).toBeTruthy();
    expect(history.finishedAt).toBeTruthy();

    // --- Phase 2: シリアライズ → デシリアライズ ---
    const json = serializeHistory(history);
    const restored = deserializeHistory(json);

    expect(restored.entries).toHaveLength(5);
    expect(restored.title).toBe("統合テスト");
    expect(restored.viewport).toEqual({ width: 1024, height: 768 });

    // スクリーンショットの base64 ラウンドトリップ
    const navEntry = restored.entries[0];
    expect(navEntry.screenshot).toBeInstanceOf(Uint8Array);
    expect(navEntry.screenshotFormat).toBe("png");

    // evaluate のスクリーンショットは未定義
    const evalEntry = restored.entries[3];
    expect(evalEntry.screenshot).toBeUndefined();
    expect(evalEntry.evaluateResult).toBe("Fake Title");

    // --- Phase 3: 再生 ---
    const replaySession = createFakeSession();
    const replayed = await replayHistory(replaySession, restored);

    expect(replayed.version).toBe(1);
    expect(replayed.title).toBe("統合テスト");
    expect(replayed.entries).toHaveLength(5);
    expect(replayed.startedAt).not.toBe(restored.startedAt);

    // 再生後のナビゲーションエントリにスクリーンショットがある
    const replayedNav = replayed.entries[0];
    expect(replayedNav.operation.kind).toBe("navigate");
    expect(replayedNav.screenshot).toBeInstanceOf(Uint8Array);

    // 再生後の evaluate にスクリーンショットがない
    const replayedEval = replayed.entries[3];
    expect(replayedEval.operation.kind).toBe("evaluate");
    expect(replayedEval.screenshot).toBeUndefined();
    expect(replayedEval.evaluateResult).toBe("Fake Title");

    // --- Phase 4: 証跡変換 ---
    const report = historyToEvidence(replayed, {
      testCaseName: "統合テストケース",
      testCaseUrl: "https://example.com",
    });

    expect(report.title).toBe("統合テスト");
    expect(report.testCases).toHaveLength(1);

    const testCase = report.testCases[0];
    expect(testCase.name).toBe("統合テストケース");
    expect(testCase.url).toBe("https://example.com");
    expect(testCase.status).toBe("pass");

    // スクリーンショットのあるエントリだけが step になる (evaluate 以外)
    expect(testCase.steps.length).toBeGreaterThanOrEqual(4);
    for (const step of testCase.steps) {
      expect(step.stepNumber).toBeGreaterThan(0);
      expect(step.action).toBeTruthy();
      expect(step.expected).toBeTruthy();
      expect(step.actual).toBeTruthy();
      expect(step.screenshot).toBeInstanceOf(Uint8Array);
      expect(step.timestamp).toBeInstanceOf(Date);
    }
  });

  it("replayed history can also be serialized and deserialized", async () => {
    const innerSession = createFakeSession();
    const recording = createRecordingSession({
      inner: innerSession,
      viewport: { width: 800, height: 600 },
    });

    await recording.navigate("https://example.com");
    await recording.click("button");
    const history = recording.finalizeHistory("round-trip test");

    // record → serialize → deserialize → replay
    const json1 = serializeHistory(history);
    const restored1 = deserializeHistory(json1);
    const replaySession = createFakeSession();
    const replayed = await replayHistory(replaySession, restored1);

    // replay → serialize → deserialize (second round-trip)
    const json2 = serializeHistory(replayed);
    const restored2 = deserializeHistory(json2);

    expect(restored2.version).toBe(1);
    expect(restored2.title).toBe("round-trip test");
    expect(restored2.entries).toHaveLength(2);
    expect(restored2.entries[0].screenshot).toBeInstanceOf(Uint8Array);
  });

  it("error in recorded session propagates to replay and evidence", async () => {
    const state = { shouldFail: false };
    const fakeSession: BrowserSession = {
      async navigate() {
        /* noop */
      },
      async screenshot() {
        return new Uint8Array([1]);
      },
      async click(selector: string) {
        if (selector === "fail" || state.shouldFail) {
          throw new Error("click failed");
        }
      },
      async type() {
        /* noop */
      },
      async evaluate<T>(): Promise<T> {
        return undefined as T;
      },
      async close() {
        /* noop */
      },
    };

    const recording = createRecordingSession({
      inner: fakeSession,
      viewport: { width: 1280, height: 800 },
    });

    await recording.navigate("https://example.com");
    await expect(recording.click("fail")).rejects.toThrow("click failed");

    const history = recording.finalizeHistory("error test");

    // エラーエントリがある
    const errorEntry = history.entries.find((e) => e.error !== undefined);
    expect(errorEntry).toBeDefined();
    expect(errorEntry!.error).toContain("click failed");

    // serialize → deserialize でエラー情報が保持される
    const json = serializeHistory(history);
    const restored = deserializeHistory(json);
    const restoredError = restored.entries.find((e) => e.error !== undefined);
    expect(restoredError).toBeDefined();
    expect(restoredError!.error).toContain("click failed");

    // 再生時にも同じセレクタで失敗するが、replay は中断しない
    state.shouldFail = true;
    const replayed = await replayHistory(fakeSession, restored);
    expect(replayed.entries).toHaveLength(2);
    const replayedError = replayed.entries.find((e) => e.error !== undefined);
    expect(replayedError).toBeDefined();

    // 証跡変換でステータスが fail になる
    const report = historyToEvidence(replayed, {
      testCaseName: "error test",
      testCaseUrl: "https://example.com",
    });
    expect(report.testCases[0].status).toBe("fail");
  });
});
