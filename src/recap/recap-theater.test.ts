import { describe, expect, it } from "vitest";
import { recapZoneClickAction } from "./recap-theater";

describe("recap click zones", () => {
  it("waits on a text click so a double-click can select instead of changing the chapter", () => {
    // 雙擊選字：第一下落在文字上先延後，第二下（detail = 2）取消它，不會先跳到下一章。
    expect(recapZoneClickAction({ detail: 1, onText: true, hasSelection: false })).toBe("defer");
    expect(recapZoneClickAction({ detail: 2, onText: true, hasSelection: false })).toBe("ignore");
    expect(recapZoneClickAction({ detail: 3, onText: true, hasSelection: false })).toBe("ignore");
  });

  it("changes chapter at once on empty space, even when clicking quickly", () => {
    expect(recapZoneClickAction({ detail: 1, onText: false, hasSelection: false })).toBe("navigate");
    expect(recapZoneClickAction({ detail: 2, onText: false, hasSelection: false })).toBe("navigate");
  });

  it("never changes chapter while text is selected", () => {
    expect(recapZoneClickAction({ detail: 1, onText: false, hasSelection: true })).toBe("ignore");
    expect(recapZoneClickAction({ detail: 1, onText: true, hasSelection: true })).toBe("ignore");
  });
});
