/**
 * @file XLSX への画像直接注入 (ZipPackage 低レベル操作)。
 *
 * 元の XLSX のデザインを維持したまま、指定セル位置にスクリーンショットを埋め込む。
 * aurochs の ZipPackage API で drawing XML, rels, Content_Types を直接操作する。
 */

import { loadZipPackage } from "aurochs/zip";
import type { ZipPackage } from "aurochs/zip";
import { readFile, writeFile } from "node:fs/promises";
import { computeImageExtent } from "../evidence-xlsx/png";

/** 画像挿入指定。 */
export type ImageInsert = {
  /** 画像データ (PNG)。 */
  readonly data: Uint8Array;
  /** アンカー開始列 (0-based)。 */
  readonly fromCol: number;
  /** アンカー開始行 (0-based)。 */
  readonly fromRow: number;
  /** アンカー終了列 (0-based)。 */
  readonly toCol: number;
  /** アンカー終了行 (0-based)。 */
  readonly toRow: number;
};

/** シートへの画像挿入指定。 */
export type SheetImagePatch = {
  /** シート XML パス (例: "xl/worksheets/sheet1.xml")。 */
  readonly sheetXmlPath: string;
  /** 挿入する画像群。 */
  readonly images: readonly ImageInsert[];
};

/** XLSX ファイルに画像を直接注入する。 */
export async function patchXlsxWithImages(
  inputPath: string,
  outputPath: string,
  patches: readonly SheetImagePatch[],
): Promise<void> {
  const data = await readFile(inputPath);
  const pkg = await loadZipPackage(data);

  for (const patch of patches) {
    applySheetPatch(pkg, patch);
  }

  const result = await pkg.toArrayBuffer();
  await writeFile(outputPath, Buffer.from(result));
}

function applySheetPatch(pkg: ZipPackage, patch: SheetImagePatch): void {
  const { sheetXmlPath, images } = patch;
  if (images.length === 0) {
    return;
  }

  const sheetDir = sheetXmlPath.replace(/\/[^/]+$/, "");
  const sheetFileName = sheetXmlPath.replace(/^.*\//, "");
  const relsPath = `${sheetDir}/_rels/${sheetFileName}.rels`;
  const drawingPath = resolveDrawingPath(pkg, relsPath);

  // 画像ファイルを ZIP に書き込み
  const imageRelIds: string[] = [];
  for (const [idx, img] of images.entries()) {
    const imageFileName = `image_patch_${idx + 1}.png`;
    const imagePath = `xl/media/${imageFileName}`;
    pkg.writeBinary(imagePath, img.data);

    const relId = `rId_img_${idx + 1}`;
    imageRelIds.push(relId);
  }

  // drawing XML を生成/更新
  const drawingXml = buildDrawingXml(images, imageRelIds);
  pkg.writeText(drawingPath, drawingXml);

  // drawing rels を生成
  const drawingRelsPath = drawingPath.replace(/\/([^/]+)$/, "/_rels/$1.rels");
  const drawingRels = buildDrawingRels(images, imageRelIds);
  pkg.writeText(drawingRelsPath, drawingRels);

  // sheet rels にdrawing参照を追加
  ensureSheetRels(pkg, relsPath, drawingPath);

  // シート XML に drawing 参照を追加
  ensureSheetDrawingRef(pkg, sheetXmlPath);

  // Content_Types に PNG と drawing を追加
  ensureContentTypes(pkg);
}

function resolveDrawingPath(pkg: ZipPackage, relsPath: string): string {
  if (pkg.exists(relsPath)) {
    const rels = pkg.readText(relsPath) ?? "";
    const match = rels.match(/Target="([^"]*drawing[^"]*)"/);
    if (match) {
      return `xl/${match[1].replace(/^\.\.\//, "")}`;
    }
  }
  return "xl/drawings/drawing1.xml";
}

function buildDrawingXml(images: readonly ImageInsert[], relIds: readonly string[]): string {
  const anchors = images.map((img, idx) => {
    const extent = computeImageExtent(img.data);
    return `<xdr:twoCellAnchor editAs="oneCell">` +
      `<xdr:from><xdr:col>${img.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff>` +
      `<xdr:row>${img.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
      `<xdr:to><xdr:col>${img.toCol}</xdr:col><xdr:colOff>0</xdr:colOff>` +
      `<xdr:row>${img.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
      `<xdr:pic>` +
      `<xdr:nvPicPr><xdr:cNvPr id="${idx + 1}" name="Screenshot${idx + 1}"/>` +
      `<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
      `<xdr:blipFill><a:blip r:embed="${relIds[idx]}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
      `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${extent.cx}" cy="${extent.cy}"/></a:xfrm>` +
      `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
      `</xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`;
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    anchors.join("") +
    `</xdr:wsDr>`;
}

function buildDrawingRels(images: readonly ImageInsert[], relIds: readonly string[]): string {
  const rels = images.map((_, idx) =>
    `<Relationship Id="${relIds[idx]}" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ` +
    `Target="../media/image_patch_${idx + 1}.png"/>`,
  );

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    rels.join("") +
    `</Relationships>`;
}

function ensureSheetRels(pkg: ZipPackage, relsPath: string, drawingPath: string): void {
  const target = `../${drawingPath.replace("xl/", "")}`;

  if (pkg.exists(relsPath)) {
    const existing = pkg.readText(relsPath) ?? "";
    if (existing.includes("drawing")) {
      return;
    }
    const updated = existing.replace(
      "</Relationships>",
      `<Relationship Id="rId_drawing1" ` +
      `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" ` +
      `Target="${target}"/></Relationships>`,
    );
    pkg.writeText(relsPath, updated);
    return;
  }

  pkg.writeText(relsPath,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId_drawing1" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" ` +
    `Target="${target}"/></Relationships>`,
  );
}

function ensureSheetDrawingRef(pkg: ZipPackage, sheetXmlPath: string): void {
  const sheetXml = pkg.readText(sheetXmlPath) ?? "";
  if (sheetXml.includes("<drawing")) {
    return;
  }

  // xmlns:r が worksheet タグに必要
  const rNs = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const withNs = addRelationshipNamespace(sheetXml, rNs);

  const updated = withNs.replace(
    "</worksheet>",
    `<drawing r:id="rId_drawing1"/></worksheet>`,
  );
  pkg.writeText(sheetXmlPath, updated);
}

function addRelationshipNamespace(xml: string, ns: string): string {
  if (xml.includes("xmlns:r")) {
    return xml;
  }
  return xml.replace("<worksheet", `<worksheet ${ns}`);
}

function ensureContentTypes(pkg: ZipPackage): void {
  const ct = pkg.readText("[Content_Types].xml") ?? "";
  const additions: string[] = [];

  if (!ct.includes('Extension="png"')) {
    additions.push(`<Default Extension="png" ContentType="image/png"/>`);
  }
  if (!ct.includes("drawing+xml")) {
    additions.push(
      `<Override PartName="/xl/drawings/drawing1.xml" ` +
      `ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
    );
  }

  if (additions.length === 0) {
    return;
  }

  const updated = ct.replace("<Types", `<Types`) .replace(
    "</Types>",
    additions.join("") + "</Types>",
  );
  pkg.writeText("[Content_Types].xml", updated);
}
