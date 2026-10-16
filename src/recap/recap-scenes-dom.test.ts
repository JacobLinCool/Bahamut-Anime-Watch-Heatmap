import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnalyticsResult } from "../analytics";
import { buildRecapDeck, type RecapPresentationChapter } from "./recap-deck";
import { buildChapterScene, buildIntroScene, type RecapSceneContext } from "./recap-scenes";
import { FakeNode, findAll, hasClass, installFakeDocument } from "./recap-test-dom";
import { fullResult } from "./recap-test-fixtures";

let restoreDocument: () => void = () => undefined;

beforeEach(() => {
  restoreDocument = installFakeDocument();
});

afterEach(() => {
  restoreDocument();
});

const byClass = (root: FakeNode, name: string): FakeNode[] => findAll(root, (node) => hasClass(node, name));

describe("intro scene in-place updates", () => {
  const contextFor = (result: AnalyticsResult): RecapSceneContext => ({
    result,
    liveDeck: buildRecapDeck(result),
    stale: false,
    onStart: () => undefined,
    onDashboard: () => undefined
  });

  it("keeps the counting fact nodes when a data tick carries the same numbers", () => {
    const scene = buildIntroScene(contextFor(fullResult()));
    const root = scene.root as unknown as FakeNode;
    const facts = byClass(root, "ani-rc-intro-facts")[0]!;
    const before = [...facts.children];
    const countingBefore = findAll(facts, (node) => node.dataset.countTo !== undefined);
    expect(countingBefore.length).toBeGreaterThan(0);

    // 背景作品資料的 tick：同樣的數字、全新的物件。
    scene.update?.(contextFor(fullResult()));
    expect(facts.children).toEqual(before);
    facts.children.forEach((child, index) => expect(child).toBe(before[index]));
    expect(findAll(facts, (node) => node.dataset.countTo !== undefined)).toEqual(countingBefore);

    // 數字真的變了才換上新節點。
    const grown = fullResult();
    scene.update?.(contextFor({ ...grown, summary: { ...grown.summary, uniqueEpisodeCount: grown.summary.uniqueEpisodeCount + 3 } }));
    expect(facts.children[0]).not.toBe(before[0]);
    expect(facts.children[0]?.textContent).toContain(String(grown.summary.uniqueEpisodeCount + 3));
  });
});

describe("platform-taste chapter", () => {
  const row = (animeSn: number, personalWatchRank: number, platformRank: number) => ({
    animeSn,
    title: `作品 ${animeSn}`,
    coverUrl: null,
    personalWatchRank,
    personalWatchCount: 20 - personalWatchRank,
    platformRank,
    platformPopular: 1000 - platformRank,
    gap: platformRank - personalWatchRank
  });
  const chapter = (hiddenGemIndex: number | null): RecapPresentationChapter => {
    const rows = [row(1, 1, 2), row(2, 2, 1), row(3, 3, 90), row(4, 4, 5), row(5, 5, 6)];
    return {
      id: "platform-taste",
      kind: "platform-taste",
      title: "私藏",
      eyebrow: "和平台比一比",
      narrative: "",
      evidence: [],
      payload: { rows, hiddenGem: hiddenGemIndex === null ? null : rows[hiddenGemIndex]!, averageGap: 0 }
    };
  };
  const listed = (root: FakeNode): (string | undefined)[] =>
    byClass(root, "ani-rc-row").map((node) => byClass(node, "ani-rc-row-cover")[0]!.dataset.rcShared);
  const ranks = (root: FakeNode): string[] =>
    byClass(root, "ani-rc-row").map((node) => byClass(node, "ani-rc-row-rank")[0]!.textContent);
  const highlighted = (root: FakeNode): string[] =>
    byClass(root, "ani-rc-row").filter((node) => node.dataset.lead === "true")
      .map((node) => byClass(node, "ani-rc-row-title")[0]!.textContent);
  const lead = (root: FakeNode): string | undefined => byClass(root, "ani-rc-lead-cover")[0]?.dataset.rcShared;

  it("lists at most four rows without skipping a rank, like the other chapters", () => {
    // 私藏排第 3：照名次列前四名並標亮它，不會讀成 1、2、4、5；它的封面只由左欄當共享元素。
    const withGem = buildChapterScene(chapter(2)).root as unknown as FakeNode;
    expect(lead(withGem)).toBe("anime-3");
    expect(ranks(withGem)).toEqual(["1", "2", "3", "4"]);
    expect(listed(withGem)).toEqual(["anime-1", "anime-2", undefined, "anime-4"]);
    expect(highlighted(withGem)).toEqual(["作品 3"]);

    // 主角是第 1 名：和別章一樣從第 2 名接下去。
    const noGem = buildChapterScene(chapter(null)).root as unknown as FakeNode;
    expect(lead(noGem)).toBe("anime-1");
    expect(ranks(noGem)).toEqual(["2", "3", "4", "5"]);
    expect(listed(noGem)).toEqual(["anime-2", "anime-3", "anime-4", "anime-5"]);
    expect(highlighted(noGem)).toEqual([]);
  });
});
