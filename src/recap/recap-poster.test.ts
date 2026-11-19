import { describe, expect, it } from "vitest";
import {
  planPosterTiles,
  POSTER_COLUMNS,
  POSTER_DESIGN,
  POSTER_FILLER_KINDS,
  POSTER_PLACEMENT_ORDER,
  POSTER_ROWS,
  POSTER_TILE_CAPACITY,
  POSTER_TILE_SIZES,
  type PosterPlacement,
  posterZoomFor,
  type PosterTileKind
} from "./recap-poster";

const OPTIONAL: readonly PosterTileKind[] = [
  "completion",
  "seasonal-favorites",
  "marathon",
  "timeliness",
  "behavior-preference",
  "binge",
  "platform-taste",
  "taste",
  "season-breakdown"
];

/** 四季最愛取代「有得選時先看」，私藏改成它封面上的標記：三者不會同時出現。 */
const canAppearTogether = (kinds: readonly PosterTileKind[]): boolean =>
  !(kinds.includes("seasonal-favorites") && (kinds.includes("behavior-preference") || kinds.includes("platform-taste")));

/** 每一格恰好被一塊磚覆蓋：沒有洞、沒有重疊、不出界。 */
const expectExactCover = (placements: readonly PosterPlacement[]): void => {
  const cells = Array.from({ length: POSTER_COLUMNS * POSTER_ROWS }, () => 0);
  for (const tile of placements) {
    expect(tile.column + tile.columnSpan).toBeLessThanOrEqual(POSTER_COLUMNS);
    expect(tile.row + tile.rowSpan).toBeLessThanOrEqual(POSTER_ROWS);
    expect(POSTER_TILE_SIZES[tile.kind]).toContainEqual([tile.columnSpan, tile.rowSpan]);
    for (let y = tile.row; y < tile.row + tile.rowSpan; y += 1) {
      for (let x = tile.column; x < tile.column + tile.columnSpan; x += 1) {
        cells[y * POSTER_COLUMNS + x] = (cells[y * POSTER_COLUMNS + x] ?? 0) + 1;
      }
    }
  }
  expect(cells.every((count) => count === 1)).toBe(true);
};

const layout = (placements: readonly PosterPlacement[]): Record<string, string> =>
  Object.fromEntries(placements.map((tile) => [tile.kind, `${tile.column},${tile.row} ${tile.columnSpan}x${tile.rowSpan}`]));

