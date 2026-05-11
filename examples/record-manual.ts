/**
 * @file 既存 Chrome に CDP で接続し、手動操作を記録して
 * マニュアル木 (tree.json) と 1 ページの xlsx 操作説明書を出力する。
 *
 * 事前準備:
 *   1. 既存 Chrome をすべて終了する。
 *   2. デバッグポート付きで Chrome を起動する:
 *      /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
 *        --remote-debugging-port=9222 \
 *        --user-data-dir="$HOME/.chrome-cdp-profile"
 *   3. このスクリプトを実行する:
 *      bun run examples/record-manual.ts [--title "操作マニュアル"] [--port 9222]
 *   4. Chrome 上で手動操作 (click / 入力)。input は blur か Enter で確定する。
 *   5. このスクリプトのターミナルで Enter キーを押すと停止し、
 *      output/ に history-*.json / tree-*.json / manual-*.xlsx が出力される。
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { stdin, stdout } from "node:process";
import { createCdpRecorder } from "../src/operation-capture/cdp-recorder";
import { serializeHistory } from "../src/operation-record/operation-io";
import { describeOperationDone } from "../src/operation-record/describe-operation";
import type { OperationEntry } from "../src/operation-record/operation-types";
import { buildManualTree } from "../src/operation-segments/build-manual-tree";
import { serializeManualTree } from "../src/operation-segments/manual-tree-io";
import { treeToEvidence } from "../src/operation-replay/tree-to-evidence";
import { buildEvidenceXlsx } from "../src/evidence-xlsx/xlsx-builder";

type CliArgs = {
  readonly title: string;
  readonly port: number;
  readonly outputDir: string;
};

function parseArgs(argv: readonly string[]): CliArgs {
  const args: { title: string; port: number; outputDir: string } = {
    title: "操作マニュアル",
    port: 9222,
    outputDir: "output",
  };
  for (const [i, a] of argv.entries()) {
    if (a === "--title" && argv[i + 1] !== undefined) {
      args.title = argv[i + 1];
    } else if (a === "--port" && argv[i + 1] !== undefined) {
      args.port = Number(argv[i + 1]);
    } else if (a === "--output-dir" && argv[i + 1] !== undefined) {
      args.outputDir = argv[i + 1];
    }
  }
  return args;
}

function formatShotInfo(entry: OperationEntry): string {
  const parts: string[] = [];
  if (entry.screenshotBefore !== undefined) {
    parts.push("before");
  }
  if (entry.screenshot !== undefined) {
    parts.push("after");
  }
  if (parts.length === 0) {
    return "";
  }
  return `  [scr: ${parts.join("+")}]`;
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const onData = (chunk: Buffer): void => {
      // Enter (LF) を受けたら resolve
      if (chunk.includes(0x0a) || chunk.includes(0x0d)) {
        stdin.off("data", onData);
        stdin.pause();
        resolve();
      }
    };
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  await mkdir(args.outputDir, { recursive: true });

  stdout.write(`[record-manual] Chrome に接続中 (port=${args.port}) ...\n`);
  const counter = { n: 0 };
  const recorder = createCdpRecorder({
    debugPort: args.port,
    viewport: { width: 1280, height: 800 },
    onEntry: (entry) => {
      counter.n += 1;
      const time = new Date(entry.timestamp).toLocaleTimeString("ja-JP", { hour12: false });
      const shotInfo = formatShotInfo(entry);
      stdout.write(`  [${counter.n.toString().padStart(3, " ")}] ${time}  ${describeOperationDone(entry)}${shotInfo}\n`);
    },
  });
  await recorder.start();
  stdout.write(`[record-manual] 記録開始: "${args.title}"\n`);
  stdout.write(`[record-manual] ブラウザで手動操作してください。`);
  stdout.write(` 終了する時はこのターミナルで Enter を押してください。\n`);

  await waitForEnter();

  stdout.write(`[record-manual] 停止中 ...\n`);
  const history = await recorder.stop(args.title);

  // 1. history.json
  const historyPath = join(args.outputDir, `history-${timestamp}.json`);
  await writeFile(historyPath, serializeHistory(history));
  stdout.write(`[record-manual] 操作履歴: ${historyPath}\n`);

  // 2. tree.json (URL 区切り)
  const tree = buildManualTree(history);
  const treePath = join(args.outputDir, `tree-${timestamp}.json`);
  await writeFile(treePath, serializeManualTree(tree));
  const totalEntries = tree.pages.reduce(
    (n, p) => n + p.groups.reduce((m, g) => m + g.entries.length, 0),
    0,
  );
  stdout.write(`[record-manual] マニュアル木: ${treePath} (${tree.pages.length}ページ, ${totalEntries}操作)\n`);

  // 3. xlsx (推敲せずデフォルト見出しで即生成)
  const report = treeToEvidence(tree);
  const xlsx = await buildEvidenceXlsx(report);
  const xlsxPath = join(args.outputDir, `manual-${timestamp}.xlsx`);
  await writeFile(xlsxPath, xlsx);
  stdout.write(`[record-manual] 操作説明書: ${xlsxPath}\n`);

  stdout.write(`\n[record-manual] 完了。\n`);
  stdout.write(`  ・ 推敲したい場合: ${treePath} を編集し、`);
  stdout.write(`buildManualFromTree や refineManualTree を呼んで再生成してください。\n`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
