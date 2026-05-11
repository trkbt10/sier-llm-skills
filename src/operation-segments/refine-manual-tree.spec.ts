/** @file refineManualTree の単体テスト。 */
import { refineManualTree } from "./refine-manual-tree";
import type { ManualTree } from "./manual-tree-types";

const baseTree: ManualTree = {
  version: 1,
  title: "原題",
  startedAt: "2026-03-22T10:00:00.000Z",
  viewport: { width: 1280, height: 800 },
  pages: [
    {
      url: "https://a.example.com",
      startedAt: "2026-03-22T10:00:01.000Z",
      endedAt: "2026-03-22T10:00:10.000Z",
      groups: [
        {
          entries: [
            {
              operation: { kind: "click", selector: "#login" },
              timestamp: "2026-03-22T10:00:01.000Z",
              url: "https://a.example.com",
              durationMs: 1,
              screenshot: new Uint8Array([1]),
              screenshotFormat: "png",
            },
          ],
        },
      ],
    },
  ],
};

describe("refineManualTree", () => {
  it("overrides title at the root", () => {
    const refined = refineManualTree(baseTree, { title: "新題" });
    expect(refined.title).toBe("新題");
  });

  it("applies pageTitle on the target page", () => {
    const refined = refineManualTree(baseTree, {
      pages: [{ pageIndex: 0, pageTitle: "ログイン画面" }],
    });
    expect(refined.pages[0].pageTitle).toBe("ログイン画面");
  });

  it("applies heading and step (action/expected) on entries", () => {
    const refined = refineManualTree(baseTree, {
      pages: [
        {
          pageIndex: 0,
          groups: [
            {
              groupIndex: 0,
              heading: "認証手順",
              entries: [
                { entryIndex: 0, action: "ログインボタンを押下する", expected: "ダッシュボードに遷移すること" },
              ],
            },
          ],
        },
      ],
    });
    expect(refined.pages[0].groups[0].heading).toBe("認証手順");
    expect(refined.pages[0].groups[0].entries[0].step?.action).toBe("ログインボタンを押下する");
    expect(refined.pages[0].groups[0].entries[0].step?.expected).toBe("ダッシュボードに遷移すること");
  });

  it("ignores out-of-range page indices", () => {
    const refined = refineManualTree(baseTree, {
      pages: [{ pageIndex: 99, pageTitle: "nope" }],
    });
    expect(refined.pages[0].pageTitle).toBeUndefined();
  });

  it("does not mutate operation or screenshot", () => {
    const refined = refineManualTree(baseTree, {
      pages: [
        {
          pageIndex: 0,
          groups: [
            { groupIndex: 0, entries: [{ entryIndex: 0, action: "x", expected: "y" }] },
          ],
        },
      ],
    });
    const original = baseTree.pages[0].groups[0].entries[0];
    const refinedEntry = refined.pages[0].groups[0].entries[0];
    expect(refinedEntry.operation).toEqual(original.operation);
    expect(refinedEntry.screenshot).toEqual(original.screenshot);
  });
});
