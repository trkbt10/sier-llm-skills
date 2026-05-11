/**
 * @file ManualTree への推敲パッチ適用。
 *
 * ユーザー手編集または LLM 補助からの差分を ManualTree に重ねる純関数。
 * operation や screenshot は触らず、step (action/expected) と
 * 見出し情報のみを差し替える。
 */

import type { OperationEntry, StepDescription } from "../operation-record/operation-types";
import type {
  ManualTree,
  ManualTreeEdits,
  ManualTreeEntryEdit,
  ManualTreeGroupEdit,
  ManualTreePageEdit,
  OperationGroup,
  PageSegment,
} from "./manual-tree-types";

/**
 * ManualTree に推敲差分を適用した新しい ManualTree を返す。
 *
 * pages/groups/entries は座標 (index) で参照する。範囲外 index は無視する
 * (LLM の生成揺れに耐えるため厳格には throw しない)。
 */
export function refineManualTree(tree: ManualTree, edits: ManualTreeEdits): ManualTree {
  const pageEditByIndex = indexEditsByPage(edits.pages);

  const pages: PageSegment[] = tree.pages.map((page, pageIndex) => {
    const pageEdit = pageEditByIndex.get(pageIndex);
    if (pageEdit === undefined) {
      return page;
    }
    return applyPageEdit(page, pageEdit);
  });

  return {
    ...tree,
    title: edits.title ?? tree.title,
    pages,
  };
}

function indexEditsByPage(
  pageEdits: readonly ManualTreePageEdit[] | undefined,
): Map<number, ManualTreePageEdit> {
  const map = new Map<number, ManualTreePageEdit>();
  if (pageEdits === undefined) {
    return map;
  }
  for (const edit of pageEdits) {
    map.set(edit.pageIndex, edit);
  }
  return map;
}

function applyPageEdit(page: PageSegment, edit: ManualTreePageEdit): PageSegment {
  const groupEditByIndex = new Map<number, ManualTreeGroupEdit>();
  if (edit.groups !== undefined) {
    for (const g of edit.groups) {
      groupEditByIndex.set(g.groupIndex, g);
    }
  }

  const groups: OperationGroup[] = page.groups.map((group, groupIndex) => {
    const groupEdit = groupEditByIndex.get(groupIndex);
    if (groupEdit === undefined) {
      return group;
    }
    return applyGroupEdit(group, groupEdit);
  });

  return {
    ...page,
    pageTitle: edit.pageTitle ?? page.pageTitle,
    groups,
  };
}

function applyGroupEdit(group: OperationGroup, edit: ManualTreeGroupEdit): OperationGroup {
  const entryEditByIndex = new Map<number, ManualTreeEntryEdit>();
  if (edit.entries !== undefined) {
    for (const e of edit.entries) {
      entryEditByIndex.set(e.entryIndex, e);
    }
  }

  const entries: OperationEntry[] = group.entries.map((entry, entryIndex) => {
    const entryEdit = entryEditByIndex.get(entryIndex);
    if (entryEdit === undefined) {
      return entry;
    }
    return applyEntryEdit(entry, entryEdit);
  });

  return {
    ...group,
    heading: edit.heading ?? group.heading,
    entries,
  };
}

function applyEntryEdit(entry: OperationEntry, edit: ManualTreeEntryEdit): OperationEntry {
  if (edit.action === undefined && edit.expected === undefined) {
    return entry;
  }
  const baseStep: StepDescription = entry.step ?? { action: "", expected: "" };
  const step: StepDescription = {
    action: edit.action ?? baseStep.action,
    expected: edit.expected ?? baseStep.expected,
  };
  return { ...entry, step };
}
