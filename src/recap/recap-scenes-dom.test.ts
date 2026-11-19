import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnalyticsResult } from "../analytics";
import { buildRecapDeck, type RecapPresentationChapter } from "./recap-deck";
import { buildChapterScene, buildIntroScene, chapterCoverUrls, type RecapSceneContext } from "./recap-scenes";
import { FakeNode, findAll, hasClass, installFakeDocument } from "./recap-test-dom";
import { bingeResult, cover, fullResult } from "./recap-test-fixtures";

let restoreDocument: () => void = () => undefined;

beforeEach(() => {
  restoreDocument = installFakeDocument();
});

afterEach(() => {
  restoreDocument();
});

const byClass = (root: FakeNode, name: string): FakeNode[] => findAll(root, (node) => hasClass(node, name));

describe("binge chapter", () => {
  it("uses daily episode rate as the hero and ranking metric without duration headlines", () => {
    const chapter = buildRecapDeck(bingeResult()).chapters.find((item) => item.kind === "binge")!;
    const scene = buildChapterScene(chapter);
    const root = scene.root as unknown as FakeNode;
    expect(root.textContent).toContain("補番紀錄");
    expect(root.textContent).toContain("補番作品 A");
    expect(root.textContent).toContain("補番作品 B");
    expect(root.textContent).toContain("2.4 集／日");
    expect(root.textContent).toContain("平均 3 集／日");
    expect(root.textContent).not.toMatch(/12 集|24 集|4 天|7 天|耗時|最快的一部|proxy|集中收尾|最後四集|168|官方資料/);
    expect(byClass(root, "ani-rc-row")).toHaveLength(1);
    expect(scene.imprintUrl).toBe(cover("binge-b"));
    expect(chapterCoverUrls(chapter)).toEqual([cover("binge-b"), cover("binge-a")]);
  });
});

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
  const gem = (animeSn: number, popularityRank: number) => ({
    animeSn,
    title: `作品 ${animeSn}`,
    coverUrl: null,
    cohortYear: 2026,
    cohortSeason: "summer" as const,
    cohortSize: 20,
    popularityRank,
    cohortLeaderTitle: "大作",
    popularityRatio: 0.2,
    cohortLabel: "2026 夏季"
  });
  const chapter = (gems: ReturnType<typeof gem>[]): RecapPresentationChapter => ({
    id: "platform-taste",
    kind: "platform-taste",
    title: "私藏",
    eyebrow: "你的私藏",
    narrative: "",
    evidence: [],
    payload: { gems }
  });
  const listed = (root: FakeNode): (string | undefined)[] =>
    byClass(root, "ani-rc-row").map((node) => byClass(node, "ani-rc-row-cover")[0]!.dataset.rcShared);
  const lead = (root: FakeNode): string | undefined => byClass(root, "ani-rc-lead-cover")[0]?.dataset.rcShared;

  it("leads with the coldest favorite and lists a second gem by its popularity rank", () => {
    const one = buildChapterScene(chapter([gem(3, 15)])).root as unknown as FakeNode;
    expect(lead(one)).toBe("anime-3");
    expect(listed(one)).toEqual([]);
    expect(one.textContent).toContain("2026 夏季開播、你也看過的 20 部作品裡");
    expect(one.textContent).toContain("大作");

    const two = buildChapterScene(chapter([gem(3, 15), gem(4, 18)])).root as unknown as FakeNode;
    expect(lead(two)).toBe("anime-3");
    expect(listed(two)).toEqual(["anime-4"]);
  });
});
