import { describe, expect, it } from "vitest";
import {
  clipInsetBetween,
  countUpFormatter,
  enterDelay,
  exitDelay,
  exitsAsLayer,
  flipDelta,
  flipTransform,
  isNoopFlip,
  RECAP_TIMING,
  travelOffsets
} from "./recap-motion";
import {
  RECAP_PALETTES,
  RECAP_REGISTERED_PROPERTIES,
  RECAP_TONES,
  recapPaletteCss,
  registerRecapProperties
} from "./recap-palette";

describe("FLIP math", () => {
  it("inverts the new rect back onto the old one from the top-left origin", () => {
    const first = { left: 100, top: 400, width: 132, height: 176 };
    const last = { left: 60, top: 180, width: 66, height: 88 };
    const delta = flipDelta(first, last);
    expect(delta).toEqual({ dx: 40, dy: 220, sx: 2, sy: 2 });
    expect(flipTransform(delta)).toBe("translate(40px, 220px) scale(2, 2)");
    expect(isNoopFlip(delta)).toBe(false);
  });

  it("treats sub-pixel moves as a no-op and guards against collapsed targets", () => {
    expect(isNoopFlip(flipDelta(
      { left: 10.2, top: 20.1, width: 100, height: 50 },
      { left: 10, top: 20, width: 100.2, height: 50 }
    ))).toBe(true);
    expect(flipDelta({ left: 0, top: 0, width: 10, height: 10 }, { left: 0, top: 0, width: 0, height: 0 }))
      .toMatchObject({ sx: 1, sy: 1 });
  });
});

describe("container transform clip", () => {
  it("clips the full-bleed theater down to the intro card and never goes negative", () => {
    const full = { left: 0, top: 0, width: 1440, height: 900 };
    const card = { left: 160, top: 154, width: 1120, height: 692 };
    expect(clipInsetBetween(full, card, 22)).toBe("inset(154px 160px 54px 160px round 22px)");
    expect(clipInsetBetween(card, full, 0)).toBe("inset(0px 0px 0px 0px round 0px)");
  });
});

describe("choreography timing", () => {
  it("overlaps exits and entrances inside the spec windows", () => {
    expect(RECAP_TIMING.exitDuration).toBeGreaterThanOrEqual(220);
    expect(RECAP_TIMING.exitDuration).toBeLessThanOrEqual(280);
    expect(RECAP_TIMING.enterDuration).toBeGreaterThanOrEqual(560);
    expect(RECAP_TIMING.enterDuration).toBeLessThanOrEqual(680);
    expect(RECAP_TIMING.enterStagger).toBeGreaterThanOrEqual(40);
    expect(RECAP_TIMING.enterStagger).toBeLessThanOrEqual(60);
    // 新畫面在舊畫面淡出途中就開始進場：不留空白，也不等它全部退完。
    expect(RECAP_TIMING.enterLead).toBeLessThan(RECAP_TIMING.exitDuration);
  });

  it("dips through the background under reduced motion instead of double-exposing two scenes", () => {
    // 舊畫面完全淡出後新畫面才開始淡入：任何一格都不會有兩張半透明的畫面疊在一起。
    expect(RECAP_TIMING.reducedLead).toBeGreaterThanOrEqual(RECAP_TIMING.reducedExit);
    expect(RECAP_TIMING.reducedExit).toBeLessThanOrEqual(120);
    // 整段仍是一個短短的淡入淡出（約 0.2 秒），不會變成慢吞吞的轉場。
    expect(RECAP_TIMING.reducedLead + RECAP_TIMING.reducedEnter).toBeGreaterThanOrEqual(160);
    expect(RECAP_TIMING.reducedLead + RECAP_TIMING.reducedEnter).toBeLessThanOrEqual(260);
  });

  it("starts the new chapter while the old one is still fading, and clears the stage faster for the summary", () => {
    expect(RECAP_TIMING.enterLead).toBeGreaterThanOrEqual(90);
    expect(RECAP_TIMING.enterLead).toBeLessThan(RECAP_TIMING.exitFade);
    expect(RECAP_TIMING.summaryExitFade).toBeLessThan(RECAP_TIMING.exitFade);
    expect(RECAP_TIMING.batonFade).toBeLessThan(RECAP_TIMING.flipDuration);
  });

  it("clears dense scenes as one layer before the new text arrives", () => {
    // 依「離開的」畫面判斷：開場與結尾海報整張淡出，一般章節逐件退場。
    expect(exitsAsLayer({ dataset: { rcExit: "layer" } })).toBe(true);
    expect(exitsAsLayer({ dataset: {} })).toBe(false);
    expect(exitsAsLayer(null)).toBe(false);
    // 新畫面的字在整層淡完之後才進來，任何一格都不會有兩層看得清的字疊在同一處。
    expect(RECAP_TIMING.layerEnterLead).toBeGreaterThanOrEqual(130);
    expect(RECAP_TIMING.layerEnterLead).toBeGreaterThan(RECAP_TIMING.summaryExitFade);
    expect(enterDelay(0, "story", RECAP_TIMING.layerEnterLead)).toBe(RECAP_TIMING.layerEnterLead);
    // 一般換場：最後一個零件也在新標題擦出前就開始淡出。
    expect(exitDelay(99)).toBeLessThan(RECAP_TIMING.enterLead);
  });

  it("caps staggers so long scenes still settle quickly", () => {
    expect(exitDelay(0)).toBe(0);
    expect(exitDelay(50)).toBe(RECAP_TIMING.exitStaggerCap * RECAP_TIMING.exitStagger);
    expect(enterDelay(0)).toBe(RECAP_TIMING.enterLead);
    expect(enterDelay(99)).toBe(enterDelay(RECAP_TIMING.enterStaggerCap));
    // 結尾海報的組裝：最後一塊磚不晚於 0.55 秒開始，約 1 秒內落定。
    expect(enterDelay(99, "assemble")).toBeLessThanOrEqual(550);
    expect(enterDelay(RECAP_TIMING.assembleStaggerCap, "assemble") + RECAP_TIMING.assembleDuration).toBeLessThanOrEqual(1010);
  });

  it("travels symmetrically: forward pushes content up, backward reverses it", () => {
    const forward = travelOffsets("forward");
    const backward = travelOffsets("backward");
    expect(forward.exit).toBeLessThan(0);
    expect(forward.enter).toBeGreaterThan(0);
    expect(backward).toEqual({ exit: -forward.exit, enter: -forward.enter });
  });

  it("formats count-up frames in the final value's format", () => {
    expect(countUpFormatter(undefined)(1234.4)).toBe("1,234");
    expect(countUpFormatter("decimal")(17.84)).toBe("17.8");
    expect(countUpFormatter("compact-duration")(61)).toBe("1 小時 1 分");
    expect(countUpFormatter("duration")(-3)).toBe("0 分鐘");
  });
});

