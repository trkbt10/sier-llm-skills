/**
 * @file CDPイベント傍受による手動操作レコーダー。
 *
 * Chrome DevTools Protocol のイベントを監視し、
 * ユーザーの手動ブラウザ操作を OperationHistory として記録する。
 * Chrome を --remote-debugging-port で起動して使用する。
 */

import type {
  ElementSemantics,
  OperationEntry,
  OperationHistory,
  PointerType,
  TargetRect,
} from "../operation-record/operation-types";
import { buildInjectionScript } from "./cdp-recorder-injection";
import {
  resolveInteractiveFromChain,
  readCandidateMeta,
  disposeCandidate,
  type ResolverCdpClient,
} from "./cdp-recorder-resolver";

export type CdpRecorderConfig = {
  readonly debugPort: number;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly screenshotFormat?: "png" | "jpeg" | "webp";
  /**
   * 1 操作が記録されるたびに呼ばれるリスナー。
   * 進捗表示など外部副作用に使う。
   */
  readonly onEntry?: (entry: OperationEntry) => void;
};

/** CDP 傍受による手動操作レコーダー。 */
export type CdpRecorder = {
  /** レコーディング開始。 */
  start(): Promise<void>;
  /** レコーディング停止、操作履歴を返す。 */
  stop(title: string): Promise<OperationHistory>;
};

/** ブラウザ側から回収する確定済み input イベント。 */
type PendingInput = {
  /** before-screenshot との突合用。mousedown 等の predict 発火源が
   *  記録対象外だった場合は欠落することがある。 */
  readonly seq?: number;
  readonly selector: string;
  readonly value: string;
  readonly commitTrigger: "blur" | "enter" | "navigate-flush";
  readonly semantics: ElementSemantics;
  readonly rect: TargetRect;
  readonly pointerType: PointerType | null;
};

/** ブラウザ側から回収する click イベント (interactive 判定前の生)。 */
type RawCapturedClick = {
  readonly seq?: number;
  readonly chainIdx: number;
  readonly pointerType: PointerType | null;
};

/** Node 側で interactive 解決後の click。 */
type CapturedClick = {
  readonly seq?: number;
  readonly selector: string;
  readonly semantics: ElementSemantics;
  readonly rect: TargetRect;
  readonly pointerType: PointerType | null;
};

/** ブラウザ側から回収したドラッグ操作。 */
type CapturedDrag = {
  readonly seq?: number;
  readonly sourceChainIdx: number;
  readonly targetChainIdx: number;
  readonly pointerType: PointerType | null;
};

/** Node 側で interactive 解決後の DnD。 */
type ResolvedDrag = {
  readonly seq?: number;
  readonly sourceSelector: string;
  readonly targetSelector: string;
  readonly sourceSemantics?: ElementSemantics;
  readonly targetSemantics?: ElementSemantics;
  readonly sourceRect?: TargetRect;
  readonly targetRect?: TargetRect;
  readonly pointerType: PointerType | null;
};

/** ブラウザ側から回収する「これから操作する」予約。before-screenshot 用。 */
type Predict = {
  readonly seq: number;
  readonly kind: "click" | "input";
};

/** CdpRecorder を生成する。
 *
 * 注入スクリプトは ./cdp-recorder-injection.ts に分離済み。
 * 本体はその文字列を Chrome に送り、Node 側で polling/CDP 解決を担当する。
 *
 * (旧インラインスクリプトはここに置かない。削除済み。)
 */