describe("summary poster tile planning", () => {
  it("lays out a full metadata deck with the hero and the follow-through card side by side", () => {
    const placements = planPosterTiles([
      "hero", "completion", "habit-clock", "marathon", "timeliness",
      "behavior-preference", "platform-taste", "taste"
    ]);
    expectExactCover(placements);
    expect(layout(placements)).toEqual({
      hero: "0,0 4x4",
      completion: "4,0 4x3",
      "habit-clock": "8,0 4x1",
      marathon: "8,1 4x1",
      timeliness: "8,2 2x1",
      "behavior-preference": "10,2 2x1",
      "platform-taste": "4,3 4x1",
      taste: "8,3 4x1"
    });
  });

  it("fits every tile that can appear together by shrinking the lowest priorities first", () => {
    const single = POSTER_PLACEMENT_ORDER.filter((kind) => kind !== "seasonal-favorites");
    const seasonal = POSTER_PLACEMENT_ORDER.filter(
      (kind) => kind !== "behavior-preference" && kind !== "platform-taste"
    );
    for (const kinds of [single, seasonal]) {
      const placements = planPosterTiles(kinds);
      expectExactCover(placements);
      expect(placements.map((tile) => tile.kind)).toEqual(kinds);
    }
    expect(layout(planPosterTiles(single))).toMatchObject({ hero: "0,0 4x4", completion: "4,0 4x3", "season-breakdown": "10,3 2x1" });
    // 四季最愛排在追番成績單旁邊，用兩欄兩列放下四季的封面。
    expect(layout(planPosterTiles(seasonal))).toMatchObject({ hero: "0,0 4x4", completion: "4,0 4x3", "seasonal-favorites": "8,0 4x2" });
  });

  it("fills a metadata-less recap with more real data instead of stretching tiles into empty boxes", () => {
    const placements = planPosterTiles(["hero", "habit-clock", "marathon"], ["weekday"]);
    expectExactCover(placements);
    expect(layout(placements)).toEqual({
      hero: "0,0 4x4",
      "habit-clock": "4,0 8x2",
      marathon: "4,2 4x2",
      weekday: "8,2 4x2"
    });
    // 馬拉松的內容只撐得起 4×2：不再被放大成 8×2 的空殼。
    for (const tile of placements) {
      expect(tile.columnSpan * tile.rowSpan).toBeLessThanOrEqual(POSTER_TILE_CAPACITY[tile.kind]);
    }
    const minimal = planPosterTiles(["hero", "habit-clock"]);
    expectExactCover(minimal);
    expect(minimal.map((tile) => tile.kind)).toEqual(["hero", "habit-clock"]);
  });

  it("never offers a tile size larger than its content can fill", () => {
    for (const [kind, sizes] of Object.entries(POSTER_TILE_SIZES) as [PosterTileKind, readonly (readonly [number, number])[]][]) {
      for (const [columns, rows] of sizes) expect(columns * rows).toBeLessThanOrEqual(POSTER_TILE_CAPACITY[kind]);
    }
  });

  it("only adds filler tiles when the real chapters leave room", () => {
    const full = planPosterTiles([
      "hero", "completion", "habit-clock", "marathon", "timeliness",
      "behavior-preference", "binge", "platform-taste", "taste"
    ], POSTER_FILLER_KINDS);
    expect(full.map((tile) => tile.kind)).not.toContain("weekday");
    // 沒有被允許的補白磚不會自己出現。
    expect(planPosterTiles(["hero", "habit-clock", "marathon"]).map((tile) => tile.kind)).not.toContain("weekday");
  });

  it("exactly covers the grid for every combination of optional chapters", () => {
    const started = Date.now();
    for (let mask = 0; mask < 1 << OPTIONAL.length; mask += 1) {
      const present = OPTIONAL.filter((_, index) => (mask & (1 << index)) !== 0);
      if (!canAppearTogether(present)) continue;
      for (const fillers of [[], POSTER_FILLER_KINDS]) {
        const placements = planPosterTiles(["hero", "habit-clock", ...present], fillers);
        expectExactCover(placements);
        expect(placements[0]).toMatchObject({ kind: "hero", column: 0, row: 0 });
        // 依優先序放置：除非版面真的塞不下，不會丟掉任何一章；補白磚可有可無。
        const primary = placements.filter((tile) => !POSTER_FILLER_KINDS.includes(tile.kind));
        expect(primary.length).toBe(present.length + 2);
      }
    }
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("always includes the hero even when asked for nothing", () => {
    const placements = planPosterTiles([]);
    expectExactCover(placements);
    expect(placements.map((tile) => tile.kind)).toEqual(["hero"]);
  });
});

describe("summary poster scale", () => {
  it("scales the whole designed poster up on large stages instead of stretching its tiles", () => {
    // 設計尺寸本身、或只大一點點：照原本的流動版面，不放大。
    expect(posterZoomFor(POSTER_DESIGN.width, POSTER_DESIGN.height)).toBeNull();
    expect(posterZoomFor(POSTER_DESIGN.width * 1.02, POSTER_DESIGN.height * 1.5)).toBeNull();
    // 比設計尺寸小：不縮小，交給原本的版面。
    expect(posterZoomFor(1221, 707)).toBeNull();
    // 2576×1449 的舞台：受高度限制，整張放大到填滿高度。
    expect(posterZoomFor(2510, 1344)).toBe(1.69);
    // 超寬螢幕：同樣受高度限制，左右留白而不是把磚拉寬。
    expect(posterZoomFor(3374, 1335)).toBe(1.679);
  });
});
