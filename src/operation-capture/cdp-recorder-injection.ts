/**
 * @file ブラウザ側に注入される操作観測スクリプト。
 *
 * cdp-recorder が CDP Runtime.evaluate で注入する関数。
 * window 上に以下の API を生やす:
 *   - __cdpRecorderAttached  (再注入防止フラグ)
 *   - __cdpExposeCandidate(chainIdx, depth) → boolean
 *   - __cdpReadCandidateMeta(chainIdx, depth) → CandidateMeta | null
 *   - __cdpDisposeCandidate(chainIdx)
 *   - __cdpDrainPredicts() → Predict[]
 *   - __cdpDrainClicks() → RawClick[]
 *   - __cdpDrainInputs() → RawInput[]
 *   - __cdpDrainDrags() → RawDrag[]
 *   - __cdpFlushInputs(trigger) → RawInput[]
 *
 * このファイルは Chrome 上で実行されるため、import / module 構文は使わず、
 * グローバル参照のみで完結する。jsdom 上の単体テストでも同じスクリプトを
 * eval することで動作確認できるようにする。
 */

/** attach するときに globalThis に作る API の型。 */
export type CdpRecorderWindowApi = {
  __cdpRecorderAttached: boolean;
  __cdpProbeEl: Element | null;
  __cdpExposeCandidate: (chainIdx: number, depth: number) => boolean;
  __cdpReadCandidateMeta: (chainIdx: number, depth: number) => CandidateMeta | null;
  __cdpDisposeCandidate: (chainIdx: number) => void;
  __cdpDrainPredicts: () => Predict[];
  __cdpDrainClicks: () => RawClick[];
  __cdpDrainInputs: () => RawInput[];
  __cdpDrainDrags: () => RawDrag[];
  __cdpFlushInputs: (trigger: CommitTrigger) => RawInput[];
};

export type Predict = {
  seq: number;
  kind: "click" | "input" | "drag";
};

export type CandidateMeta = {
  tag: string;
  selector: string;
  semantics: { humanLabel: string; role: string };
  rect: { x: number; y: number; width: number; height: number } | null;
  hasOnProp: boolean;
};

export type PointerType = "mouse" | "touch" | "pen";

export type RawClick = {
  seq?: number;
  chainIdx: number;
  pointerType: PointerType | null;
};

export type CommitTrigger = "blur" | "enter" | "navigate-flush";

export type RawInput = {
  seq?: number;
  selector: string;
  value: string;
  commitTrigger: CommitTrigger;
  semantics: { humanLabel: string; role: string };
  rect: { x: number; y: number; width: number; height: number } | null;
  pointerType: PointerType | null;
};

export type RawDrag = {
  seq?: number;
  sourceChainIdx: number;
  targetChainIdx: number;
  pointerType: PointerType | null;
};

/**
 * 指定ドキュメントに操作観測リスナーを attach し、window に API を生やす。
 * 注入先 (Chrome 実機 / jsdom) のいずれでも同一の挙動になることを保証する。
 *
 * 再 attach はサイレントに無視 (window.__cdpRecorderAttached で保護)。
 */
