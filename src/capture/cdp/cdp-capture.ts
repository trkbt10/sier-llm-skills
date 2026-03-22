/**
 * @file Chrome DevTools Protocol (CDP) 直接キャプチャ戦略。
 *
 * chrome-remote-interface で CDP WebSocket 接続し、
 * Page.captureScreenshot でスクリーンショットを取得する。
 * Electron の webContents.debugger でも同じプロトコルが利用可能。
 *
 * Chrome を --remote-debugging-port=9222 で起動して使用する。
 */

import type {
  CaptureStrategy,
  BrowserSession,
  LaunchOptions,
  ScreenshotOptions,
} from "../types";

/** CDP キャプチャ戦略を生成する。 */
export function createCdpCaptureStrategy(): CaptureStrategy {
  return {
    name: "cdp",

    async launch(options?: LaunchOptions): Promise<BrowserSession> {
      const port = options?.debugPort ?? 9222;
      const viewport = options?.viewport ?? { width: 1280, height: 800 };

      // eslint-disable-next-line no-restricted-syntax -- dynamic import: chrome-remote-interface is an optional dependency
      const cdpModule = await import("chrome-remote-interface");
      const client = await cdpModule.default({ port });

      await client.Page.enable();
      await client.Runtime.enable();
      await client.DOM.enable();
      await client.Emulation.setDeviceMetricsOverride({
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false,
      });

      return {
        async navigate(url: string): Promise<void> {
          await client.Page.navigate({ url });
          await client.Page.loadEventFired();
        },

        async screenshot(opts?: ScreenshotOptions): Promise<Uint8Array> {
          const format = opts?.format ?? "png";
          const screenshotParams: {
            format?: "png" | "jpeg" | "webp";
            quality?: number;
            clip?: { x: number; y: number; width: number; height: number; scale: number };
            captureBeyondViewport?: boolean;
          } = {
            format: format as "png" | "jpeg" | "webp",
            quality: format === "png" ? undefined : opts?.quality,
            captureBeyondViewport: opts?.fullPage ?? false,
          };

          if (opts?.clip) {
            screenshotParams.clip = {
              x: opts.clip.x,
              y: opts.clip.y,
              width: opts.clip.width,
              height: opts.clip.height,
              scale: 1,
            };
          }

          const { data } = await client.Page.captureScreenshot(screenshotParams);
          return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        },

        async click(selector: string): Promise<void> {
          const { root } = await client.DOM.getDocument();
          const { nodeId } = await client.DOM.querySelector({
            nodeId: root.nodeId,
            selector,
          });
          if (nodeId === 0) {
            throw new Error(`Element not found: ${selector}`);
          }
          const { model } = await client.DOM.getBoxModel({ nodeId });
          const x = (model.content[0] + model.content[2]) / 2;
          const y = (model.content[1] + model.content[5]) / 2;

          await client.Input.dispatchMouseEvent({
            type: "mousePressed", x, y, button: "left", clickCount: 1,
          });
          await client.Input.dispatchMouseEvent({
            type: "mouseReleased", x, y, button: "left", clickCount: 1,
          });
        },

        async type(selector: string, text: string): Promise<void> {
          const { root } = await client.DOM.getDocument();
          const { nodeId } = await client.DOM.querySelector({
            nodeId: root.nodeId,
            selector,
          });
          if (nodeId === 0) {
            throw new Error(`Element not found: ${selector}`);
          }
          const { model } = await client.DOM.getBoxModel({ nodeId });
          const x = (model.content[0] + model.content[2]) / 2;
          const y = (model.content[1] + model.content[5]) / 2;
          await client.Input.dispatchMouseEvent({
            type: "mousePressed", x, y, button: "left", clickCount: 1,
          });
          await client.Input.dispatchMouseEvent({
            type: "mouseReleased", x, y, button: "left", clickCount: 1,
          });
          await client.Input.insertText({ text });
        },

        async evaluate<T>(fn: string): Promise<T> {
          const { result } = await client.Runtime.evaluate({
            expression: fn,
            returnByValue: true,
            awaitPromise: true,
          });
          return result.value as T;
        },

        async close(): Promise<void> {
          await client.close();
        },
      };
    },
  };
}
