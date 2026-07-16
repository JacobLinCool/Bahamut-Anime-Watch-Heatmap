import { describe, expect, it } from "vitest";
import {
  handleRecapStageNavigationKey,
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

describe("recap mobile overflow contract", () => {
  it("keeps chrome and actions fixed while only chapter content scrolls", () => {
    expect(recapCss).toMatch(
      /\.ani-recap-stage\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/
    );
    expect(recapCss).toMatch(
      /\.ani-recap-chapter-content\s*\{[^}]*align-self:\s*stretch;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/
    );
    expect(recapCss).toMatch(/\.ani-recap-intro, \.ani-recap-stage\s*\{[^}]*overflow:\s*hidden;/);
  });

  it("uses vector CSS backdrops instead of stretching cover images", () => {
    expect(recapCss).not.toContain(".ani-recap-backdrop img");
    expect(recapCss).toMatch(/\.ani-recap-backdrop::before/);
  });
});

describe("recap transition animation contract", () => {
  it("never applies transition-only styles to the idle stage", () => {
    expect(recapCss).not.toMatch(/\.ani-recap-stage\[data-transition\](?!\s*=)/);
    expect(recapCss).toContain(
      '.ani-recap-stage:is([data-transition="forward"], [data-transition="backward"])'
    );
  });
});

describe("recap marathon layout contract", () => {
  it("stretches the supporting facts across the full visual column", () => {
    expect(recapCss).toMatch(
      /\.ani-recap-marathon-facts\s*\{[^}]*width:\s*100%;[^}]*margin-top:\s*0;/
    );
    expect(recapCss).toMatch(
      /\.ani-recap-marathon-facts\s*>\s*\.ani-recap-outro-fact\s*\{[^}]*flex:\s*1 1 0;/
    );
    expect(recapCss).not.toContain("ani-recap-summary--start");
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
  it("keeps an emphasized phrase together when it fits on the next line", () => {
    expect(recapCss).toMatch(
      /\.ani-recap-title-em\s*\{[^}]*display:\s*inline-block;[^}]*max-inline-size:\s*100%;[^}]*text-wrap:\s*balance;/
    );
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
