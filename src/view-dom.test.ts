import { describe, expect, it } from "vitest";
import { coverFallbackGlyph } from "./view-dom";

describe("cover fallback glyph", () => {
  it("keeps the dashboard's first-character fallback by default", () => {
    expect(coverFallbackGlyph("【我推的孩子】")).toBe("【");
    expect(coverFallbackGlyph("  葬送的芙莉蓮")).toBe("葬");
  });

  it("skips leading brackets and punctuation when the recap asks for a readable glyph", () => {
    expect(coverFallbackGlyph("【我推的孩子】", true)).toBe("我");
    expect(coverFallbackGlyph("《結緣甘神神社》", true)).toBe("結");
    expect(coverFallbackGlyph("「#ガチアクタ」", true)).toBe("ガ");
    // 整串都是符號時退回原本的第一個字，不留空白格。
    expect(coverFallbackGlyph("【】", true)).toBe("【");
    expect(coverFallbackGlyph("", true)).toBeUndefined();
  });
});
