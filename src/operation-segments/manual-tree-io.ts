/**
 * @file ManualTree の JSON シリアライズ / デシリアライズ。
 *
 * OperationEntry 内の screenshot (Uint8Array) は base64 で扱う。
 * 手編集 / LLM 補助いずれのケースでも JSON ラウンドトリップが必要。
 */

import type { OperationEntry } from "../operation-record/operation-types";
import type {
  ManualTree,
  PageSegment,
  OperationGroup,
} from "./manual-tree-types";

type SerializedEntry = Omit<OperationEntry, "screenshot" | "screenshotBefore"> & {
  readonly screenshot?: string;
  readonly screenshotBefore?: string;
};

type SerializedGroup = Omit<OperationGroup, "entries"> & {
  readonly entries: readonly SerializedEntry[];
};

type SerializedPage = Omit<PageSegment, "groups"> & {
  readonly groups: readonly SerializedGroup[];
};

type SerializedManualTree = Omit<ManualTree, "pages"> & {
  readonly pages: readonly SerializedPage[];
};

/** ManualTree を JSON 文字列に変換する。 */
export function serializeManualTree(tree: ManualTree): string {
  const serialized: SerializedManualTree = {
    ...tree,
    pages: tree.pages.map((page): SerializedPage => ({
      ...page,
      groups: page.groups.map((group): SerializedGroup => ({
        ...group,
        entries: group.entries.map(serializeEntry),
      })),
    })),
  };
  return JSON.stringify(serialized, undefined, 2);
}

/** JSON 文字列を ManualTree に変換する。 */
export function deserializeManualTree(json: string): ManualTree {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid manual tree: expected object");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj["version"] !== 1) {
    throw new Error(`Unsupported manual tree version: ${String(obj["version"])}`);
  }
  if (typeof obj["title"] !== "string") {
    throw new Error("Invalid manual tree: missing title");
  }
  if (typeof obj["startedAt"] !== "string") {
    throw new Error("Invalid manual tree: missing startedAt");
  }
  if (typeof obj["viewport"] !== "object" || obj["viewport"] === null) {
    throw new Error("Invalid manual tree: missing viewport");
  }
  if (!Array.isArray(obj["pages"])) {
    throw new Error("Invalid manual tree: pages must be an array");
  }

  const pages: PageSegment[] = (obj["pages"] as SerializedPage[]).map(
    (page): PageSegment => ({
      ...page,
      groups: page.groups.map((group): OperationGroup => ({
        ...group,
        entries: group.entries.map(deserializeEntry),
      })),
    }),
  );

  return {
    version: 1,
    title: obj["title"] as string,
    startedAt: obj["startedAt"] as string,
    finishedAt: obj["finishedAt"] as string | undefined,
    viewport: obj["viewport"] as { readonly width: number; readonly height: number },
    pages,
  };
}

function serializeEntry(entry: OperationEntry): SerializedEntry {
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

function deserializeEntry(entry: SerializedEntry): OperationEntry {
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
  for (const [i, ch] of [...binary].entries()) {
    bytes[i] = ch.charCodeAt(0);
  }
  return bytes;
}
