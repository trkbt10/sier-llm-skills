/**
 * @file クリック候補チェーンを CDP 経由で interactive 要素まで解決する純レイヤ。
 *
 * cdp-recorder.ts から独立させ、CDP クライアントを差し替え可能にして
 * 単体テストできるようにする。
 */

import type { ElementSemantics, TargetRect } from "../operation-record/operation-types";
import type { CandidateMeta } from "./cdp-recorder-injection";

/**
 * CDP クライアントの最小インターフェース。
 * chrome-remote-interface のメソッド群のうち、resolver が必要とするものだけを抽出。
 */
export type ResolverCdpClient = {
  readonly Runtime: {
    evaluate(params: {
      expression: string;
      returnByValue?: boolean;
      objectGroup?: string;
    }): Promise<{ result: { value?: unknown; objectId?: string } }>;
    releaseObjectGroup(params: { objectGroup: string }): Promise<void>;
  };
  readonly DOMDebugger: {
    getEventListeners(params: { objectId: string }): Promise<{ listeners: { type: string }[] }>;
  };
};

/** Resolver が返す interactive 要素情報。 */
export type ResolvedClick = {
  readonly selector: string;
  readonly semantics: ElementSemantics;
  readonly rect: TargetRect;
};

/**
 * 候補チェーンの depth 番目に対して DOM 側 API を呼び、リスナー有無を含む
 * メタ情報を取得して interactive 判定に答える純関数。
 *
 * `null` 返却 = チェーン上に interactive 要素なし → click を捨てる。
 */
export async function resolveInteractiveFromChain(
  client: ResolverCdpClient,
  chainIdx: number,
  options?: { readonly maxDepth?: number },
): Promise<ResolvedClick | null> {
  const maxDepth = options?.maxDepth ?? 10;
  try {
    for (const depth of Array.from({ length: maxDepth }, (_, i) => i)) {
      const meta = await readCandidateMeta(client, chainIdx, depth);
      if (meta === null) {
        return null;
      }
      const nativeInteractive = ["button", "a", "input", "select", "textarea"].includes(meta.tag);
      const hasOn = meta.hasOnProp;
      const hasListener = nativeInteractive || hasOn || (await hasClickListenerAt(client, chainIdx, depth));
      if (!hasListener) {
        continue;
      }
      if (meta.rect === null) {
        return null;
      }
      return {
        selector: meta.selector,
        semantics: meta.semantics,
        rect: meta.rect,
      };
    }
    return null;
  } finally {
    await disposeCandidate(client, chainIdx);
  }
}

/** 指定 chain の depth 番目の候補メタを DOM 側から取得する。 */
export async function readCandidateMeta(
  client: ResolverCdpClient,
  chainIdx: number,
  depth: number,
): Promise<CandidateMeta | null> {
  try {
    const { result } = await client.Runtime.evaluate({
      expression: `JSON.stringify(window.__cdpReadCandidateMeta(${chainIdx}, ${depth}))`,
      returnByValue: true,
    });
    if (typeof result.value !== "string" || result.value === "null") {
      return null;
    }
    return JSON.parse(result.value) as CandidateMeta;
  } catch {
    return null;
  }
}

async function hasClickListenerAt(
  client: ResolverCdpClient,
  chainIdx: number,
  depth: number,
): Promise<boolean> {
  try {
    const exposed = await client.Runtime.evaluate({
      expression: `window.__cdpExposeCandidate(${chainIdx}, ${depth}) && true`,
      returnByValue: true,
    });
    if (exposed.result.value !== true) {
      return false;
    }
    const ref = await client.Runtime.evaluate({
      expression: `window.__cdpProbeEl`,
      objectGroup: "cdp-recorder-probe",
    });
    const objectId = ref.result.objectId;
    if (objectId === undefined) {
      return false;
    }
    const { listeners } = await client.DOMDebugger.getEventListeners({ objectId });
    await client.Runtime.releaseObjectGroup({ objectGroup: "cdp-recorder-probe" });
    return listeners.some((l) => l.type === "click" || l.type === "mousedown" || l.type === "pointerdown");
  } catch {
    return false;
  }
}

/** 指定 chain を DOM 側で破棄する (メモリリーク防止)。 */
export async function disposeCandidate(client: ResolverCdpClient, chainIdx: number): Promise<void> {
  try {
    await client.Runtime.evaluate({
      expression: `window.__cdpDisposeCandidate(${chainIdx})`,
      returnByValue: true,
    });
  } catch {
    // 後始末失敗は無視
  }
}