describe("theater palette", () => {
  it("keeps every chapter's existing accent and a neutral summary", () => {
    expect(RECAP_TONES).toEqual(expect.arrayContaining([
      "intro", "overview", "season-breakdown", "habit-clock", "marathon", "runtime",
      "taste", "completion", "timeliness", "behavior-preference", "platform-taste", "summary"
    ]));
    expect(RECAP_PALETTES.overview.accent).toBe("#7dd3fc");
    expect(RECAP_PALETTES["season-breakdown"].accent).toBe("#5eead4");
    expect(RECAP_PALETTES["habit-clock"].accent).toBe("#a5b4fc");
    expect(RECAP_PALETTES.marathon.accent).toBe("#fda4af");
    expect(RECAP_PALETTES.runtime.accent).toBe("#c4b5fd");
    expect(RECAP_PALETTES.taste.accent).toBe("#f9a8d4");
    expect(RECAP_PALETTES.completion.accent).toBe("#bef264");
    expect(RECAP_PALETTES.timeliness.accent).toBe("#6ee7b7");
    expect(RECAP_PALETTES["behavior-preference"].accent).toBe("#fcd34d");
    expect(RECAP_PALETTES["platform-taste"].accent).toBe("#f0abfc");
    // 結尾回到低彩度，讓各磚自己的章節色說話。
    const chroma = (hex: string): number => {
      const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
      return Math.max(...channels) - Math.min(...channels);
    };
    expect(chroma(RECAP_PALETTES.summary.accent)).toBeLessThan(40);
    expect(chroma(RECAP_PALETTES.summary.base)).toBeLessThan(24);
    for (const tone of RECAP_TONES) {
      // 背景底色一律夠暗，前景淺色字維持對比。
      const base = RECAP_PALETTES[tone].base;
      expect(Math.max(...[1, 3, 5].map((index) => parseInt(base.slice(index, index + 2), 16)))).toBeLessThan(48);
    }
  });

  it("registers uniquely prefixed typed colors from JS and emits one rule per tone", () => {
    for (const definition of RECAP_REGISTERED_PROPERTIES) {
      expect(definition.name.startsWith("--ani-rc-")).toBe(true);
      expect(definition.syntax).toBe("<color>");
    }
    expect(() => registerRecapProperties()).not.toThrow();
    const css = recapPaletteCss();
    for (const tone of RECAP_TONES) {
      expect(css).toContain(`.ani-rc-field[data-tone="${tone}"]`);
    }
  });
});