/** CdpRecorder を生成する。 */
export function createCdpRecorder(config: CdpRecorderConfig): CdpRecorder {
  const { debugPort, viewport, screenshotFormat = "png", onEntry } = config;
  const entries: OperationEntry[] = [];

  function pushEntry(entry: OperationEntry): void {
    entries.push(entry);
    if (onEntry !== undefined) {
      onEntry(entry);
    }
  }

  // seq -> before スクショ (commit に紐付くまで保持)
  const beforeScreenshots = new Map<number, Uint8Array>();
  const ctx: {
    startedAt: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- CDP client type from chrome-remote-interface
    client: any;
    currentUrl: string;
  } = { startedAt: "", client: undefined, currentUrl: "" };

  async function captureScreenshot(): Promise<Uint8Array | undefined> {
    try {
      const { data } = await ctx.client.Page.captureScreenshot({
        format: screenshotFormat as "png" | "jpeg" | "webp",
      });
      return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    } catch {
      return undefined;
    }
  }

  function consumeBefore(seq: number | undefined): { screenshotBefore?: Uint8Array; screenshotBeforeFormat?: "png" | "jpeg" | "webp" } {
    if (seq === undefined) {
      return {};
    }
    const before = beforeScreenshots.get(seq);
    if (before === undefined) {
      return {};
    }
    beforeScreenshots.delete(seq);
    return { screenshotBefore: before, screenshotBeforeFormat: screenshotFormat };
  }

  async function recordClick(click: CapturedClick): Promise<void> {
    const start = performance.now();
    const screenshot = await captureScreenshot();
    const pointerType = click.pointerType ?? undefined;
    pushEntry({
      operation: {
        kind: "click",
        selector: click.selector,
        semantics: click.semantics,
        ...(pointerType !== undefined ? { pointerType } : {}),
      },
      timestamp: new Date().toISOString(),
      url: ctx.currentUrl,
      durationMs: Math.round(performance.now() - start),
      ...(click.rect !== null ? { targetRect: click.rect } : {}),
      ...(screenshot !== undefined ? { screenshot, screenshotFormat } : {}),
      ...consumeBefore(click.seq),
    });
  }

  async function recordInput(input: PendingInput): Promise<void> {
    const start = performance.now();
    const screenshot = await captureScreenshot();
    const pointerType = input.pointerType ?? undefined;
    pushEntry({
      operation: {
        kind: "input",
        selector: input.selector,
        value: input.value,
        commitTrigger: input.commitTrigger,
        semantics: input.semantics,
        ...(pointerType !== undefined ? { pointerType } : {}),
      },
      timestamp: new Date().toISOString(),
      url: ctx.currentUrl,
      durationMs: Math.round(performance.now() - start),
      ...(input.rect !== null ? { targetRect: input.rect } : {}),
      ...(screenshot !== undefined ? { screenshot, screenshotFormat } : {}),
      ...consumeBefore(input.seq),
    });
  }

  async function recordDrag(drag: ResolvedDrag): Promise<void> {
    const start = performance.now();
    const screenshot = await captureScreenshot();
    const pointerType = drag.pointerType ?? undefined;
    pushEntry({
      operation: {
        kind: "drag-and-drop",
        sourceSelector: drag.sourceSelector,
        targetSelector: drag.targetSelector,
        ...(drag.sourceSemantics !== undefined ? { sourceSemantics: drag.sourceSemantics } : {}),
        ...(drag.targetSemantics !== undefined ? { targetSemantics: drag.targetSemantics } : {}),
        ...(drag.sourceRect !== undefined ? { sourceRect: drag.sourceRect } : {}),
        ...(drag.targetRect !== undefined ? { targetRect: drag.targetRect } : {}),
        ...(pointerType !== undefined ? { pointerType } : {}),
      },
      timestamp: new Date().toISOString(),
      url: ctx.currentUrl,
      durationMs: Math.round(performance.now() - start),
      ...(drag.targetRect !== undefined ? { targetRect: drag.targetRect } : {}),
      ...(screenshot !== undefined ? { screenshot, screenshotFormat } : {}),
      ...consumeBefore(drag.seq),
    });
  }

  async function drainPredicts(): Promise<Predict[]> {
    try {
      const { result } = await ctx.client.Runtime.evaluate({
        expression: `JSON.stringify((window.__cdpDrainPredicts && window.__cdpDrainPredicts()) || [])`,
        returnByValue: true,
      });
      if (!result.value) {
        return [];
      }
      return JSON.parse(result.value as string) as Predict[];
    } catch {
      return [];
    }
  }

  async function pollPredicts(): Promise<void> {
    const predicts = await drainPredicts();
    if (predicts.length === 0) {
      return;
    }
    // 各 predict について順次 screenshot を撮って seq に紐付ける
    for (const predict of predicts) {
      const shot = await captureScreenshot();
      if (shot !== undefined) {
        beforeScreenshots.set(predict.seq, shot);
      }
    }
  }

  async function drainCommittedClicks(): Promise<RawCapturedClick[]> {
    try {
      const { result } = await ctx.client.Runtime.evaluate({
        expression: `JSON.stringify((window.__cdpDrainClicks && window.__cdpDrainClicks()) || [])`,
        returnByValue: true,
      });
      if (!result.value) {
        return [];
      }
      return JSON.parse(result.value as string) as RawCapturedClick[];
    } catch {
      return [];
    }
  }

  /** ctx.client を ResolverCdpClient として使うためのアクセサ。 */
  function getResolverClient(): ResolverCdpClient {
    return ctx.client as ResolverCdpClient;
  }

  /**
   * 生の click を interactive 解決する。
   * cdp-recorder-resolver.ts の純関数に委譲し、seq と pointerType をここで合成する。
   */
  async function resolveInteractiveClick(raw: RawCapturedClick): Promise<CapturedClick | null> {
    const resolved = await resolveInteractiveFromChain(getResolverClient(), raw.chainIdx);
    if (resolved === null) {
      return null;
    }
    return {
      seq: raw.seq,
      selector: resolved.selector,
      semantics: resolved.semantics,
      rect: resolved.rect,
      pointerType: raw.pointerType,
    };
  }

  async function drainCommittedDrags(): Promise<CapturedDrag[]> {
    try {
      const { result } = await ctx.client.Runtime.evaluate({
        expression: `JSON.stringify((window.__cdpDrainDrags && window.__cdpDrainDrags()) || [])`,
        returnByValue: true,
      });
      if (!result.value) {
        return [];
      }
      return JSON.parse(result.value as string) as CapturedDrag[];
    } catch {
      return [];
    }
  }

  async function resolveDrag(raw: CapturedDrag): Promise<ResolvedDrag | null> {
    // DnD は明示的な操作なので、source/target チェーンの先頭 (depth=0) を採用。
    // 必要なら ancestor 探索を入れられるが、まずはシンプルに。
    const client = getResolverClient();
    const sourceMeta = await readCandidateMeta(client, raw.sourceChainIdx, 0);
    const targetMeta = await readCandidateMeta(client, raw.targetChainIdx, 0);
    await disposeCandidate(client, raw.sourceChainIdx);
    await disposeCandidate(client, raw.targetChainIdx);
    if (sourceMeta === null || targetMeta === null) {
      return null;
    }
    return {
      seq: raw.seq,
      sourceSelector: sourceMeta.selector,
      targetSelector: targetMeta.selector,
      sourceSemantics: sourceMeta.semantics,
      targetSemantics: targetMeta.semantics,
      sourceRect: sourceMeta.rect ?? undefined,
      targetRect: targetMeta.rect ?? undefined,
      pointerType: raw.pointerType,
    };
  }

  async function drainCommittedInputs(): Promise<PendingInput[]> {
    try {
      const { result } = await ctx.client.Runtime.evaluate({
        expression: `JSON.stringify((window.__cdpDrainInputs && window.__cdpDrainInputs()) || [])`,
        returnByValue: true,
      });
      if (!result.value) {
        return [];
      }
      return JSON.parse(result.value as string) as PendingInput[];
    } catch {
      return [];
    }
  }

  async function flushPendingInputs(trigger: PendingInput["commitTrigger"]): Promise<void> {
    try {
      const { result } = await ctx.client.Runtime.evaluate({
        expression: `JSON.stringify((window.__cdpFlushInputs && window.__cdpFlushInputs(${JSON.stringify(trigger)})) || [])`,
        returnByValue: true,
      });
      if (!result.value) {
        return;
      }
      const inputs = JSON.parse(result.value as string) as PendingInput[];
      for (const input of inputs) {
        await recordInput(input);
      }
    } catch {
      // flush 失敗は無視
    }
  }

  async function drainAndRecord(): Promise<void> {
    // ドラッグは click より優先して処理する。
    // 同一ジェスチャで pointerup ベースの drag と click が両方発火する場合、
    // drag を採用して click を捨てたいが、現状は両方記録される (将来の最適化対象)。
    const rawDrags = await drainCommittedDrags();
    for (const raw of rawDrags) {
      const resolved = await resolveDrag(raw);
      if (resolved === null) {
        if (raw.seq !== undefined) {
          beforeScreenshots.delete(raw.seq);
        }
        continue;
      }
      await recordDrag(resolved);
    }
    const rawClicks = await drainCommittedClicks();
    for (const raw of rawClicks) {
      const resolved = await resolveInteractiveClick(raw);
      if (resolved === null) {
        // interactive ではない click は記録しない。
        // 対応する before スクショも破棄してメモリリークを防ぐ。
        if (raw.seq !== undefined) {
          beforeScreenshots.delete(raw.seq);
        }
        continue;
      }
      await recordClick(resolved);
    }
    const inputs = await drainCommittedInputs();
    for (const input of inputs) {
      await recordInput(input);
    }
  }

  // before-screenshot を最優先で撮り、確定済みイベントを処理する。
  // 順序が重要: predict → before 撮影 → click/input commit → entry 化。
  async function tick(): Promise<void> {
    await pollPredicts();
    await drainAndRecord();
  }

  return {
    async start(): Promise<void> {
      // eslint-disable-next-line no-restricted-syntax -- dynamic import: chrome-remote-interface is an optional dependency
      const cdpModule = await import("chrome-remote-interface");
      ctx.client = await cdpModule.default({ port: debugPort });

      await ctx.client.Page.enable();
      await ctx.client.DOM.enable();
      await ctx.client.Runtime.enable();
      // DOMDebugger は enable 不要 (常時有効)

      ctx.startedAt = new Date().toISOString();
      ctx.currentUrl = "";

      // ナビゲーション傍受
      ctx.client.Page.frameNavigated(async (params: { frame: { url: string; parentId?: string } }) => {
        // トップフレームのみ
        if (params.frame.parentId !== undefined) {
          return;
        }
        // ページ遷移直前: 既に commit された (= Enter で確定済みだがまだ poll 前の)
        // click / input をまず回収し、続いて未 commit の input を flush する。
        // この順序を守ることで「Enter で確定 → 即遷移」のケースでも入力が記録される。
        // predict も同じ tick 内で消化し、before-screenshot を最後の機会に撮る。
        await tick();
        await flushPendingInputs("navigate-flush");

        const start = performance.now();
        ctx.currentUrl = params.frame.url;
        const screenshot = await captureScreenshot();
        pushEntry({
          operation: { kind: "navigate", url: ctx.currentUrl },
          timestamp: new Date().toISOString(),
          url: ctx.currentUrl,
          durationMs: Math.round(performance.now() - start),
          ...(screenshot !== undefined ? { screenshot, screenshotFormat } : {}),
        });
      });

      // 既に開かれているページの URL を取得 (frameNavigated は起動後の遷移しか拾えない)
      try {
        const { result } = await ctx.client.Runtime.evaluate({
          expression: "window.location.href",
          returnByValue: true,
        });
        if (typeof result.value === "string") {
          ctx.currentUrl = result.value;
        }
      } catch {
        // 初回 URL 取得失敗は致命的ではない
      }

      // クリック / input 傍受リスナーを Runtime で注入
      await ctx.client.Runtime.evaluate({ expression: buildInjectionScript() });

      // predict (before スクショ予約) → confirmed events を 100ms 周期で回収。
      // 100ms にしているのは「mousedown 後すぐ click が確定して画面が変わる」前に
      // before スクショを撮るため。500ms だと変化後の画面しか撮れないことがある。
      //
      // loadEventFired を待たずに即時起動する。すでに開かれているページに対しても
      // この時点で attach 済みなので、polling は即時稼働させる必要がある。
      const interval = setInterval(() => {
        void tick();
      }, 100);
      ctx.client.__clickPollInterval = interval;

      // ページロード (遷移) 時にリスナーを再注入。
      // attachCdpRecorder は __cdpRecorderAttached で再注入をスキップするので、
      // 新ページ (= window がリセットされる) でのみ実際に attach される。
      ctx.client.Page.loadEventFired(async () => {
        await ctx.client.Runtime.evaluate({ expression: buildInjectionScript() });
      });
    },

    async stop(title: string): Promise<OperationHistory> {
      if (ctx.client.__clickPollInterval) {
        clearInterval(ctx.client.__clickPollInterval as NodeJS.Timeout);
      }
      await ctx.client.close();

      return {
        version: 1,
        title,
        startedAt: ctx.startedAt,
        finishedAt: new Date().toISOString(),
        viewport,
        entries,
      };
    },
  };
}
