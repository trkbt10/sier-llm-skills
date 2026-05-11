/** @file describeOperationDone の単体テスト。 */
import { describeOperationDone } from "./describe-operation";
import type { OperationEntry } from "./operation-types";

function entry(operation: OperationEntry["operation"], overrides: Partial<OperationEntry> = {}): OperationEntry {
  return {
    operation,
    timestamp: "2026-03-22T10:00:00.000Z",
    url: "https://example.com",
    durationMs: 1,
    ...overrides,
  };
}

describe("describeOperationDone", () => {
  it("uses humanLabel for click when semantics present", () => {
    const e = entry({
      kind: "click",
      selector: "button.foo",
      semantics: { humanLabel: "送信", role: "button" },
    });
    const text = describeOperationDone(e);
    expect(text).toContain("送信");
    expect(text).toContain("クリックしました");
  });

  it("falls back to selector when semantics absent", () => {
    const e = entry({ kind: "click", selector: "#submit" });
    expect(describeOperationDone(e)).toContain("#submit");
  });

  it("describes input with humanLabel and value", () => {
    const e = entry({
      kind: "input",
      selector: "input[name='q']",
      value: "search-query",
      commitTrigger: "enter",
      semantics: { humanLabel: "検索", role: "searchbox" },
    });
    const text = describeOperationDone(e);
    expect(text).toContain("検索");
    expect(text).toContain("search-query");
    expect(text).toContain("Enter で確定");
  });

  it("uses タップ for touch pointerType on click", () => {
    const e = entry({
      kind: "click",
      selector: "#x",
      semantics: { humanLabel: "送信", role: "button" },
      pointerType: "touch",
    });
    expect(describeOperationDone(e)).toContain("タップしました");
  });

  it("uses クリック for mouse pointerType on click", () => {
    const e = entry({
      kind: "click",
      selector: "#x",
      semantics: { humanLabel: "送信", role: "button" },
      pointerType: "mouse",
    });
    expect(describeOperationDone(e)).toContain("クリックしました");
  });

  it("describes drag-and-drop with humanLabels", () => {
    const e = entry({
      kind: "drag-and-drop",
      sourceSelector: "#card-1",
      targetSelector: "#column-done",
      sourceSemantics: { humanLabel: "タスクA", role: "card" },
      targetSemantics: { humanLabel: "完了レーン", role: "column" },
      pointerType: "mouse",
    });
    const text = describeOperationDone(e);
    expect(text).toContain("タスクA");
    expect(text).toContain("完了レーン");
    expect(text).toContain("ドラッグ");
  });

  it("emits error message when entry has error", () => {
    const e = entry(
      { kind: "click", selector: "x" },
      { error: "boom" },
    );
    expect(describeOperationDone(e)).toContain("エラー: boom");
  });
});
