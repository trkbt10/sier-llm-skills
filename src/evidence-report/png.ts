/**
 * @file PNG バイナリからのメタデータ読み取りと EMU サイズ計算。
 */

import type { XlsxExtent } from "aurochs/xlsx/domain";

/** デフォルト表示幅 (EMU)。約 600px 相当。1px = 9525 EMU。 */
const DEFAULT_DISPLAY_WIDTH_EMU = 600 * 9525;

/**
 * PNG ヘッダーから幅と高さを読み取る。
 *
 * PNG signature (8 bytes) + IHDR chunk: length(4) + "IHDR"(4) + width(4) + height(4)
 */
export function readPngDimensions(data: Uint8Array): { width: number; height: number } | undefined {
  if (data.length < 24 || data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4E || data[3] !== 0x47) {
    return undefined;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return { width, height };
}

/**
 * 画像データから表示用 EMU extent を計算する。
 * 指定幅に固定し、アスペクト比を維持する。
 */
export function computeImageExtent(imageData: Uint8Array, displayWidthEmu = DEFAULT_DISPLAY_WIDTH_EMU): XlsxExtent {
  const dims = readPngDimensions(imageData);
  if (dims && dims.width > 0 && dims.height > 0) {
    const cx = displayWidthEmu;
    const cy = Math.round(cx * (dims.height / dims.width));
    return { cx, cy };
  }
  return { cx: displayWidthEmu, cy: Math.round(displayWidthEmu * 0.625) };
}

/** スクリーンショット形式から MIME タイプを返す。 */
export function screenshotFormatToMime(format: string): string {
  if (format === "jpeg" || format === "jpg") {
    return "image/jpeg";
  }
  if (format === "webp") {
    return "image/webp";
  }
  return "image/png";
}
