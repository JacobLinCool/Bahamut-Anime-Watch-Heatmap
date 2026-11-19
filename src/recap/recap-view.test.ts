import { describe, expect, it } from "vitest";
import type { RecapPresentationDeck } from "./recap-deck";
import {
  handleRecapStageNavigationKey,
  recapAnnouncement,
  recapCss
} from "./recap-view";

describe("recap playback keyboard isolation", () => {
  it.each([
    ["ArrowLeft", "previous"],
    ["ArrowRight", "next"]
  ] as const)("consumes %s and invokes %s", (key, expected) => {
    const event = keyboardEvent(key);
    const calls: string[] = [];
    expect(handleRecapStageNavigationKey(
      event,
      () => calls.push("previous"),
      () => calls.push("next")
    )).toBe(true);
    expect(event.prevented).toBe(true);
    expect(event.stopped).toBe(true);
    expect(calls).toEqual([expected]);
  });

  it("leaves modified and unrelated keys untouched", () => {
    const modified = keyboardEvent("ArrowRight", { shiftKey: true });
    expect(handleRecapStageNavigationKey(modified, () => undefined, () => undefined)).toBe(false);
    expect(modified.prevented).toBe(false);
    expect(modified.stopped).toBe(false);

    const unrelated = keyboardEvent("Enter");
    expect(handleRecapStageNavigationKey(unrelated, () => undefined, () => undefined)).toBe(false);
    expect(unrelated.prevented).toBe(false);
    expect(unrelated.stopped).toBe(false);
  });
});

describe("recap theater layout contract", () => {
  it("keeps chrome and controls fixed while only the current scene scrolls", () => {
    expect(recapCss).toMatch(/\.ani-rc-theater\s*\{[^}]*position:\s*relative;[^}]*overflow:\s*hidden;/);
    expect(recapCss).toMatch(
      /\.ani-rc-theater\[data-layout="playback"\]\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;/
    );
    expect(recapCss).toMatch(
      /\.ani-rc-theater\[data-layout="playback"\] \.ani-rc-scene\s*\{[^}]*overflow-y:\s*auto;/
    );
    expect(recapCss).toMatch(/\.ani-rc-chrome, \.ani-rc-controls\s*\{[^}]*position:\s*absolute;/);
    // 換場時新舊畫面疊在同一格，舊畫面不會把新畫面擠開。
    expect(recapCss).toMatch(/\.ani-rc-scene\s*\{[^}]*grid-area:\s*1 \/ 1;/);
  });

  it("paints backgrounds from vectors and a tiny canvas imprint, never from stretched cover images", () => {
    // 背景層裡沒有 <img>：imprint 是畫在極小 canvas 上、低透明度的一抹色。
    expect(recapCss).not.toMatch(/\.ani-rc-(?:field|imprint|grain|blob)[^{}]*\bimg\b/);
    expect(recapCss).not.toContain(".ani-recap-backdrop");
    const imprintOpacity = recapCss.match(/\.ani-rc-imprint-layer\[data-visible="true"\]\s*\{\s*opacity:\s*([\d.]+);/);
    expect(imprintOpacity).not.toBeNull();
    expect(Number(imprintOpacity?.[1])).toBeLessThanOrEqual(0.4);
    // 大面積背景不做（動畫中的）模糊濾鏡：光暈只靠漸層與 transform。
    expect(recapCss).not.toMatch(/\.ani-rc-(?:field|blob|imprint)[^{}]*\{[^}]*filter:\s*blur/);
    // 資料依據的全螢幕幕會淡入：不帶 backdrop blur，免得每一格都重算模糊。
    expect(recapCss).not.toMatch(/\.ani-recap-evidence-veil\s*\{[^}]*backdrop-filter/);
  });
});

describe("recap transition animation contract", () => {
  it("leaves choreography to the interruptible WAAPI choreographer, not CSS state attributes", () => {
    expect(recapCss).not.toContain("[data-transition");
    expect(recapCss).not.toMatch(/\.ani-recap-ghost(?!-button)/);
    expect(recapCss).not.toContain("data-ghost");
    // 只有常駐背景與 chrome 用 CSS transition；色調由註冊過的 custom property 內插。
    expect(recapCss).toMatch(/\.ani-rc-field\s*\{[^}]*transition:\s*--ani-rc-base/);
  });
});

describe("recap marathon layout contract", () => {
  it("keeps marathon facts on their own grid instead of borrowing summary classes", () => {
    expect(recapCss).toMatch(/\.ani-rc-marathon-facts\s*\{[^}]*display:\s*grid;/);
    expect(recapCss).not.toContain("ani-recap-outro");
    expect(recapCss).not.toContain("ani-recap-summary--start");
  });
});

