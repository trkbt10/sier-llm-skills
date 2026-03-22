/** @file createRecordingSession の単体テスト。 */
import { createRecordingSession } from "./recording-session";
import type { BrowserSession, ScreenshotOptions } from "../browser-control/types";

type CallTracker = {
  navigate: string[][];
  screenshot: ScreenshotOptions[][];
  click: string[][];
  type: Array<[string, string]>;
  evaluate: string[][];
  close: number;
};

function createFakeSession(overrides?: {
  clickError?: Error;
}): { session: BrowserSession; calls: CallTracker } {
  const calls: CallTracker = {
    navigate: [],
    screenshot: [],
    click: [],
    type: [],
    evaluate: [],
    close: 0,
  };

  const session: BrowserSession = {
    async navigate(url: string) {
      calls.navigate.push([url]);
    },
    async screenshot(options?: ScreenshotOptions) {
      calls.screenshot.push(options ? [options] : []);
      return new Uint8Array([1, 2, 3]);
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
      return "result" as T;
    },
    async close() {
      calls.close += 1;
    },
  };

  return { session, calls };
}

describe("createRecordingSession", () => {
  it("records navigate with auto-screenshot", async () => {
    const { session: mock, calls } = createFakeSession();
    const session = createRecordingSession({
      inner: mock,
      viewport: { width: 1280, height: 800 },
    });

    await session.navigate("https://example.com");

    expect(calls.navigate).toEqual([["https://example.com"]]);
    expect(calls.screenshot.length).toBeGreaterThanOrEqual(1);
    expect(session.entries).toHaveLength(1);
    expect(session.entries[0].operation).toEqual({ kind: "navigate", url: "https://example.com" });
    expect(session.entries[0].screenshot).toEqual(new Uint8Array([1, 2, 3]));
    expect(session.entries[0].url).toBe("https://example.com");
  });

  it("records click with auto-screenshot", async () => {
    const { session: mock, calls } = createFakeSession();
    const session = createRecordingSession({
      inner: mock,
      viewport: { width: 1280, height: 800 },
    });

    await session.navigate("https://example.com");
    await session.click("a.link");

    expect(calls.click).toEqual([["a.link"]]);
    expect(session.entries).toHaveLength(2);
    expect(session.entries[1].operation).toEqual({ kind: "click", selector: "a.link" });
    expect(session.entries[1].url).toBe("https://example.com");
  });

  it("records type with auto-screenshot", async () => {
    const { session: mock, calls } = createFakeSession();
    const session = createRecordingSession({
      inner: mock,
      viewport: { width: 1280, height: 800 },
    });

    await session.type("input#name", "hello");

    expect(calls.type).toEqual([["input#name", "hello"]]);
    expect(session.entries).toHaveLength(1);
    expect(session.entries[0].operation).toEqual({
      kind: "type",
      selector: "input#name",
      text: "hello",
    });
  });

  it("records evaluate without auto-screenshot", async () => {
    const { session: mock, calls } = createFakeSession();
    const session = createRecordingSession({
      inner: mock,
      viewport: { width: 1280, height: 800 },
    });

    const result = await session.evaluate<string>("document.title");

    expect(result).toBe("result");
    expect(calls.evaluate).toEqual([["document.title"]]);
    expect(session.entries).toHaveLength(1);
    expect(session.entries[0].operation).toEqual({
      kind: "evaluate",
      expression: "document.title",
    });
    expect(session.entries[0].evaluateResult).toBe("result");
    expect(session.entries[0].screenshot).toBeUndefined();
  });

  it("records explicit screenshot", async () => {
    const { session: mock } = createFakeSession();
    const session = createRecordingSession({
      inner: mock,
      viewport: { width: 1280, height: 800 },
    });

    const data = await session.screenshot({ fullPage: true });

    expect(data).toEqual(new Uint8Array([1, 2, 3]));
    expect(session.entries).toHaveLength(1);
    expect(session.entries[0].operation).toEqual({
      kind: "screenshot",
      options: { fullPage: true },
    });
    expect(session.entries[0].screenshot).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("finalizeHistory returns complete OperationHistory", async () => {
    const { session: mock } = createFakeSession();
    const session = createRecordingSession({
      inner: mock,
      viewport: { width: 1280, height: 800 },
      screenshotFormat: "jpeg",
    });

    await session.navigate("https://example.com");
    await session.click("button");
    const history = session.finalizeHistory("test session");

    expect(history.version).toBe(1);
    expect(history.title).toBe("test session");
    expect(history.viewport).toEqual({ width: 1280, height: 800 });
    expect(history.entries).toHaveLength(2);
    expect(history.startedAt).toBeTruthy();
    expect(history.finishedAt).toBeTruthy();
  });

  it("delegates close to inner session", async () => {
    const { session: mock, calls } = createFakeSession();
    const session = createRecordingSession({
      inner: mock,
      viewport: { width: 1280, height: 800 },
    });

    await session.close();
    expect(calls.close).toBe(1);
  });

  it("records error on failed action", async () => {
    const { session: mock } = createFakeSession({
      clickError: new Error("element not found"),
    });
    const session = createRecordingSession({
      inner: mock,
      viewport: { width: 1280, height: 800 },
    });

    await expect(session.click("missing")).rejects.toThrow("element not found");
    expect(session.entries).toHaveLength(1);
    expect(session.entries[0].error).toContain("element not found");
  });

  it("propagates screenshotFormat to entries", async () => {
    const { session: mock } = createFakeSession();
    const session = createRecordingSession({
      inner: mock,
      viewport: { width: 1280, height: 800 },
      screenshotFormat: "jpeg",
    });

    await session.navigate("https://example.com");

    expect(session.entries[0].screenshotFormat).toBe("jpeg");
  });

  it("defaults screenshotFormat to png", async () => {
    const { session: mock } = createFakeSession();
    const session = createRecordingSession({
      inner: mock,
      viewport: { width: 1280, height: 800 },
    });

    await session.navigate("https://example.com");

    expect(session.entries[0].screenshotFormat).toBe("png");
  });

  it("records durationMs as non-negative number", async () => {
    const { session: mock } = createFakeSession();
    const session = createRecordingSession({
      inner: mock,
      viewport: { width: 1280, height: 800 },
    });

    await session.navigate("https://example.com");
    await session.click("a");
    await session.evaluate("1+1");

    for (const entry of session.entries) {
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(entry.durationMs)).toBe(true);
    }
  });

  it("preserves operation order across multiple actions", async () => {
    const { session: mock } = createFakeSession();
    const session = createRecordingSession({
      inner: mock,
      viewport: { width: 1280, height: 800 },
    });

    await session.navigate("https://example.com");
    await session.click("button");
    await session.type("input", "text");
    await session.evaluate("1");
    await session.screenshot();

    expect(session.entries).toHaveLength(5);
    expect(session.entries[0].operation.kind).toBe("navigate");
    expect(session.entries[1].operation.kind).toBe("click");
    expect(session.entries[2].operation.kind).toBe("type");
    expect(session.entries[3].operation.kind).toBe("evaluate");
    expect(session.entries[4].operation.kind).toBe("screenshot");
  });

  it("tracks url from navigate into subsequent entries", async () => {
    const { session: mock } = createFakeSession();
    const session = createRecordingSession({
      inner: mock,
      viewport: { width: 1280, height: 800 },
    });

    await session.navigate("https://a.example.com");
    await session.click("a");
    await session.navigate("https://b.example.com");
    await session.click("button");

    expect(session.entries[0].url).toBe("https://a.example.com");
    expect(session.entries[1].url).toBe("https://a.example.com");
    expect(session.entries[2].url).toBe("https://b.example.com");
    expect(session.entries[3].url).toBe("https://b.example.com");
  });

  it("records ISO 8601 timestamps", async () => {
    const { session: mock } = createFakeSession();
    const session = createRecordingSession({
      inner: mock,
      viewport: { width: 1280, height: 800 },
    });

    await session.navigate("https://example.com");

    const ts = session.entries[0].timestamp;
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it("records error entry even when screenshot succeeds after failure", async () => {
    const { session: mock } = createFakeSession({
      clickError: new Error("timeout"),
    });
    const session = createRecordingSession({
      inner: mock,
      viewport: { width: 1280, height: 800 },
    });

    await expect(session.click("slow")).rejects.toThrow("timeout");

    const entry = session.entries[0];
    expect(entry.error).toContain("timeout");
    // スクリーンショットはエラー後も試みられる
    expect(entry.screenshot).toEqual(new Uint8Array([1, 2, 3]));
  });
});
