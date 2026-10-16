import { describe, expect, it } from "vitest";
import { storyPhrases, tokenizeStoryTitle } from "./recap-text";

/** 片語之間才是換行點：檢查某兩個字之間不會被斷開。 */
const keepsTogether = (text: string, word: string): boolean => {
  const phrases = storyPhrases(text);
  expect(phrases.join("")).toBe(text);
  return phrases.some((phrase) => phrase.includes(word));
};

describe("CJK story title phrasing", () => {
  it("never breaks inside the words the old wrapping split", () => {
    expect(keepsTogether("你把 55 部作品完整追完", "作品")).toBe(true);
    expect(keepsTogether("最常出現在你的片單", "出現")).toBe(true);
    expect(keepsTogether("野生的大魔王出現了！", "大魔王")).toBe(true);
    expect(keepsTogether("最常按下播放的是週日。", "週日。")).toBe(true);
    expect(keepsTogether("複製品的我也會談戀愛", "複製品")).toBe(true);
    // 斷詞器切成「會談｜戀愛」：詞表擋住詞內的換行點。
    expect(keepsTogether("複製品的我也會談戀愛", "談戀愛")).toBe(true);
    expect(keepsTogether("在異世界轉生成為最強", "異世界")).toBe(true);
  });

  it("keeps punctuation attached to its neighbours", () => {
    for (const phrase of storyPhrases("《野生的大魔王出現了！》最先被你選中")) {
      expect(phrase).not.toMatch(/^[》！，。]/u);
      expect(phrase).not.toMatch(/《$/u);
    }
    expect(storyPhrases("有得選時，你最常先看")[0]).toBe("有得選時，");
  });

  it("still offers break points in long runs so headlines can wrap", () => {
    expect(storyPhrases("你最常看夏季上架的動畫").length).toBeGreaterThan(1);
    expect(storyPhrases("最猛的一天").length).toBeGreaterThanOrEqual(1);
  });

  it("splits quoted works and numerals out as emphasis", () => {
    expect(tokenizeStoryTitle("你把 55 部作品完整追完")).toEqual([
      { kind: "text", text: "你把 " },
      { kind: "em", text: "55", numeral: true },
      { kind: "text", text: " 部作品完整追完" }
    ]);
    expect(tokenizeStoryTitle("片長最長的是《結緣甘神神社》").at(-1)).toEqual({ kind: "em", text: "《結緣甘神神社》", numeral: false });
    // 時長整串是一個數字：註腳不會斷成「69 小時／43 分鐘」。
    expect(tokenizeStoryTitle("第 12 集，69 小時 43 分鐘。")).toEqual([
      { kind: "text", text: "第 " },
      { kind: "em", text: "12", numeral: true },
      { kind: "text", text: " 集，" },
      { kind: "em", text: "69 小時 43 分鐘", numeral: true },
      { kind: "text", text: "。" }
    ]);
  });
});