describe("recap poster legibility", () => {
  it("never sets a fixed font size below 11px anywhere in the recap", () => {
    const sizes = [...recapCss.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1]));
    expect(sizes.length).toBeGreaterThan(20);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);
    const clampMinimums = [...recapCss.matchAll(/font-size:\s*clamp\(\s*([\d.]+)px/g)].map((match) => Number(match[1]));
    expect(Math.min(...clampMinimums)).toBeGreaterThanOrEqual(11);
  });

  it("clamps long work titles on the poster to two lines", () => {
    for (const selector of [".ani-rc-work-title", ".ani-rc-lead-title"]) {
      expect(recapCss).toMatch(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{[^}]*-webkit-line-clamp:\\s*2;`));
    }
  });
});

describe("recap announcements", () => {
  it("announces the chapter number and title, and the summary title", () => {
    const deck = {
      fingerprint: "f",
      scopeKey: "k",
      chapters: [{ id: "overview", title: "總覽" }, { id: "taste", title: "口味" }],
      summary: { title: "過去一年回顧" }
    } as unknown as RecapPresentationDeck;
    expect(recapAnnouncement({ kind: "recap-chapter", deck, chapterId: "taste", stale: false, direction: "forward" }))
      .toBe("第 2 章：口味");
    expect(recapAnnouncement({ kind: "recap-summary", deck, stale: false, direction: "forward" }))
      .toBe("回顧總結：過去一年回顧");
    expect(recapAnnouncement({ kind: "recap-intro" })).toBeNull();
  });
});

describe("recap taste ranking alignment", () => {
  it("reserves the meter row when a dimension intentionally omits bars", () => {
    expect(recapCss).toMatch(
      /\.ani-recap-taste-column li\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*auto 7px;/
    );
    expect(recapCss).toMatch(
      /\.ani-recap-taste-column li \.ani-recap-meter\s*\{[^}]*align-self:\s*end;[^}]*height:\s*3px;[^}]*margin-top:\s*0;/
    );
  });
});

describe("recap story title wrapping", () => {
  it("breaks Chinese headlines only between phrases and shrinks headlines that run long", () => {
    // keep-all 擋掉字與字之間的斷點，換行只發生在 recap-text 插入的 <wbr>。
    expect(recapCss).toMatch(/\.ani-rc-title, \.ani-rc-intro-title, \.ani-rc-poster-title\s*\{[^}]*word-break:\s*keep-all;/);
    expect(recapCss).toMatch(/\.ani-rc-nowrap\s*\{\s*white-space:\s*nowrap;/);
    expect(recapCss).toMatch(/\.ani-rc-title\[data-fit="1"\]\s*\{[^}]*font-size:/);
    expect(recapCss).toMatch(/\.ani-rc-title\[data-fit="2"\]\s*\{[^}]*font-size:/);
    for (const selector of [".ani-rc-work-title", ".ani-rc-lead-title"]) {
      expect(recapCss).toMatch(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{[^}]*word-break:\\s*keep-all;`));
    }
  });

  it("keeps an emphasized phrase together when it fits on the next line", () => {
    expect(recapCss).toMatch(
      /\.ani-recap-title-em\s*\{[^}]*display:\s*inline-block;[^}]*max-inline-size:\s*100%;[^}]*text-wrap:\s*balance;/
    );
  });
});

describe("recap forced-colors contract", () => {
  it("gives every chart bar a system color, not only the peak", () => {
    const forced = recapCss.slice(recapCss.indexOf("@media (forced-colors: active)")).replace(/\/\*[\s\S]*?\*\//g, "");
    const base = forced.match(/([^{}]+)\{\s*background:\s*CanvasText;\s*\}/)?.[1] ?? "";
    // 半透明的 color-mix 長條在強制色彩下會變成 Canvas：每一種長條都要列在這裡。
    for (const bar of [
      ".ani-rc-clock-bar",
      ".ani-rc-mini-bar",
      ".ani-rc-mini-bar[data-segment]",
      ".ani-rc-cal-day[data-level]:not([data-level=\"0\"])",
      ".ani-rc-weekday-bar",
      ".ani-rc-season-bar",
      ".ani-rc-mini-season-bar"
    ]) {
      expect(base.split(",").map((selector) => selector.trim())).toContain(bar);
    }
    expect(forced).toMatch(/\.ani-rc-mini-season\[data-leading="true"\] \.ani-rc-mini-season-bar[^{]*\{\s*background:\s*Highlight;/);
    expect(forced).toMatch(/\.ani-recap-primary-button\s*\{\s*border:\s*1px solid ButtonText;/);
  });
});

type TestKeyboardEvent = Pick<KeyboardEvent,
  "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "preventDefault" | "stopPropagation"
> & {
  prevented: boolean;
  stopped: boolean;
};

const keyboardEvent = (
  key: string,
  modifiers: Partial<Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">> = {}
): TestKeyboardEvent => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...modifiers,
  prevented: false,
  stopped: false,
  preventDefault() { this.prevented = true; },
  stopPropagation() { this.stopped = true; }
});
