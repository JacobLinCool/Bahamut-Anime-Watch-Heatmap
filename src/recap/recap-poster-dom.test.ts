import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRecapDeck } from "./recap-deck";
import { buildSummaryScene } from "./recap-poster";
import { FakeNode, findAll, hasClass, installFakeDocument, spokenText } from "./recap-test-dom";
import { bingeResult, fullResult } from "./recap-test-fixtures";

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
  it("adds a daily-pace tile linked to its chapter only when present", () => {
    for (const present of [true, false]) {
      const result = bingeResult();
      const deck = buildRecapDeck(present ? result : { ...result, binge: { available: false, rows: [] } });
      const scene = buildSummaryScene(deck, false, {
        onRestart: () => undefined,
        onPrevious: () => undefined,
        onDashboard: () => undefined,
        onGoto: () => undefined
      });
      const root = scene.root as unknown as FakeNode;
      const tiles = findAll(root, (node) => node.dataset.tile === "binge");
      expect(tiles).toHaveLength(present ? 1 : 0);
      if (!present) continue;
      expect(spokenText(tiles[0]!)).toContain("補番速度");
      expect(spokenText(tiles[0]!)).toContain("補番作品 B");
      expect(spokenText(tiles[0]!)).toContain("3 集／日");
      expect(spokenText(tiles[0]!)).not.toMatch(/最快補完|12 集|24 集|耗時|4 天|7 天/);
      const button = findAll(tiles[0]!, (node) => node.tagName === "BUTTON")[0]!;
      expect(button.textContent).toMatch(/^回到第 \d+ 章：補番紀錄$/);
    }
  });

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
    expect(hero).toContain("觀看時間");
    expect(hero).toMatch(/6\s*小時\s*6\s*分/);
    expect(hero).toContain("12集");
    // 幾天有看移到熱度圖旁，英雄磚不再重複；熱度圖本身不念 365 格，只念數字。
    expect(hero).not.toMatch(/365\s*天/);
    const calendar = findAll(root, (node) => hasClass(node, "ani-rc-calendar"))[0]!;
    expect(spokenText(calendar)).toMatch(/9\s*\/ 365 天/);
    expect(spokenText(calendar)).toContain("4 集上架最多的一天 · 7/4");
    expect(findAll(calendar, (node) => node.tagName === "BUTTON")).toHaveLength(1);
    expect(spokenText(tile("habit-clock"))).toContain("42%");
    expect(spokenText(tile("timeliness"))).toContain("3小時通常等待 · 75% 在 24 小時內");
    // 追番成績單：主數字、分母，以及每一類的部數都念得出來（比例條本身不念）。
    const completion = spokenText(tile("completion"));
    expect(completion).toContain("看完 · 從頭開始看的 2 部中");
    expect(completion).toMatch(/看完\s*1 部/);
    expect(completion).toMatch(/半途停下\s*1 部/);
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
