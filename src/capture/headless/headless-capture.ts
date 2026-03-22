/**
 * @file Headless Playwright キャプチャ戦略。
 *
 * @zako-lib/web-capture のアダプターパターンを参考に、
 * Playwright を peer dependency として利用する。
 */

import type {
  CaptureStrategy,
  BrowserSession,
  LaunchOptions,
  ScreenshotOptions,
} from "../types";

type PlaywrightBrowser = {
  newContext: (options?: {
    viewport?: { width: number; height: number };
  }) => Promise<PlaywrightBrowserContext>;
  close: () => Promise<void>;
};

type PlaywrightBrowserContext = {
  newPage: () => Promise<PlaywrightPage>;
  close: () => Promise<void>;
};

type PlaywrightPage = {
  goto: (
    url: string,
    options?: { waitUntil?: string; timeout?: number },
  ) => Promise<unknown>;
  setViewportSize: (size: { width: number; height: number }) => Promise<void>;
  screenshot: (options?: {
    type?: string;
    quality?: number;
    fullPage?: boolean;
    clip?: { x: number; y: number; width: number; height: number };
  }) => Promise<Buffer>;
  evaluate: <T>(fn: string | (() => T)) => Promise<T>;
  click: (selector: string) => Promise<void>;
  fill: (selector: string, value: string) => Promise<void>;
  close: () => Promise<void>;
};

type BrowserLauncher = (options: {
  headless: boolean;
}) => Promise<PlaywrightBrowser>;

/** Headless Playwright キャプチャ戦略を生成する。 */
export function createHeadlessCaptureStrategy(launcher: BrowserLauncher): CaptureStrategy {
  return {
    name: "headless",

    async launch(options?: LaunchOptions): Promise<BrowserSession> {
      const headless = options?.headless ?? true;
      const viewport = options?.viewport ?? { width: 1280, height: 800 };

      const browser = await launcher({ headless });
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();

      return {
        async navigate(url: string): Promise<void> {
          await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
        },

        async screenshot(opts?: ScreenshotOptions): Promise<Uint8Array> {
          const format = opts?.format === "webp" ? "png" : (opts?.format ?? "png");
          const buffer = await page.screenshot({
            type: format,
            quality: format === "png" ? undefined : opts?.quality,
            fullPage: opts?.fullPage,
            clip: opts?.clip,
          });
          return new Uint8Array(buffer);
        },

        async click(selector: string): Promise<void> {
          await page.click(selector);
        },

        async type(selector: string, text: string): Promise<void> {
          await page.fill(selector, text);
        },

        async evaluate<T>(fn: string): Promise<T> {
          return page.evaluate<T>(fn);
        },

        async close(): Promise<void> {
          await page.close();
          await context.close();
          await browser.close();
        },
      };
    },
  };
}
