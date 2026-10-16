import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatCompactDuration } from "../analysis-format";
import { buildRecapDeck } from "./recap-deck";
import { buildSummaryScene } from "./recap-poster";
import { FakeNode, findAll, hasClass, installFakeDocument, spokenText } from "./recap-test-dom";
import { fullResult } from "./recap-test-fixtures";

let restoreDocument: () => void = () => undefined;

beforeEach(() => {
  restoreDocument = installFakeDocument();
});

afterEach(() => {
  restoreDocument();
});

const buildPoster = (): FakeNode => {
  const deck = buildRecapDeck(fullResult());
  const scene = buildSummaryScene(deck, false, {
    onRestart: () => undefined,
    onPrevious: () => undefined,
    onDashboard: () => undefined,
    onGoto: () => undefined
  });
  return scene.root as unknown as FakeNode;
};

describe("summary poster accessibility", () => {
  it("keeps every tile's data readable instead of hiding it behind a button label", () => {
    const root = buildPoster();
    const tiles = findAll(root, (node) => node.dataset.tile !== undefined);
    expect(tiles.length).toBeGreaterThan(5);
    for (const tile of tiles) {
      // 磚是一般的 <article>：沒有 aria-label 蓋掉內容，名稱指向磚裡的標題。
      expect(tile.tagName).toBe("ARTICLE");
      expect(tile.hasAttribute("aria-label")).toBe(false);
      const labelId = tile.getAttribute("aria-labelledby");
      const label = findAll(tile, (node) => node.id !== "" && node.id === labelId)[0];
      expect(label?.tagName).toBe("H4");
      expect(label?.textContent.trim()).not.toBe("");
      // 導覽是磚裡唯一的一顆真按鈕，按鈕有自己的名稱。
      const buttons = findAll(tile, (node) => node.tagName === "BUTTON");
      expect(buttons).toHaveLength(1);
      expect(buttons[0]?.textContent).toMatch(/^回到第 \d+ 章：/);
    }
    // 磚的 id 不重複。
    const ids = tiles.map((tile) => tile.getAttribute("aria-labelledby"));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("announces the numbers, not only the chapter names", () => {
    const root = buildPoster();
    const tile = (kind: string): FakeNode => findAll(root, (node) => node.dataset.tile === kind)[0]!;
    const hero = spokenText(tile("hero"));
    expect(hero).toContain("已知片長合計");
    expect(hero).toMatch(/6\s*小時\s*6\s*分/);
    expect(hero).toContain("12次觀看");
    expect(hero).toMatch(/9\s*\/ 365\s*天/);
    expect(spokenText(tile("habit-clock"))).toContain("42%");
    expect(spokenText(tile("timeliness"))).toContain("3小時通常等待 · 75% 在 24 小時內");
    const ledger = tile("ledger");
    expect(spokenText(ledger)).toContain(formatCompactDuration(210));
    // 排行榜是真的有序清單。
    const list = findAll(ledger, (node) => node.tagName === "OL")[0];
    expect(list?.children.every((row) => row.tagName === "LI")).toBe(true);
    expect(list?.children.map((row) => spokenText(row))[0]).toContain("作品 A");
  });

  it("makes the persona a readable region with its own jump button", () => {
    const root = buildPoster();
    const persona = findAll(root, (node) => hasClass(node, "ani-rc-persona"))[0]!;
    expect(persona.tagName).not.toBe("BUTTON");
    expect(persona.hasAttribute("aria-label")).toBe(false);
    expect(spokenText(persona)).toContain("你的觀看型態");
    expect(findAll(persona, (node) => node.tagName === "BUTTON")).toHaveLength(1);
  });
});
