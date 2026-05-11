/** @file ManualTree シリアライズのラウンドトリップテスト。 */
import { serializeManualTree, deserializeManualTree } from "./manual-tree-io";
import type { ManualTree } from "./manual-tree-types";

describe("manual-tree-io", () => {
  it("round-trips a tree with screenshots", () => {
    const tree: ManualTree = {
      version: 1,
      title: "round-trip",
      startedAt: "2026-03-22T10:00:00.000Z",
      finishedAt: "2026-03-22T10:01:00.000Z",
      viewport: { width: 1280, height: 800 },
      pages: [
        {
          url: "https://a.example.com",
          pageTitle: "ページA",
          startedAt: "2026-03-22T10:00:01.000Z",
          endedAt: "2026-03-22T10:00:10.000Z",
          groups: [
            {
              heading: "区間1",
              entries: [
                {
                  operation: { kind: "input", selector: "#q", value: "hello", commitTrigger: "blur" },
                  timestamp: "2026-03-22T10:00:02.000Z",
                  url: "https://a.example.com",
                  durationMs: 5,
                  screenshot: new Uint8Array([0xff, 0x00, 0x10]),
                  screenshotFormat: "png",
                },
              ],
            },
          ],
        },
      ],
    };

    const json = serializeManualTree(tree);
    const restored = deserializeManualTree(json);

    expect(restored.title).toBe("round-trip");
    expect(restored.pages[0].pageTitle).toBe("ページA");
    expect(restored.pages[0].groups[0].heading).toBe("区間1");
    expect(restored.pages[0].groups[0].entries[0].screenshot).toEqual(new Uint8Array([0xff, 0x00, 0x10]));
    expect(restored.pages[0].groups[0].entries[0].operation).toEqual({
      kind: "input",
      selector: "#q",
      value: "hello",
      commitTrigger: "blur",
    });
  });

  it("throws on invalid version", () => {
    expect(() => deserializeManualTree(JSON.stringify({ version: 2 }))).toThrow();
  });

  it("throws on non-object input", () => {
    expect(() => deserializeManualTree("null")).toThrow();
  });
});
