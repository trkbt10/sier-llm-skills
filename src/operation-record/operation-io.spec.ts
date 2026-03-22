/** @file serializeHistory / deserializeHistory の単体テスト。 */
import { serializeHistory, deserializeHistory } from "./operation-io";
import type { OperationHistory } from "./operation-types";

describe("operation-io", () => {
  const sampleHistory: OperationHistory = {
    version: 1,
    title: "test session",
    startedAt: "2026-03-22T10:00:00.000Z",
    finishedAt: "2026-03-22T10:01:00.000Z",
    viewport: { width: 1280, height: 800 },
    entries: [
      {
        operation: { kind: "navigate", url: "https://example.com" },
        timestamp: "2026-03-22T10:00:01.000Z",
        url: "https://example.com",
        durationMs: 500,
        screenshot: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        screenshotFormat: "png",
      },
      {
        operation: { kind: "click", selector: "a" },
        timestamp: "2026-03-22T10:00:02.000Z",
        url: "https://example.com",
        durationMs: 100,
      },
      {
        operation: { kind: "evaluate", expression: "document.title" },
        timestamp: "2026-03-22T10:00:03.000Z",
        url: "https://example.com",
        durationMs: 10,
        evaluateResult: "Example Domain",
      },
    ],
  };

  it("round-trips through serialize/deserialize", () => {
    const json = serializeHistory(sampleHistory);
    const restored = deserializeHistory(json);

    expect(restored.version).toBe(1);
    expect(restored.title).toBe("test session");
    expect(restored.startedAt).toBe("2026-03-22T10:00:00.000Z");
    expect(restored.finishedAt).toBe("2026-03-22T10:01:00.000Z");
    expect(restored.viewport).toEqual({ width: 1280, height: 800 });
    expect(restored.entries).toHaveLength(3);
  });

  it("preserves screenshot data through base64 encoding", () => {
    const json = serializeHistory(sampleHistory);
    const restored = deserializeHistory(json);
    const first = restored.entries[0];

    expect(first.screenshot).toBeInstanceOf(Uint8Array);
    expect(first.screenshot).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(first.screenshotFormat).toBe("png");
  });

  it("handles entries without screenshots", () => {
    const json = serializeHistory(sampleHistory);
    const restored = deserializeHistory(json);
    const second = restored.entries[1];

    expect(second.screenshot).toBeUndefined();
  });

  it("preserves evaluateResult", () => {
    const json = serializeHistory(sampleHistory);
    const restored = deserializeHistory(json);
    const third = restored.entries[2];

    expect(third.evaluateResult).toBe("Example Domain");
  });

  it("serializes to valid JSON with base64 screenshot", () => {
    const json = serializeHistory(sampleHistory);
    const parsed = JSON.parse(json);

    expect(typeof parsed.entries[0].screenshot).toBe("string");
    expect(parsed.entries[1].screenshot).toBeUndefined();
  });

  it("throws on invalid version", () => {
    expect(() => deserializeHistory('{"version": 2}')).toThrow("Unsupported operation history version");
  });

  it("throws on missing title", () => {
    expect(() => deserializeHistory('{"version": 1}')).toThrow("missing title");
  });

  it("throws on non-object input", () => {
    expect(() => deserializeHistory('"string"')).toThrow("expected object");
  });

  it("throws on missing startedAt", () => {
    expect(() => deserializeHistory('{"version": 1, "title": "t"}')).toThrow("missing startedAt");
  });

  it("throws on missing viewport", () => {
    expect(() =>
      deserializeHistory('{"version": 1, "title": "t", "startedAt": "2026-01-01T00:00:00Z"}'),
    ).toThrow("missing viewport");
  });

  it("throws on missing entries", () => {
    expect(() =>
      deserializeHistory(
        '{"version": 1, "title": "t", "startedAt": "2026-01-01T00:00:00Z", "viewport": {"width": 1, "height": 1}}',
      ),
    ).toThrow("entries must be an array");
  });
});
