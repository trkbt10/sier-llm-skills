/** @file resolveInteractiveFromChain の単体テスト (フェイク CDP クライアント)。 */
import { resolveInteractiveFromChain } from "./cdp-recorder-resolver";
import type { ResolverCdpClient } from "./cdp-recorder-resolver";
import type { CandidateMeta } from "./cdp-recorder-injection";

/**
 * フェイク CDP クライアント。
 *
 * `chain` は外側から渡す候補メタ列。Runtime.evaluate の expression パターンに
 * 応じて適切な値を返す。getEventListeners は listenersByDepth で制御。
 */
function makeFakeClient(args: {
  readonly chainIdx: number;
  readonly metaByDepth: ReadonlyArray<CandidateMeta | null>;
  readonly listenersByDepth: ReadonlyArray<readonly string[]>;
}): { client: ResolverCdpClient; calls: { readonly disposed: boolean[] } } {
  const disposed = [false];
  const ctx = { currentDepth: -1 };

  const client: ResolverCdpClient = {
    Runtime: {
      async evaluate(params): Promise<{ result: { value?: unknown; objectId?: string } }> {
        const expr = params.expression;
        if (expr.startsWith("JSON.stringify(window.__cdpReadCandidateMeta(")) {
          const m = expr.match(/__cdpReadCandidateMeta\((\d+),\s*(\d+)\)/);
          if (m === null) {
            return { result: { value: "null" } };
          }
          const depth = Number(m[2]);
          const meta = args.metaByDepth[depth];
          ctx.currentDepth = depth;
          return { result: { value: meta === null ? "null" : JSON.stringify(meta) } };
        }
        if (expr.startsWith("window.__cdpExposeCandidate(")) {
          const m = expr.match(/__cdpExposeCandidate\((\d+),\s*(\d+)\)/);
          if (m === null) {
            return { result: { value: false } };
          }
          const depth = Number(m[2]);
          ctx.currentDepth = depth;
          return { result: { value: args.metaByDepth[depth] !== null } };
        }
        if (expr === "window.__cdpProbeEl") {
          return { result: { objectId: `obj-${ctx.currentDepth}` } };
        }
        if (expr.startsWith("window.__cdpDisposeCandidate(")) {
          disposed[0] = true;
          return { result: {} };
        }
        return { result: {} };
      },
      async releaseObjectGroup(): Promise<void> {
        // noop
      },
    },
    DOMDebugger: {
      async getEventListeners(params): Promise<{ listeners: { type: string }[] }> {
        const m = params.objectId.match(/obj-(\d+)/);
        if (m === null) {
          return { listeners: [] };
        }
        const depth = Number(m[1]);
        const types = args.listenersByDepth[depth] ?? [];
        return { listeners: types.map((type) => ({ type })) };
      },
    },
  };

  return { client, calls: { disposed } };
}

const rect = { x: 0, y: 0, width: 10, height: 10 };
const semantics = { humanLabel: "test", role: "button" };

function meta(tag: string, opts: Partial<CandidateMeta> = {}): CandidateMeta {
  // rect は null を意味のある値として渡せるよう、`??` ではなく
  // プロパティの有無で分岐する。
  return {
    tag,
    selector: opts.selector ?? tag,
    semantics: opts.semantics ?? semantics,
    rect: Object.prototype.hasOwnProperty.call(opts, "rect") ? (opts.rect ?? null) : rect,
    hasOnProp: opts.hasOnProp ?? false,
  };
}

describe("resolveInteractiveFromChain", () => {
  it("accepts native <button> at depth 0", async () => {
    const { client, calls } = makeFakeClient({
      chainIdx: 0,
      metaByDepth: [meta("button")],
      listenersByDepth: [[]],
    });
    const result = await resolveInteractiveFromChain(client, 0);
    expect(result).not.toBeNull();
    expect(result?.selector).toBe("button");
    expect(calls.disposed[0]).toBe(true);
  });

  it("accepts native <a> at depth 0", async () => {
    const { client } = makeFakeClient({
      chainIdx: 0,
      metaByDepth: [meta("a")],
      listenersByDepth: [[]],
    });
    expect(await resolveInteractiveFromChain(client, 0)).not.toBeNull();
  });

  it("walks up the chain when inner element is <span> and outer is <button>", async () => {
    const { client } = makeFakeClient({
      chainIdx: 0,
      metaByDepth: [meta("span"), meta("button")],
      listenersByDepth: [[], []],
    });
    const result = await resolveInteractiveFromChain(client, 0);
    expect(result?.selector).toBe("button");
  });

  it("accepts a div with onclick property (hasOnProp=true)", async () => {
    const { client } = makeFakeClient({
      chainIdx: 0,
      metaByDepth: [meta("div", { hasOnProp: true })],
      listenersByDepth: [[]],
    });
    expect(await resolveInteractiveFromChain(client, 0)).not.toBeNull();
  });

  it("accepts a div with addEventListener('click') via DOMDebugger", async () => {
    const { client } = makeFakeClient({
      chainIdx: 0,
      metaByDepth: [meta("div")],
      listenersByDepth: [["click"]],
    });
    expect(await resolveInteractiveFromChain(client, 0)).not.toBeNull();
  });

  it("rejects a pure div with no listeners and no on* props", async () => {
    const { client } = makeFakeClient({
      chainIdx: 0,
      metaByDepth: [meta("div"), meta("section"), meta("main")],
      listenersByDepth: [[], [], []],
    });
    expect(await resolveInteractiveFromChain(client, 0)).toBeNull();
  });

  it("disposes the chain even when no interactive element is found", async () => {
    const { client, calls } = makeFakeClient({
      chainIdx: 0,
      metaByDepth: [meta("div")],
      listenersByDepth: [[]],
    });
    await resolveInteractiveFromChain(client, 0);
    expect(calls.disposed[0]).toBe(true);
  });

  it("stops at first match and ignores deeper interactive ancestors", async () => {
    const { client } = makeFakeClient({
      chainIdx: 0,
      // 内側に既に button、外側にも button があるケース
      metaByDepth: [meta("button", { selector: "inner" }), meta("button", { selector: "outer" })],
      listenersByDepth: [[], []],
    });
    const result = await resolveInteractiveFromChain(client, 0);
    expect(result?.selector).toBe("inner");
  });

  it("rejects when rect is null (DOM 要素消失等)", async () => {
    const { client } = makeFakeClient({
      chainIdx: 0,
      metaByDepth: [meta("button", { rect: null })],
      listenersByDepth: [[]],
    });
    expect(await resolveInteractiveFromChain(client, 0)).toBeNull();
  });

  it("treats mousedown listener as interactive", async () => {
    const { client } = makeFakeClient({
      chainIdx: 0,
      metaByDepth: [meta("div")],
      listenersByDepth: [["mousedown"]],
    });
    expect(await resolveInteractiveFromChain(client, 0)).not.toBeNull();
  });

  it("treats pointerdown listener as interactive", async () => {
    const { client } = makeFakeClient({
      chainIdx: 0,
      metaByDepth: [meta("div")],
      listenersByDepth: [["pointerdown"]],
    });
    expect(await resolveInteractiveFromChain(client, 0)).not.toBeNull();
  });

  it("ignores unrelated listener types like mouseover", async () => {
    const { client } = makeFakeClient({
      chainIdx: 0,
      metaByDepth: [meta("div"), null],
      listenersByDepth: [["mouseover", "focusin"]],
    });
    expect(await resolveInteractiveFromChain(client, 0)).toBeNull();
  });
});
