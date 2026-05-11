/** @file treeToEvidence の単体テスト。 */
import { isSectionStep, treeToEvidence } from "./tree-to-evidence";
import type { ManualTree } from "../operation-segments/manual-tree-types";

const tree: ManualTree = {
  version: 1,
  title: "操作説明書",
  startedAt: "2026-03-22T10:00:00.000Z",
  finishedAt: "2026-03-22T10:01:00.000Z",
  viewport: { width: 1280, height: 800 },
  pages: [
    {
      url: "https://a.example.com",
      pageTitle: "ログイン画面",
      startedAt: "2026-03-22T10:00:01.000Z",
      endedAt: "2026-03-22T10:00:05.000Z",
      groups: [
        {
          entries: [
            {
              operation: { kind: "input", selector: "#user", value: "admin", commitTrigger: "blur" },
              timestamp: "2026-03-22T10:00:02.000Z",
              url: "https://a.example.com",
              durationMs: 1,
              screenshot: new Uint8Array([1]),
              screenshotFormat: "png",
            },
            {
              operation: { kind: "click", selector: "#login" },
              timestamp: "2026-03-22T10:00:03.000Z",
              url: "https://a.example.com",
              durationMs: 1,
              screenshot: new Uint8Array([2]),
              screenshotFormat: "png",
            },
          ],
        },
      ],
    },
    {
      url: "https://a.example.com/dashboard",
      pageTitle: "ダッシュボード",
      startedAt: "2026-03-22T10:00:06.000Z",
      endedAt: "2026-03-22T10:01:00.000Z",
      groups: [
        {
          heading: "メニュー操作",
          entries: [
            {
              operation: { kind: "click", selector: "#menu" },
              timestamp: "2026-03-22T10:00:07.000Z",
              url: "https://a.example.com/dashboard",
              durationMs: 1,
              screenshot: new Uint8Array([3]),
              screenshotFormat: "png",
            },
          ],
        },
      ],
    },
  ],
};

describe("treeToEvidence", () => {
  it("inserts a section step before each page", () => {
    const report = treeToEvidence(tree);
    const steps = report.testCases[0].steps;
    expect(isSectionStep(steps[0])).toBe(true);
    expect(steps[0].action).toBe("ログイン画面");
  });

  it("inserts a section step for groups with heading", () => {
    const report = treeToEvidence(tree);
    const steps = report.testCases[0].steps;
    const dashboardSection = steps.find((s) => s.action === "ダッシュボード");
    const menuSection = steps.find((s) => s.action === "メニュー操作");
    expect(dashboardSection).toBeDefined();
    expect(menuSection).toBeDefined();
    expect(isSectionStep(menuSection!)).toBe(true);
  });

  it("numbers operation steps continuously across pages, ignoring sections", () => {
    const report = treeToEvidence(tree);
    const operationSteps = report.testCases[0].steps.filter((s) => !isSectionStep(s));
    expect(operationSteps).toHaveLength(3);
    expect(operationSteps[0].stepNumber).toBe(1);
    expect(operationSteps[1].stepNumber).toBe(2);
    expect(operationSteps[2].stepNumber).toBe(3);
  });

  it("uses the first page url as testCase.url by default", () => {
    const report = treeToEvidence(tree);
    expect(report.testCases[0].url).toBe("https://a.example.com");
  });

  it("emits input action with the confirmed value", () => {
    const report = treeToEvidence(tree);
    const inputStep = report.testCases[0].steps.find(
      (s) => !isSectionStep(s) && s.action.includes("admin"),
    );
    expect(inputStep).toBeDefined();
  });
});
