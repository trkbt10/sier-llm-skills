/** @file buildManualTree の単体テスト。 */
import { buildManualTree } from "./build-manual-tree";
import type { OperationHistory } from "../operation-record/operation-types";

function entry(url: string, ts: string, kind: "navigate" | "click" | "input"): OperationHistory["entries"][number] {
  if (kind === "navigate") {
    return {
      operation: { kind: "navigate", url },
      timestamp: ts,
      url,
      durationMs: 1,
      screenshot: new Uint8Array([1]),
      screenshotFormat: "png",
    };
  }
  if (kind === "click") {
    return {
      operation: { kind: "click", selector: "#x" },
      timestamp: ts,
      url,
      durationMs: 1,
      screenshot: new Uint8Array([2]),
      screenshotFormat: "png",
    };
  }
  return {
    operation: { kind: "input", selector: "#q", value: "hello", commitTrigger: "blur" },
    timestamp: ts,
    url,
    durationMs: 1,
    screenshot: new Uint8Array([3]),
    screenshotFormat: "png",
  };
}

describe("buildManualTree", () => {
  it("splits entries into pages on URL change", () => {
    const history: OperationHistory = {
      version: 1,
      title: "test",
      startedAt: "2026-03-22T10:00:00.000Z",
      finishedAt: "2026-03-22T10:01:00.000Z",
      viewport: { width: 1280, height: 800 },
      entries: [
        entry("https://a.example.com", "2026-03-22T10:00:01.000Z", "navigate"),
        entry("https://a.example.com", "2026-03-22T10:00:02.000Z", "click"),
        entry("https://a.example.com", "2026-03-22T10:00:03.000Z", "input"),
        entry("https://b.example.com", "2026-03-22T10:00:04.000Z", "navigate"),
        entry("https://b.example.com", "2026-03-22T10:00:05.000Z", "click"),
      ],
    };

    const tree = buildManualTree(history);

    expect(tree.pages).toHaveLength(2);
    expect(tree.pages[0].url).toBe("https://a.example.com");
    expect(tree.pages[0].groups[0].entries).toHaveLength(3);
    expect(tree.pages[1].url).toBe("https://b.example.com");
    expect(tree.pages[1].groups[0].entries).toHaveLength(2);
  });

  it("preserves title and viewport from history", () => {
    const history: OperationHistory = {
      version: 1,
      title: "manual",
      startedAt: "2026-03-22T10:00:00.000Z",
      viewport: { width: 800, height: 600 },
      entries: [entry("https://x.example.com", "2026-03-22T10:00:01.000Z", "navigate")],
    };
    const tree = buildManualTree(history);
    expect(tree.title).toBe("manual");
    expect(tree.viewport).toEqual({ width: 800, height: 600 });
  });

  it("handles empty histories", () => {
    const history: OperationHistory = {
      version: 1,
      title: "empty",
      startedAt: "2026-03-22T10:00:00.000Z",
      viewport: { width: 1280, height: 800 },
      entries: [],
    };
    const tree = buildManualTree(history);
    expect(tree.pages).toHaveLength(0);
  });

  it("uses first entry url for the initial page even if not navigate", () => {
    const history: OperationHistory = {
      version: 1,
      title: "no-initial-nav",
      startedAt: "2026-03-22T10:00:00.000Z",
      viewport: { width: 1280, height: 800 },
      entries: [
        entry("https://a.example.com", "2026-03-22T10:00:01.000Z", "click"),
        entry("https://a.example.com", "2026-03-22T10:00:02.000Z", "input"),
      ],
    };
    const tree = buildManualTree(history);
    expect(tree.pages).toHaveLength(1);
    expect(tree.pages[0].url).toBe("https://a.example.com");
  });
});
