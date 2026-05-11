// @vitest-environment happy-dom
/** @file 注入スクリプト (attachCdpRecorder) の DOM 動作テスト。 */
import { Window as HappyWindow } from "happy-dom";
import { attachCdpRecorder } from "./cdp-recorder-injection";
import type { CdpRecorderWindowApi } from "./cdp-recorder-injection";

type W = Window & typeof globalThis & Partial<CdpRecorderWindowApi>;

/**
 * happy-dom の Window を lib.dom.d.ts の Window として扱う型ガード。
 * eslint custom/no-as-outside-guard を回避するため、
 * type-predicate 関数内で `as unknown as T` を許容させる。
 */
function asDomWindow(v: HappyWindow): v is HappyWindow & W {
  // ランタイムでは型情報がないため、document があるかだけ最低限確認する。
  return v.document !== undefined;
}

/** 各テストで完全に新しい happy-dom Window を作って attach する。 */
function setup(): { doc: Document; win: W } {
  const happy = new HappyWindow();
  if (!asDomWindow(happy)) {
    throw new Error("unreachable");
  }
  attachCdpRecorder(happy.document, happy);
  return { doc: happy.document, win: happy };
}

describe("attachCdpRecorder - click capture", () => {
  it("captures a click on a button and queues it with chainIdx", () => {
    const { doc, win } = setup();
    const btn = doc.createElement("button");
    btn.textContent = "保存";
    doc.body.appendChild(btn);

    btn.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true }));
    btn.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

    const clicks = win.__cdpDrainClicks!();
    expect(clicks).toHaveLength(1);
    expect(clicks[0].chainIdx).toBeGreaterThanOrEqual(0);
  });

  it("links mousedown predict seq to the click via __cdpClickSeq", () => {
    const { doc, win } = setup();
    const btn = doc.createElement("button");
    btn.textContent = "ok";
    doc.body.appendChild(btn);

    btn.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true }));
    btn.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

    const predicts = win.__cdpDrainPredicts!();
    const clicks = win.__cdpDrainClicks!();
    expect(predicts).toHaveLength(1);
    expect(predicts[0].kind).toBe("click");
    expect(clicks[0].seq).toBe(predicts[0].seq);
  });

  it("does not link a seq when click happens without mousedown", () => {
    const { doc, win } = setup();
    const btn = doc.createElement("button");
    doc.body.appendChild(btn);

    btn.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

    const clicks = win.__cdpDrainClicks!();
    expect(clicks).toHaveLength(1);
    expect(clicks[0].seq).toBeUndefined();
  });
});

describe("attachCdpRecorder - candidate chain", () => {
  it("builds an ancestor chain that the Node side can walk", () => {
    const { doc, win } = setup();
    const outer = doc.createElement("button");
    const inner = doc.createElement("span");
    inner.textContent = "押下";
    outer.appendChild(inner);
    doc.body.appendChild(outer);

    inner.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true }));
    inner.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

    const clicks = win.__cdpDrainClicks!();
    const chainIdx = clicks[0].chainIdx;

    // depth 0 は span, depth 1 は button のはず
    const span = win.__cdpReadCandidateMeta!(chainIdx, 0);
    const button = win.__cdpReadCandidateMeta!(chainIdx, 1);
    expect(span?.tag).toBe("span");
    expect(button?.tag).toBe("button");
    expect(button?.semantics.humanLabel).toBe("押下");
  });

  it("__cdpExposeCandidate sets __cdpProbeEl for Node-side CDP probing", () => {
    const { doc, win } = setup();
    const btn = doc.createElement("button");
    btn.textContent = "x";
    doc.body.appendChild(btn);

    btn.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true }));
    btn.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

    const chainIdx = win.__cdpDrainClicks!()[0].chainIdx;
    const exposed = win.__cdpExposeCandidate!(chainIdx, 0);
    expect(exposed).toBe(true);
    expect(win.__cdpProbeEl).toBe(btn);
  });

  it("__cdpDisposeCandidate releases the chain entry", () => {
    const { doc, win } = setup();
    const btn = doc.createElement("button");
    doc.body.appendChild(btn);
    btn.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true }));
    btn.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

    const chainIdx = win.__cdpDrainClicks!()[0].chainIdx;
    win.__cdpDisposeCandidate!(chainIdx);
    expect(win.__cdpReadCandidateMeta!(chainIdx, 0)).toBeNull();
  });

  it("captures hasOnProp when element has onclick property", () => {
    const { doc, win } = setup();
    const div = doc.createElement("div");
    div.onclick = (): void => {
      /* noop */
    };
    doc.body.appendChild(div);

    div.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true }));
    div.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

    const chainIdx = win.__cdpDrainClicks!()[0].chainIdx;
    const meta = win.__cdpReadCandidateMeta!(chainIdx, 0);
    expect(meta?.hasOnProp).toBe(true);
  });
});

