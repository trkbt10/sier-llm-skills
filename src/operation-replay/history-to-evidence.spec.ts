/** @file historyToEvidence の単体テスト。 */
import { historyToEvidence } from "./history-to-evidence";
import type { OperationHistory } from "../operation-record/operation-types";

const sampleHistory: OperationHistory = {
  version: 1,
  title: "example.com テスト",
  startedAt: "2026-03-22T10:00:00.000Z",
  finishedAt: "2026-03-22T10:01:00.000Z",
  viewport: { width: 1280, height: 800 },
  entries: [
    {
      operation: { kind: "navigate", url: "https://example.com" },
      timestamp: "2026-03-22T10:00:01.000Z",
      url: "https://example.com",
      durationMs: 500,
      screenshot: new Uint8Array([1, 2, 3]),
      screenshotFormat: "png",
    },
    {
      operation: { kind: "evaluate", expression: "document.title" },
      timestamp: "2026-03-22T10:00:02.000Z",
      url: "https://example.com",
      durationMs: 10,
      evaluateResult: "Example Domain",
    },
    {
      operation: { kind: "click", selector: "a" },
      timestamp: "2026-03-22T10:00:03.000Z",
      url: "https://example.com",
      durationMs: 100,
      screenshot: new Uint8Array([4, 5, 6]),
      screenshotFormat: "png",
    },
  ],
};

describe("historyToEvidence", () => {
  it("converts history to EvidenceReport", () => {
    const report = historyToEvidence(sampleHistory, {
      testCaseName: "基本操作",
      testCaseUrl: "https://example.com",
    });

    expect(report.title).toBe("example.com テスト");
    expect(report.testCases).toHaveLength(1);
    expect(report.testCases[0].name).toBe("基本操作");
    expect(report.testCases[0].status).toBe("pass");
  });

  it("skips entries without screenshots", () => {
    const report = historyToEvidence(sampleHistory, {
      testCaseName: "test",
      testCaseUrl: "https://example.com",
    });

    // navigate + click have screenshots, evaluate does not
    expect(report.testCases[0].steps).toHaveLength(2);
    expect(report.testCases[0].steps[0].stepNumber).toBe(1);
    expect(report.testCases[0].steps[1].stepNumber).toBe(2);
  });

  it("generates action descriptions", () => {
    const report = historyToEvidence(sampleHistory, {
      testCaseName: "test",
      testCaseUrl: "https://example.com",
    });

    expect(report.testCases[0].steps[0].action).toContain("https://example.com");
    expect(report.testCases[0].steps[0].action).toContain("遷移");
    expect(report.testCases[0].steps[1].action).toContain("a");
    expect(report.testCases[0].steps[1].action).toContain("クリック");
  });

  it("sets status to fail when any entry has an error", () => {
    const historyWithError: OperationHistory = {
      ...sampleHistory,
      entries: [
        ...sampleHistory.entries,
        {
          operation: { kind: "click", selector: "missing" },
          timestamp: "2026-03-22T10:00:04.000Z",
          url: "https://example.com",
          durationMs: 50,
          screenshot: new Uint8Array([7]),
          screenshotFormat: "png",
          error: "element not found",
        },
      ],
    };

    const report = historyToEvidence(historyWithError, {
      testCaseName: "test",
      testCaseUrl: "https://example.com",
    });

    expect(report.testCases[0].status).toBe("fail");
  });

  it("includes error in actual description", () => {
    const historyWithError: OperationHistory = {
      ...sampleHistory,
      entries: [
        {
          operation: { kind: "click", selector: "missing" },
          timestamp: "2026-03-22T10:00:04.000Z",
          url: "https://example.com",
          durationMs: 50,
          screenshot: new Uint8Array([7]),
          screenshotFormat: "png",
          error: "element not found",
        },
      ],
    };

    const report = historyToEvidence(historyWithError, {
      testCaseName: "test",
      testCaseUrl: "https://example.com",
    });

    expect(report.testCases[0].steps[0].actual).toContain("エラー");
    expect(report.testCases[0].steps[0].actual).toContain("element not found");
  });

  it("preserves screenshot data", () => {
    const report = historyToEvidence(sampleHistory, {
      testCaseName: "test",
      testCaseUrl: "https://example.com",
    });

    expect(report.testCases[0].steps[0].screenshot).toEqual(new Uint8Array([1, 2, 3]));
    expect(report.testCases[0].steps[0].screenshotFormat).toBe("png");
  });

  it("maps timestamps correctly", () => {
    const report = historyToEvidence(sampleHistory, {
      testCaseName: "test",
      testCaseUrl: "https://example.com",
    });

    expect(report.createdAt).toEqual(new Date("2026-03-22T10:00:00.000Z"));
    expect(report.testCases[0].startedAt).toEqual(new Date("2026-03-22T10:00:00.000Z"));
    expect(report.testCases[0].finishedAt).toEqual(new Date("2026-03-22T10:01:00.000Z"));
  });
});