export function attachCdpRecorder(targetDoc: Document, targetWin: Window & typeof globalThis): void {
  const w = targetWin as Window & typeof globalThis & Partial<CdpRecorderWindowApi>;
  if (w.__cdpRecorderAttached === true) {
    return;
  }
  w.__cdpRecorderAttached = true;

  const clicks: RawClick[] = [];
  const drags: RawDrag[] = [];
  const inputs: RawInput[] = [];
  const pendingInputElements = new Map<Element, true>();
  const predicts: Predict[] = [];
  const candidateChain: (Element[] | null)[] = [];

  const counter = { seq: 0 };
  function nextSeq(): number {
    counter.seq += 1;
    return counter.seq;
  }

  const pointerCtx: { lastType: PointerType | null } = { lastType: null };
  const pointerStarts = new Map<
    number,
    { x: number; y: number; target: Element; time: number; pointerType: PointerType }
  >();

  function selectorOf(el: Element | null): string {
    if (el === null) {
      return "unknown";
    }
    if (el.id !== "") {
      return "#" + el.id;
    }
    const tag = el.tagName.toLowerCase();
    const nameAttr = el.getAttribute === undefined ? null : el.getAttribute("name");
    if (nameAttr !== null && nameAttr !== "") {
      return tag + '[name="' + nameAttr + '"]';
    }
    if (el.classList !== undefined && el.classList.length > 0) {
      return tag + "." + el.classList[0];
    }
    return tag;
  }

  function trim(s: string | null | undefined): string {
    if (s === null || s === undefined) {
      return "";
    }
    return String(s).replace(/\s+/g, " ").trim();
  }

  function takeFirst(s: string, n: number): string {
    if (s.length <= n) {
      return s;
    }
    return s.slice(0, n) + "…";
  }

  function roleOf(tag: string, typeAttr: string | null, ariaRole: string | null): string {
    if (ariaRole !== null && ariaRole !== "") {
      return ariaRole;
    }
    if (tag === "a") {
      return "link";
    }
    if (tag === "button") {
      return "button";
    }
    if (tag === "select") {
      return "select";
    }
    if (tag === "textarea") {
      return "textbox";
    }
    if (tag === "input") {
      const t = (typeAttr ?? "text").toLowerCase();
      if (t === "submit") {
        return "submit-button";
      }
      if (t === "button") {
        return "button";
      }
      if (t === "checkbox") {
        return "checkbox";
      }
      if (t === "radio") {
        return "radio";
      }
      if (t === "password") {
        return "password-input";
      }
      if (t === "search") {
        return "searchbox";
      }
      if (t === "email") {
        return "email-input";
      }
      return "textbox";
    }
    return tag !== "" ? tag : "unknown";
  }

  function semanticsOf(el: Element | null): { humanLabel: string; role: string } {
    if (el === null) {
      return { humanLabel: "不明な要素", role: "unknown" };
    }
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute === undefined ? null : el.getAttribute("role");
    const typeAttr = el.getAttribute === undefined ? null : el.getAttribute("type");

    const aria = el.getAttribute === undefined ? null : el.getAttribute("aria-label");
    if (trim(aria) !== "") {
      return { humanLabel: trim(aria), role: roleOf(tag, typeAttr, role) };
    }

    if (el.id !== "" && targetDoc.querySelector !== undefined) {
      const lbl = targetDoc.querySelector('label[for="' + el.id + '"]');
      if (lbl !== null && trim((lbl as HTMLElement).innerText) !== "") {
        return { humanLabel: trim((lbl as HTMLElement).innerText), role: roleOf(tag, typeAttr, role) };
      }
    }

    const parentLabel = el.closest === undefined ? null : el.closest("label");
    if (parentLabel !== null && trim((parentLabel as HTMLElement).innerText) !== "") {
      return {
        humanLabel: trim((parentLabel as HTMLElement).innerText),
        role: roleOf(tag, typeAttr, role),
      };
    }

    if (tag === "button" || tag === "a") {
      const t = trim((el as HTMLElement).innerText ?? el.textContent);
      if (t !== "") {
        return { humanLabel: takeFirst(t, 40), role: roleOf(tag, typeAttr, role) };
      }
    }

    const ph = el.getAttribute === undefined ? null : el.getAttribute("placeholder");
    if (trim(ph) !== "") {
      return { humanLabel: trim(ph), role: roleOf(tag, typeAttr, role) };
    }

    const title = el.getAttribute === undefined ? null : el.getAttribute("title");
    if (trim(title) !== "") {
      return { humanLabel: trim(title), role: roleOf(tag, typeAttr, role) };
    }

    const name = el.getAttribute === undefined ? null : el.getAttribute("name");
    if (trim(name) !== "") {
      return { humanLabel: trim(name), role: roleOf(tag, typeAttr, role) };
    }

    const inner = trim((el as HTMLElement).innerText ?? el.textContent ?? "");
    if (inner !== "" && inner.length < 30) {
      return { humanLabel: takeFirst(inner, 40), role: roleOf(tag, typeAttr, role) };
    }

    const r = roleOf(tag, typeAttr, role);
    return { humanLabel: r, role: r };
  }

  function rectOf(el: Element | null): CandidateMeta["rect"] {
    if (el === null || el.getBoundingClientRect === undefined) {
      return null;
    }
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }

  function valueOf(el: Element): string {
    const tag = el.tagName;
    if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") {
      const v = (el as HTMLInputElement).value;
      return v === undefined ? "" : v;
    }
    if ((el as HTMLElement).isContentEditable === true) {
      const t = (el as HTMLElement).innerText;
      return t === undefined ? "" : t;
    }
    return "";
  }

  function isFormField(el: Element | null): boolean {
    if (el === null) {
      return false;
    }
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      return true;
    }
    if ((el as HTMLElement).isContentEditable === true) {
      return true;
    }
    return false;
  }

  function appendCandidatePath(cur: Element | null, path: Element[], depth: number): void {
    if (cur === null) {
      return;
    }
    if (cur === targetDoc.body) {
      return;
    }
    if (depth >= 10) {
      return;
    }
    path.push(cur);
    appendCandidatePath(cur.parentElement, path, depth + 1);
  }

  function buildCandidatePath(el: Element): Element[] {
    const path: Element[] = [];
    appendCandidatePath(el, path, 0);
    return path;
  }

  function pushCandidate(el: Element): number {
    candidateChain.push(buildCandidatePath(el));
    // 古い entry を null 化して Element 参照を解放する。
    // 配列スロット自体は捨てない (idx は Node 側に渡している ID なので)。
    // 1000 件超で、500 件より古いものを null 化。
    if (candidateChain.length > 1000) {
      const target = candidateChain.length - 500;
      for (const i of Array.from({ length: target }, (_, k) => k)) {
        candidateChain[i] = null;
      }
    }
    return candidateChain.length - 1;
  }

  function commit(el: Element, trigger: CommitTrigger): void {
    if (!isFormField(el)) {
      return;
    }
    // pending に居ない (= 既に commit 済み or 入力がなかった) なら何もしない。
    // Enter で commit した直後の focusout 等で二重発火するのを防ぐ。
    if (!pendingInputElements.has(el)) {
      return;
    }
    const seq = nextSeq();
    predicts.push({ seq, kind: "input" });
    inputs.push({
      seq,
      selector: selectorOf(el),
      value: valueOf(el),
      commitTrigger: trigger,
      semantics: semanticsOf(el),
      rect: rectOf(el),
      pointerType: pointerCtx.lastType,
    });
    pendingInputElements.delete(el);
  }

  // ---- listeners ----

  targetDoc.addEventListener(
    "pointerdown",
    (rawEvt) => {
      const e = rawEvt as PointerEvent;
      const t = (e.pointerType === "" ? "mouse" : e.pointerType) as PointerType;
      pointerCtx.lastType = t;
      pointerStarts.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        target: e.target as Element,
        time: Date.now(),
        pointerType: t,
      });
    },
    true,
  );

  targetDoc.addEventListener(
    "mousedown",
    (rawEvt) => {
      const e = rawEvt as MouseEvent;
      const seq = nextSeq();
      predicts.push({ seq, kind: "click" });
      (e.target as Element & { __cdpClickSeq?: number }).__cdpClickSeq = seq;
    },
    true,
  );

  targetDoc.addEventListener(
    "click",
    (rawEvt) => {
      const e = rawEvt as MouseEvent;
      const raw = e.target as Element & { __cdpClickSeq?: number };
      const seq = raw.__cdpClickSeq;
      delete raw.__cdpClickSeq;
      const chainIdx = pushCandidate(raw);
      const click: RawClick = {
        chainIdx,
        pointerType: pointerCtx.lastType,
      };
      if (seq !== undefined) {
        clicks.push({ ...click, seq });
      } else {
        clicks.push(click);
      }
    },
    true,
  );

  // ---- HTML5 Drag & Drop ----
  const dragCtx: { source: Element | null } = { source: null };
  targetDoc.addEventListener(
    "dragstart",
    (rawEvt) => {
      const e = rawEvt as DragEvent;
      dragCtx.source = e.target as Element;
    },
    true,
  );
  targetDoc.addEventListener(
    "drop",
    (rawEvt) => {
      const e = rawEvt as DragEvent;
      if (dragCtx.source === null) {
        return;
      }
      const seq = nextSeq();
      predicts.push({ seq, kind: "drag" });
      drags.push({
        seq,
        sourceChainIdx: pushCandidate(dragCtx.source),
        targetChainIdx: pushCandidate(e.target as Element),
        pointerType: "mouse",
      });
      dragCtx.source = null;
    },
    true,
  );
  targetDoc.addEventListener(
    "dragend",
    () => {
      dragCtx.source = null;
    },
    true,
  );

  // ---- タッチドラッグ判定 (pointerup) ----
  const DRAG_THRESHOLD_PX = 10;
  targetDoc.addEventListener(
    "pointerup",
    (rawEvt) => {
      const e = rawEvt as PointerEvent;
      const start = pointerStarts.get(e.pointerId);
      pointerStarts.delete(e.pointerId);
      if (start === undefined) {
        return;
      }
      if (start.pointerType === "mouse") {
        return;
      }
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < DRAG_THRESHOLD_PX) {
        return;
      }
      const targetEl = targetDoc.elementFromPoint(e.clientX, e.clientY);
      if (targetEl === null) {
        return;
      }
      const seq = nextSeq();
      predicts.push({ seq, kind: "drag" });
      drags.push({
        seq,
        sourceChainIdx: pushCandidate(start.target),
        targetChainIdx: pushCandidate(targetEl),
        pointerType: start.pointerType,
      });
    },
    true,
  );

  // ---- input ----
  targetDoc.addEventListener(
    "input",
    (rawEvt) => {
      const e = rawEvt as InputEvent;
      const el = e.target as Element | null;
      if (!isFormField(el)) {
        return;
      }
      pendingInputElements.set(el as Element, true);
    },
    true,
  );
  targetDoc.addEventListener(
    "focusout",
    (rawEvt) => {
      const e = rawEvt as FocusEvent;
      commit(e.target as Element, "blur");
    },
    true,
  );
  targetDoc.addEventListener(
    "change",
    (rawEvt) => {
      const e = rawEvt as Event;
      const el = e.target as Element | null;
      if (el !== null && el.tagName === "SELECT") {
        // SELECT は input イベントを発火しないブラウザ実装があるため、
        // change 時点で pending に積んで commit を進める。
        pendingInputElements.set(el, true);
        commit(el, "blur");
      }
    },
    true,
  );
  targetDoc.addEventListener(
    "keydown",
    (rawEvt) => {
      const e = rawEvt as KeyboardEvent;
      if (e.key !== "Enter") {
        return;
      }
      const el = e.target as Element | null;
      if (isFormField(el)) {
        commit(el as Element, "enter");
      }
    },
    true,
  );

  // ---- API ----
  w.__cdpProbeEl = null;
  w.__cdpExposeCandidate = function (chainIdx, depth) {
    const path = candidateChain[chainIdx];
    if (path === undefined || path === null) {
      return false;
    }
    const el = path[depth];
    if (el === undefined) {
      return false;
    }
    w.__cdpProbeEl = el;
    return true;
  };
  function hasOnPropOf(el: Element): boolean {
    const elTyped = el as Element & {
      onclick?: unknown;
      onmousedown?: unknown;
      onpointerdown?: unknown;
    };
    if (elTyped.onclick !== null && elTyped.onclick !== undefined) {
      return true;
    }
    if (elTyped.onmousedown !== null && elTyped.onmousedown !== undefined) {
      return true;
    }
    if (elTyped.onpointerdown !== null && elTyped.onpointerdown !== undefined) {
      return true;
    }
    return false;
  }

  w.__cdpReadCandidateMeta = function (chainIdx, depth) {
    const path = candidateChain[chainIdx];
    if (path === undefined || path === null) {
      return null;
    }
    const el = path[depth];
    if (el === undefined) {
      return null;
    }
    return {
      tag: el.tagName.toLowerCase(),
      selector: selectorOf(el),
      semantics: semanticsOf(el),
      rect: rectOf(el),
      hasOnProp: hasOnPropOf(el),
    };
  };
  w.__cdpDisposeCandidate = function (chainIdx) {
    candidateChain[chainIdx] = null;
  };
  w.__cdpDrainPredicts = function () {
    const out = predicts.slice();
    predicts.length = 0;
    return out;
  };
  w.__cdpDrainClicks = function () {
    const out = clicks.slice();
    clicks.length = 0;
    return out;
  };
  w.__cdpDrainInputs = function () {
    const out = inputs.slice();
    inputs.length = 0;
    return out;
  };
  w.__cdpDrainDrags = function () {
    const out = drags.slice();
    drags.length = 0;
    return out;
  };
  w.__cdpFlushInputs = function (trigger) {
    const pendingEls = Array.from(pendingInputElements.keys());
    for (const el of pendingEls) {
      commit(el, trigger);
    }
    const out = inputs.slice();
    inputs.length = 0;
    return out;
  };
}

/**
 * Chrome に注入する用の IIFE 文字列を返す。
 *
 * attachCdpRecorder の関数本体を String() で stringify し、
 * 末尾で (document, window) を引数に呼び出す。
 */
export function buildInjectionScript(): string {
  return `(${attachCdpRecorder.toString()})(document, window);`;
}