describe("attachCdpRecorder - input commit", () => {
  it("commits input value on blur with humanLabel from placeholder", () => {
    const { doc, win } = setup();
    const input = doc.createElement("input");
    input.setAttribute("placeholder", "ユーザー名");
    doc.body.appendChild(input);
    input.value = "alice";

    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    input.dispatchEvent(new win.FocusEvent("focusout", { bubbles: true }));

    const inputs = win.__cdpDrainInputs!();
    expect(inputs).toHaveLength(1);
    expect(inputs[0].value).toBe("alice");
    expect(inputs[0].commitTrigger).toBe("blur");
    expect(inputs[0].semantics.humanLabel).toBe("ユーザー名");
  });

  it("commits input value on Enter keydown", () => {
    const { doc, win } = setup();
    const input = doc.createElement("input");
    input.setAttribute("aria-label", "検索欄");
    doc.body.appendChild(input);
    input.value = "search-query";

    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    input.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    const inputs = win.__cdpDrainInputs!();
    expect(inputs).toHaveLength(1);
    expect(inputs[0].value).toBe("search-query");
    expect(inputs[0].commitTrigger).toBe("enter");
    expect(inputs[0].semantics.humanLabel).toBe("検索欄");
  });

  it("flushes pending inputs on navigate-flush", () => {
    const { doc, win } = setup();
    const input = doc.createElement("input");
    input.setAttribute("placeholder", "備考");
    doc.body.appendChild(input);
    input.value = "draft";

    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    // blur や Enter なし → pending のまま

    const flushed = win.__cdpFlushInputs!("navigate-flush");
    expect(flushed).toHaveLength(1);
    expect(flushed[0].commitTrigger).toBe("navigate-flush");
    expect(flushed[0].value).toBe("draft");
  });

  it("commits select value on change", () => {
    const { doc, win } = setup();
    const select = doc.createElement("select");
    select.setAttribute("aria-label", "国");
    const o1 = doc.createElement("option");
    o1.value = "JP";
    o1.textContent = "日本";
    const o2 = doc.createElement("option");
    o2.value = "US";
    o2.textContent = "USA";
    select.appendChild(o1);
    select.appendChild(o2);
    doc.body.appendChild(select);
    select.value = "US";

    select.dispatchEvent(new win.Event("change", { bubbles: true }));

    const inputs = win.__cdpDrainInputs!();
    expect(inputs).toHaveLength(1);
    expect(inputs[0].value).toBe("US");
    expect(inputs[0].semantics.humanLabel).toBe("国");
  });

  it("does not double-commit when blur fires after Enter", () => {
    const { doc, win } = setup();
    const input = doc.createElement("input");
    doc.body.appendChild(input);
    input.value = "x";

    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    input.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.dispatchEvent(new win.FocusEvent("focusout", { bubbles: true }));

    const inputs = win.__cdpDrainInputs!();
    expect(inputs).toHaveLength(1);
  });
});

describe("attachCdpRecorder - drag & drop", () => {
  it("captures HTML5 dragstart -> drop", () => {
    const { doc, win } = setup();
    const src = doc.createElement("div");
    src.setAttribute("draggable", "true");
    src.id = "src";
    const tgt = doc.createElement("div");
    tgt.id = "tgt";
    doc.body.appendChild(src);
    doc.body.appendChild(tgt);

    src.dispatchEvent(new win.Event("dragstart", { bubbles: true }));
    tgt.dispatchEvent(new win.Event("drop", { bubbles: true }));

    const drags = win.__cdpDrainDrags!();
    expect(drags).toHaveLength(1);
    expect(drags[0].pointerType).toBe("mouse");
  });

  it("dragend without drop clears the source", () => {
    const { doc, win } = setup();
    const src = doc.createElement("div");
    doc.body.appendChild(src);
    src.dispatchEvent(new win.Event("dragstart", { bubbles: true }));
    src.dispatchEvent(new win.Event("dragend", { bubbles: true }));

    expect(win.__cdpDrainDrags!()).toHaveLength(0);
  });
});

describe("attachCdpRecorder - re-attach guard", () => {
  it("ignores re-attach (idempotent)", () => {
    const { doc, win } = setup();
    // 既に attach 済みの状態でもう一度呼ぶ
    attachCdpRecorder(doc, win);

    const btn = doc.createElement("button");
    doc.body.appendChild(btn);
    btn.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true }));
    btn.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

    const clicks = win.__cdpDrainClicks!();
    expect(clicks).toHaveLength(1);
  });
});
