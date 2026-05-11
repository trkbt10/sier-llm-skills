/** @file image-to-drawing の単体テスト (buildAspectAwareDrawing 中心)。 */
import {
  buildAspectAwareDrawing,
  buildDrawingFromImages,
  colWidthToPx,
  pxToRowHeightPt,
} from "./image-to-drawing";

/** width × height の 1x1 透明 PNG を生成する (寸法はヘッダにエンコード)。 */
function makePng(width: number, height: number): Uint8Array {
  // 最小 PNG (IHDR のみ書き換え、IDAT は固定の小さなデータ、CRC は無視)。
  // PNG パーサ (readPngDimensions) は signature + IHDR の width/height しか
  // 見ないので、CRC が無効でも寸法は取れる。
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0, 0, 0, 0, 0, 0, 0, 0,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);
  const view = new DataView(png.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return png;
}

describe("buildAspectAwareDrawing - displayMaxHeightPx", () => {
  it("shrinks width when image is taller than max height (portrait)", () => {
    // 100x400 (1:4 portrait), displayWidthPx=200, max height=200
    // naive: width=200, height=800 → max超 → height=200, width=200/4=50
    const result = buildAspectAwareDrawing([
      {
        data: makePng(100, 400),
        format: "png",
        fromCol: 1, fromRow: 1,
        displayWidthPx: 200,
        displayMaxHeightPx: 200,
      },
    ]);
    expect(result.placements[0].heightPx).toBe(200);
    const anchor = result.anchors[0];
    if (anchor.type !== "oneCellAnchor") {
      throw new Error("expected oneCellAnchor");
    }
    expect(anchor.ext.cy).toBe(200 * 9525);
    expect(anchor.ext.cx).toBe(50 * 9525);
  });

  it("keeps width when image is wider than tall (landscape)", () => {
    // 400x100 (4:1 landscape), displayWidthPx=200, max height=200
    // naive: width=200, height=50 → max未満 → そのまま
    const result = buildAspectAwareDrawing([
      {
        data: makePng(400, 100),
        format: "png",
        fromCol: 1, fromRow: 1,
        displayWidthPx: 200,
        displayMaxHeightPx: 200,
      },
    ]);
    expect(result.placements[0].heightPx).toBe(50);
    const anchor = result.anchors[0];
    if (anchor.type !== "oneCellAnchor") {
      throw new Error("expected oneCellAnchor");
    }
    expect(anchor.ext.cx).toBe(200 * 9525);
    expect(anchor.ext.cy).toBe(50 * 9525);
  });
});

describe("buildAspectAwareDrawing", () => {
  it("emits oneCellAnchor type", () => {
    const result = buildAspectAwareDrawing([
      { data: makePng(100, 50), format: "png", fromCol: 1, fromRow: 1, displayWidthPx: 200 },
    ]);
    expect(result.anchors).toHaveLength(1);
    expect(result.anchors[0].type).toBe("oneCellAnchor");
  });

  it("preserves aspect ratio when sizing the image", () => {
    // 100x50 (2:1) を表示幅 200px にフィット → 高さ 100px
    const result = buildAspectAwareDrawing([
      { data: makePng(100, 50), format: "png", fromCol: 1, fromRow: 1, displayWidthPx: 200 },
    ]);
    const placement = result.placements[0];
    expect(placement.heightPx).toBe(100);
  });

  it("converts displayWidthPx to EMU as cx (1 px = 9525 EMU)", () => {
    const result = buildAspectAwareDrawing([
      { data: makePng(100, 50), format: "png", fromCol: 1, fromRow: 1, displayWidthPx: 200 },
    ]);
    const anchor = result.anchors[0];
    if (anchor.type !== "oneCellAnchor") {
      throw new Error("expected oneCellAnchor");
    }
    expect(anchor.ext.cx).toBe(200 * 9525);
    expect(anchor.ext.cy).toBe(100 * 9525);
  });

  it("places anchor at fromCol/fromRow translated to 0-based", () => {
    const result = buildAspectAwareDrawing([
      { data: makePng(10, 10), format: "png", fromCol: 5, fromRow: 3, displayWidthPx: 100 },
    ]);
    const anchor = result.anchors[0];
    if (anchor.type !== "oneCellAnchor") {
      throw new Error("expected oneCellAnchor");
    }
    expect(anchor.from.col).toBe(4);
    expect(anchor.from.row).toBe(2);
  });

  it("falls back to square (1:1) when PNG header is unreadable", () => {
    const result = buildAspectAwareDrawing([
      { data: new Uint8Array([1, 2, 3]), format: "png", fromCol: 1, fromRow: 1, displayWidthPx: 200 },
    ]);
    const placement = result.placements[0];
    expect(placement.heightPx).toBe(200);
  });

  it("emits one mediaMap entry per image with the correct relId", () => {
    const result = buildAspectAwareDrawing([
      { data: makePng(10, 10), format: "png", fromCol: 1, fromRow: 1, displayWidthPx: 100 },
      { data: makePng(20, 20), format: "jpeg", fromCol: 1, fromRow: 2, displayWidthPx: 100 },
    ]);
    expect(result.mediaMap.size).toBe(2);
    expect(result.mediaMap.get("rId1")?.contentType).toBe("image/png");
    expect(result.mediaMap.get("rId2")?.contentType).toBe("image/jpeg");
  });
});

describe("colWidthToPx", () => {
  it("uses approximately 7 px per character", () => {
    expect(colWidthToPx(10)).toBe(70);
    expect(colWidthToPx(70)).toBe(490);
  });
});

describe("pxToRowHeightPt", () => {
  it("converts px to pt with 9525 EMU/px and 12700 EMU/pt", () => {
    // 100 px → 100 * 9525 / 12700 = 75 pt
    expect(pxToRowHeightPt(100)).toBeCloseTo(75, 3);
  });
});

describe("buildDrawingFromImages (legacy twoCellAnchor)", () => {
  it("still emits twoCellAnchor for backward compatibility", () => {
    const result = buildDrawingFromImages([
      {
        data: makePng(100, 50),
        format: "png",
        fromCol: 1,
        fromRow: 1,
        toCol: 2,
        toRow: 5,
        name: "img",
      },
    ]);
    expect(result.anchors[0].type).toBe("twoCellAnchor");
  });
});
