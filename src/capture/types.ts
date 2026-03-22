/**
 * @file ブラウザーキャプチャの共通型定義。
 * 3つの戦略 (headless, chrome-mcp, cdp) が共通して実装する。
 */

export type LaunchOptions = {
  readonly headless?: boolean;
  readonly viewport?: Viewport;
  readonly debugPort?: number;
};

export type Viewport = {
  readonly width: number;
  readonly height: number;
};

export type ScreenshotOptions = {
  readonly format?: "png" | "jpeg" | "webp";
  readonly fullPage?: boolean;
  readonly clip?: ClipRegion;
  readonly quality?: number;
};

export type ClipRegion = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type BrowserSession = {
  navigate(url: string): Promise<void>;
  screenshot(options?: ScreenshotOptions): Promise<Uint8Array>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  evaluate<T>(fn: string): Promise<T>;
  close(): Promise<void>;
};

export type CaptureStrategy = {
  readonly name: string;
  launch(options?: LaunchOptions): Promise<BrowserSession>;
};
