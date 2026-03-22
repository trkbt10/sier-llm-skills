/** @file replayHistory の単体テスト。 */
import { replayHistory } from "./replay";
import type { BrowserSession } from "../browser-control/types";
import type { OperationHistory } from "../operation-record/operation-types";

type CallTracker = {
  navigate: string[][];
  click: string[][];
  type: Array<[string, string]>;
  evaluate: string[][];
};

function createFakeSession(overrides?: {
  clickError?: Error;
}): { session: BrowserSession; calls: CallTracker } {
  const calls: CallTracker = {
    navigate: [],
    click: [],
    type: [],
    evaluate: [],
  };

  const session: BrowserSession = {
    async navigate(url: string) {
      calls.navigate.push([url]);
    },
    async screenshot() {
      return new Uint8Array([10, 20]);
    },
    async click(selector: string) {
      if (overrides?.clickError) {
        throw overrides.clickError;
      }
      calls.click.push([selector]);
    },
    async type(selector: string, text: string) {
      calls.type.push([selector, text]);
    },
    async evaluate<T>(fn: string): Promise<T> {
      calls.evaluate.push([fn]);
      return "replayed-result" as T;
    },
    async close() {
      /* noop */
    },
  };

  return { session, calls };
}

const sampleHistory: OperationHistory = {
  version: 1,
  title: "replay test",
  startedAt: "2026-03-22T10:00:00.000Z",
  finishedAt: "2026-03-22T10:01:00.000Z",
  viewport: { width: 1280, height: 800 },
  entries: [
    {
      operation: { kind: "navigate", url: "https://example.com" },
      timestamp: "2026-03-22T10:00:01.000Z",
      url: "https://example.com",
      durationMs: 500,
      screenshot: new Uint8Array([1]),
      screenshotFormat: "png",
    },
    {
      operation: { kind: "click", selector: "a" },
      timestamp: "2026-03-22T10:00:02.000Z",
      url: "https://example.com",
      durationMs: 100,
      screenshot: new Uint8Array([2]),
      screenshotFormat: "png",
    },
    {
      operation: { kind: "evaluate", expression: "document.title" },
      timestamp: "2026-03-22T10:00:03.000Z",
      url: "https://example.com",
      durationMs: 10,
      evaluateResult: "Example Domain",
    },
  ],
};

describe("replayHistory", () => {
  it("replays all operations in order", async () => {
    const { session: mock, calls } = createFakeSession();
    const result = await replayHistory(mock, sampleHistory);

    expect(calls.navigate).toEqual([["https://example.com"]]);
    expect(calls.click).toEqual([["a"]]);
    expect(calls.evaluate).toEqual([["document.title"]]);
    expect(result.entries).toHaveLength(3);
  });

  it("returns new OperationHistory with fresh timestamps", async () => {
    const { session: mock } = createFakeSession();
    const result = await replayHistory(mock, sampleHistory);

    expect(result.version).toBe(1);
    expect(result.title).toBe("replay test");
    expect(result.startedAt).not.toBe(sampleHistory.startedAt);
    expect(result.finishedAt).toBeTruthy();
    expect(result.viewport).toEqual({ width: 1280, height: 800 });
  });

  it("captures new screenshots for non-evaluate operations", async () => {
    const { session: mock } = createFakeSession();
    const result = await replayHistory(mock, sampleHistory);

    // navigate and click should have new screenshots
    expect(result.entries[0].screenshot).toEqual(new Uint8Array([10, 20]));
    expect(result.entries[1].screenshot).toEqual(new Uint8Array([10, 20]));
    // evaluate should not have a screenshot
    expect(result.entries[2].screenshot).toBeUndefined();
  });

  it("captures evaluateResult for evaluate operations", async () => {
    const { session: mock } = createFakeSession();
    const result = await replayHistory(mock, sampleHistory);

    expect(result.entries[2].evaluateResult).toBe("replayed-result");
  });

  it("records errors without stopping replay", async () => {
    const { session: mock } = createFakeSession({
      clickError: new Error("not found"),
    });
    const result = await replayHistory(mock, sampleHistory);

    expect(result.entries).toHaveLength(3);
    expect(result.entries[1].error).toContain("not found");
  });

  it("replays type operations", async () => {
    const { session: mock, calls } = createFakeSession();
    const historyWithType: OperationHistory = {
      ...sampleHistory,
      entries: [
        {
          operation: { kind: "type", selector: "input", text: "hello" },
          timestamp: "2026-03-22T10:00:01.000Z",
          url: "https://example.com",
          durationMs: 50,
          screenshot: new Uint8Array([1]),
          screenshotFormat: "png",
        },
      ],
    };

    await replayHistory(mock, historyWithType);
    expect(calls.type).toEqual([["input", "hello"]]);
  });

  it("replays wait operations", async () => {
    const { session: mock } = createFakeSession();
    const historyWithWait: OperationHistory = {
      ...sampleHistory,
      entries: [
        {
          operation: { kind: "wait", ms: 10 },
          timestamp: "2026-03-22T10:00:01.000Z",
          url: "https://example.com",
          durationMs: 10,
        },
      ],
    };

    const result = await replayHistory(mock, historyWithWait);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});
