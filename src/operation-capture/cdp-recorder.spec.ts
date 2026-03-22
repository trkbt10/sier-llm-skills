/** @file createCdpRecorder の単体テスト。 */
import { createCdpRecorder } from "./cdp-recorder";

/**
 * CDP モジュールの代わりにテスト用フェイクを構築する。
 * chrome-remote-interface を動的 import でロードする実装に対し、
 * import map (bunfig.toml) を利用してフェイクに差し替えるのは大掛かりなため、
 * ここでは createCdpRecorder の公開 API のみをテストし、
 * CDP 接続が必要なテストは DI 可能な範囲に限定する。
 */

describe("createCdpRecorder", () => {
  it("creates a recorder with start and stop methods", () => {
    const recorder = createCdpRecorder({
      debugPort: 9222,
      viewport: { width: 1280, height: 800 },
    });

    expect(recorder.start).toBeTypeOf("function");
    expect(recorder.stop).toBeTypeOf("function");
  });

  it("start rejects when CDP connection fails", async () => {
    // debugPort 0 は接続不可なので必ずエラーになる
    const recorder = createCdpRecorder({
      debugPort: 0,
      viewport: { width: 1280, height: 800 },
    });

    await expect(recorder.start()).rejects.toThrow();
  });
});
