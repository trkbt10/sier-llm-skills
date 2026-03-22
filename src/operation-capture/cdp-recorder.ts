/**
 * @file CDPイベント傍受による手動操作レコーダー。
 *
 * Chrome DevTools Protocol のイベントを監視し、
 * ユーザーの手動ブラウザ操作を OperationHistory として記録する。
 * Chrome を --remote-debugging-port で起動して使用する。
 */

import type { OperationEntry, OperationHistory } from "../operation-record/operation-types";

export type CdpRecorderConfig = {
  readonly debugPort: number;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly screenshotFormat?: "png" | "jpeg" | "webp";
};

/** CDP 傍受による手動操作レコーダー。 */
export type CdpRecorder = {
  /** レコーディング開始。 */
  start(): Promise<void>;
  /** レコーディング停止、操作履歴を返す。 */
  stop(title: string): Promise<OperationHistory>;
};

/** CdpRecorder を生成する。 */
export function createCdpRecorder(config: CdpRecorderConfig): CdpRecorder {
  const { debugPort, viewport, screenshotFormat = "png" } = config;
  const entries: OperationEntry[] = [];
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

  async function resolveSelector(x: number, y: number): Promise<string> {
    try {
      const { nodeId } = await ctx.client.DOM.getNodeForLocation({ x: Math.round(x), y: Math.round(y) });
      if (nodeId === 0) {
        return `[${Math.round(x)},${Math.round(y)}]`;
      }
      const { node } = await ctx.client.DOM.describeNode({ nodeId });
      const tag = (node.localName as string) ?? "unknown";
      if (node.attributes) {
        const attrs = node.attributes as string[];
        const idIdx = attrs.indexOf("id");
        if (idIdx >= 0 && attrs[idIdx + 1]) {
          return `#${attrs[idIdx + 1]}`;
        }
      }
      return tag;
    } catch {
      return `[${Math.round(x)},${Math.round(y)}]`;
    }
  }

  return {
    async start(): Promise<void> {
      // eslint-disable-next-line no-restricted-syntax -- dynamic import: chrome-remote-interface is an optional dependency
      const cdpModule = await import("chrome-remote-interface");
      ctx.client = await cdpModule.default({ port: debugPort });

      await ctx.client.Page.enable();
      await ctx.client.DOM.enable();
      await ctx.client.Runtime.enable();

      ctx.startedAt = new Date().toISOString();
      ctx.currentUrl = "";

      // ナビゲーション傍受
      ctx.client.Page.frameNavigated(async (params: { frame: { url: string; parentId?: string } }) => {
        // トップフレームのみ
        if (params.frame.parentId !== undefined) {
          return;
        }
        const start = performance.now();
        ctx.currentUrl = params.frame.url;
        const screenshot = await captureScreenshot();
        entries.push({
          operation: { kind: "navigate", url: ctx.currentUrl },
          timestamp: new Date().toISOString(),
          url: ctx.currentUrl,
          durationMs: Math.round(performance.now() - start),
          ...(screenshot !== undefined ? { screenshot, screenshotFormat } : {}),
        });
      });

      // クリック傍受 (Input.dispatchMouseEvent をフックする代わりに
      // Runtime で click イベントリスナーを注入)
      await ctx.client.Runtime.evaluate({
        expression: `
          (function() {
            if (window.__cdpRecorderAttached) return;
            window.__cdpRecorderAttached = true;
            document.addEventListener('click', function(e) {
              window.__cdpLastClick = {
                x: e.clientX,
                y: e.clientY,
                target: e.target?.tagName?.toLowerCase() || 'unknown'
              };
            }, true);
          })();
        `,
      });

      // ページロード時にクリックリスナーを再注入
      ctx.client.Page.loadEventFired(async () => {
        await ctx.client.Runtime.evaluate({
          expression: `
            (function() {
              if (window.__cdpRecorderAttached) return;
              window.__cdpRecorderAttached = true;
              document.addEventListener('click', function(e) {
                window.__cdpLastClick = {
                  x: e.clientX,
                  y: e.clientY,
                  target: e.target?.tagName?.toLowerCase() || 'unknown'
                };
              }, true);
            })();
          `,
        });

        // クリックイベントのポーリング
        const pollClick = async (): Promise<void> => {
          try {
            const { result } = await ctx.client.Runtime.evaluate({
              expression: `
                (function() {
                  const c = window.__cdpLastClick;
                  window.__cdpLastClick = null;
                  return c ? JSON.stringify(c) : null;
                })()
              `,
              returnByValue: true,
            });
            if (result.value) {
              const click = JSON.parse(result.value as string) as {
                x: number;
                y: number;
                target: string;
              };
              const start = performance.now();
              const selector = await resolveSelector(click.x, click.y);
              const screenshot = await captureScreenshot();
              entries.push({
                operation: { kind: "click", selector },
                timestamp: new Date().toISOString(),
                url: ctx.currentUrl,
                durationMs: Math.round(performance.now() - start),
                ...(screenshot !== undefined ? { screenshot, screenshotFormat } : {}),
              });
            }
          } catch {
            // ポーリング失敗は無視
          }
        };

        // 500ms 間隔でクリックをポーリング
        const interval = setInterval(() => {
          void pollClick();
        }, 500);

        // stop 時にクリアするため保持
        ctx.client.__clickPollInterval = interval;
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
