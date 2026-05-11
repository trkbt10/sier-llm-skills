/**
 * @file OperationHistory → ManualTree 構築。
 *
 * URL の変化を境界として PageSegment を切り出す純関数。
 * 推敲前段階のため、各 PageSegment は単一の OperationGroup を持つ。
 */

import type { OperationEntry, OperationHistory } from "../operation-record/operation-types";
import type { ManualTree, PageSegment, OperationGroup } from "./manual-tree-types";

/**
 * OperationHistory を ManualTree に変換する。
 *
 * URL が変化したエントリで PageSegment を分割。最初のエントリが
 * navigate でなくても、その entry.url を初期セグメントとして採用する。
 */
export function buildManualTree(history: OperationHistory): ManualTree {
  const pages: PageSegment[] = [];
  const bucket: OperationEntry[] = [];
  const ctx: { currentUrl: string | undefined; segmentStartedAt: string | undefined } = {
    currentUrl: undefined,
    segmentStartedAt: undefined,
  };

  function flush(endedAt: string): void {
    if (ctx.currentUrl === undefined || ctx.segmentStartedAt === undefined) {
      return;
    }
    if (bucket.length === 0) {
      return;
    }
    const group: OperationGroup = { entries: [...bucket] };
    pages.push({
      url: ctx.currentUrl,
      startedAt: ctx.segmentStartedAt,
      endedAt,
      groups: [group],
    });
    bucket.length = 0;
  }

  for (const entry of history.entries) {
    const entryUrl = entry.url;
    if (ctx.currentUrl === undefined) {
      ctx.currentUrl = entryUrl;
      ctx.segmentStartedAt = entry.timestamp;
    } else if (entryUrl !== ctx.currentUrl) {
      flush(entry.timestamp);
      ctx.currentUrl = entryUrl;
      ctx.segmentStartedAt = entry.timestamp;
    }
    bucket.push(entry);
  }

  const endedAt = history.finishedAt ?? history.startedAt;
  flush(endedAt);

  return {
    version: 1,
    title: history.title,
    startedAt: history.startedAt,
    finishedAt: history.finishedAt,
    viewport: history.viewport,
    pages,
  };
}
