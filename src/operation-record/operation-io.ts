/**
 * @file 操作履歴のシリアライズ / デシリアライズ。
 *
 * OperationHistory ⇔ JSON 文字列の変換を行う。
 * screenshot (Uint8Array) は base64 エンコードで格納する。
 */

import type { OperationEntry, OperationHistory } from "./operation-types";

/** JSON 内でスクリーンショットを base64 文字列として表現する型。 */
type SerializedEntry = Omit<OperationEntry, "screenshot" | "screenshotBefore"> & {
  readonly screenshot?: string;
  readonly screenshotBefore?: string;
};

type SerializedHistory = Omit<OperationHistory, "entries"> & {
  readonly entries: readonly SerializedEntry[];
};

function decodeEntry(entry: SerializedEntry): OperationEntry {
  const { screenshot, screenshotBefore, ...rest } = entry;
  const out: { -readonly [K in keyof OperationEntry]?: OperationEntry[K] } = { ...rest } as { -readonly [K in keyof OperationEntry]?: OperationEntry[K] };
  if (screenshot !== undefined) {
    out.screenshot = base64ToUint8Array(screenshot);
  }
  if (screenshotBefore !== undefined) {
    out.screenshotBefore = base64ToUint8Array(screenshotBefore);
  }
  return out as OperationEntry;
}

function encodeEntry(entry: OperationEntry): SerializedEntry {
  const { screenshot, screenshotBefore, ...rest } = entry;
  const out: { -readonly [K in keyof SerializedEntry]?: SerializedEntry[K] } = { ...rest };
  if (screenshot !== undefined) {
    out.screenshot = uint8ArrayToBase64(screenshot);
  }
  if (screenshotBefore !== undefined) {
    out.screenshotBefore = uint8ArrayToBase64(screenshotBefore);
  }
  return out as SerializedEntry;
}

/** OperationHistory を JSON 文字列に変換する。 */
export function serializeHistory(history: OperationHistory): string {
  const serialized: SerializedHistory = {
    ...history,
    entries: history.entries.map(encodeEntry),
  };
  return JSON.stringify(serialized, undefined, 2);
}

/** JSON 文字列を OperationHistory に変換する。 */
export function deserializeHistory(json: string): OperationHistory {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid operation history: expected object");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj["version"] !== 1) {
    throw new Error(`Unsupported operation history version: ${String(obj["version"])}`);
  }
  if (typeof obj["title"] !== "string") {
    throw new Error("Invalid operation history: missing title");
  }
  if (typeof obj["startedAt"] !== "string") {
    throw new Error("Invalid operation history: missing startedAt");
  }
  if (typeof obj["viewport"] !== "object" || obj["viewport"] === null) {
    throw new Error("Invalid operation history: missing viewport");
  }
  if (!Array.isArray(obj["entries"])) {
    throw new Error("Invalid operation history: entries must be an array");
  }

  const entries: OperationEntry[] = (obj["entries"] as SerializedEntry[]).map(decodeEntry);

  return {
    version: 1,
    title: obj["title"] as string,
    startedAt: obj["startedAt"] as string,
    finishedAt: obj["finishedAt"] as string | undefined,
    viewport: obj["viewport"] as { readonly width: number; readonly height: number },
    entries,
  };
}

function uint8ArrayToBase64(data: Uint8Array): string {
  const chunks: string[] = [];
  for (const byte of data) {
    chunks.push(String.fromCharCode(byte));
  }
  return btoa(chunks.join(""));
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
