import { describe, expect, it } from "vitest";
import {
  initialRecapUiState,
  reduceRecapUiState,
  type RecapDeck,
  type RecapUiEvent,
  type RecapUiState
} from "./recap-state";

const deck = (fingerprint = "dataset-1"): RecapDeck => ({
  fingerprint,
  scopeKey: "release:2026:year",
  chapters: [
    { id: "summary", title: "年度總覽" },
    { id: "preference", title: "最期待作品" }
  ]
});

const threeChapterDeck = (): RecapDeck => ({
  fingerprint: "dataset-3",
  scopeKey: "watched:rolling:365",
  chapters: [
    { id: "overview", title: "總覽" },
    { id: "habit-clock", title: "時鐘" },
    { id: "marathon", title: "馬拉松" }
  ]
});

const dispatch = (state: RecapUiState, ...events: readonly RecapUiEvent[]): RecapUiState =>
  events.reduce(reduceRecapUiState, state);

const playing = (source: RecapDeck = deck()): RecapUiState => dispatch(
  initialRecapUiState,
  { type: "OPEN", surface: "recap" },
  { type: "START_RECAP", deck: source }
);

describe("recap UI lifecycle", () => {
  it("opens dashboard by default and supports an explicit recap entry", () => {
    expect(reduceRecapUiState(initialRecapUiState, { type: "OPEN" })).toEqual({ kind: "dashboard" });
    expect(reduceRecapUiState(initialRecapUiState, { type: "OPEN", surface: "recap" })).toEqual({
      kind: "recap-intro"
    });
  });

  it("switches surfaces and CLOSE gives Escape a single transition to closed", () => {
    const dashboard = reduceRecapUiState(initialRecapUiState, { type: "OPEN" });
    const intro = reduceRecapUiState(dashboard, { type: "SWITCH_SURFACE", surface: "recap" });
    expect(intro).toEqual({ kind: "recap-intro" });
    expect(reduceRecapUiState(intro, { type: "SWITCH_SURFACE", surface: "dashboard" })).toEqual({
      kind: "dashboard"
    });
    expect(reduceRecapUiState(intro, { type: "CLOSE" })).toBe(initialRecapUiState);
  });
});

describe("frozen recap deck", () => {
  it("snapshots the deck and navigates by stable chapter id", () => {
    const source = {
      fingerprint: "dataset-1",
      scopeKey: "release:2026:summer",
      chapters: [
        { id: "summary", title: "季度總覽" },
        { id: "rhythm", title: "觀看節奏" }
      ]
    };
    const state = dispatch(
      initialRecapUiState,
      { type: "OPEN", surface: "recap" },
      { type: "START_RECAP", deck: source }
    );
    expect(state.kind).toBe("recap-chapter");
    if (state.kind !== "recap-chapter") throw new Error("expected recap chapter");

    source.fingerprint = "mutated";
    source.chapters[0]!.id = "mutated";
    source.chapters.push({ id: "late", title: "後加章節" });

    expect(state.deck.fingerprint).toBe("dataset-1");
    expect(state.deck.chapters.map((chapter) => chapter.id)).toEqual(["summary", "rhythm"]);
    expect(state.chapterId).toBe("summary");
    expect(Object.isFrozen(state.deck)).toBe(true);
    expect(Object.isFrozen(state.deck.chapters)).toBe(true);
    expect(Object.isFrozen(state.deck.chapters[0])).toBe(true);
  });

  it("rejects empty or duplicate-id decks as the same no-op state", () => {
    const intro = reduceRecapUiState(initialRecapUiState, { type: "OPEN", surface: "recap" });
    const empty: RecapDeck = { fingerprint: "x", scopeKey: "scope", chapters: [] };
    const duplicate: RecapDeck = {
      fingerprint: "x",
      scopeKey: "scope",
      chapters: [{ id: "same", title: "A" }, { id: "same", title: "B" }]
    };
    expect(reduceRecapUiState(intro, { type: "START_RECAP", deck: empty })).toBe(intro);
    expect(reduceRecapUiState(intro, { type: "START_RECAP", deck: duplicate })).toBe(intro);
  });
});

describe("chapter navigation", () => {
  // 換場可被打斷：狀態機不再等待動畫結束，連按會立刻改道到下一個目標。
  it("accepts NEXT and PREVIOUS immediately, even while the previous swap is still animating", () => {
    const started = playing(threeChapterDeck());
    expect(started).toMatchObject({ kind: "recap-chapter", chapterId: "overview", direction: "forward" });

    const second = reduceRecapUiState(started, { type: "NEXT" });
    expect(second).toMatchObject({ kind: "recap-chapter", chapterId: "habit-clock", direction: "forward" });

    const third = reduceRecapUiState(second, { type: "NEXT" });
    expect(third).toMatchObject({ kind: "recap-chapter", chapterId: "marathon", direction: "forward" });

    const back = reduceRecapUiState(third, { type: "PREVIOUS" });
    expect(back).toMatchObject({ kind: "recap-chapter", chapterId: "habit-clock", direction: "backward" });
  });

  it("moves between intro, chapters, and summary without changing the deck", () => {
    const first = playing();
    expect(reduceRecapUiState(first, { type: "PREVIOUS" })).toEqual({ kind: "recap-intro" });

    const second = reduceRecapUiState(first, { type: "NEXT" });
    const summary = reduceRecapUiState(second, { type: "NEXT" });
    expect(summary).toMatchObject({ kind: "recap-summary", direction: "forward" });
    if (summary.kind !== "recap-summary" || second.kind !== "recap-chapter") {
      throw new Error("expected summary and chapter");
    }
    expect(summary.deck).toBe(second.deck);
    // 結尾不再往後；連按 → 也不會意外從頭重播。
    expect(reduceRecapUiState(summary, { type: "NEXT" })).toBe(summary);

    const last = reduceRecapUiState(summary, { type: "PREVIOUS" });
    expect(last).toMatchObject({
      kind: "recap-chapter",
      chapterId: "preference",
      direction: "backward"
    });
  });
});

describe("jumping to a chapter", () => {
  it("jumps from the summary back to any chapter, travelling backward", () => {
    const summary = dispatch(playing(threeChapterDeck()), { type: "NEXT" }, { type: "NEXT" }, { type: "NEXT" });
    expect(summary.kind).toBe("recap-summary");
    const jumped = reduceRecapUiState(summary, { type: "GOTO_CHAPTER", chapterId: "habit-clock" });
    expect(jumped).toMatchObject({ kind: "recap-chapter", chapterId: "habit-clock", direction: "backward" });
    if (jumped.kind !== "recap-chapter" || summary.kind !== "recap-summary") throw new Error("expected chapter");
    expect(jumped.deck).toBe(summary.deck);
  });

  it("derives the direction from chapter order when jumping between chapters", () => {
    const first = playing(threeChapterDeck());
    const ahead = reduceRecapUiState(first, { type: "GOTO_CHAPTER", chapterId: "marathon" });
    expect(ahead).toMatchObject({ chapterId: "marathon", direction: "forward" });
    const behind = reduceRecapUiState(ahead, { type: "GOTO_CHAPTER", chapterId: "overview" });
    expect(behind).toMatchObject({ chapterId: "overview", direction: "backward" });
  });

  it("ignores unknown ids, the current chapter, and jumps outside playback", () => {
    const first = playing(threeChapterDeck());
    expect(reduceRecapUiState(first, { type: "GOTO_CHAPTER", chapterId: "missing" })).toBe(first);
    expect(reduceRecapUiState(first, { type: "GOTO_CHAPTER", chapterId: "overview" })).toBe(first);
    const evidence = reduceRecapUiState(first, { type: "OPEN_EVIDENCE" });
    expect(reduceRecapUiState(evidence, { type: "GOTO_CHAPTER", chapterId: "marathon" })).toBe(evidence);
    const intro = reduceRecapUiState(initialRecapUiState, { type: "OPEN", surface: "recap" });
    expect(reduceRecapUiState(intro, { type: "GOTO_CHAPTER", chapterId: "overview" })).toBe(intro);
  });
});

describe("evidence and restart", () => {
  it("opens evidence right away and returns to that chapter", () => {
    const started = playing();
    const evidence = reduceRecapUiState(started, { type: "OPEN_EVIDENCE" });
    expect(evidence).toMatchObject({ kind: "recap-evidence", chapterId: "summary" });
    expect(reduceRecapUiState(evidence, { type: "NEXT" })).toBe(evidence);
    expect(reduceRecapUiState(evidence, { type: "PREVIOUS" })).toBe(evidence);
    expect(reduceRecapUiState(evidence, { type: "OPEN_EVIDENCE" })).toBe(evidence);
    expect(reduceRecapUiState(evidence, { type: "CLOSE_EVIDENCE" })).toMatchObject({
      kind: "recap-chapter",
      chapterId: "summary"
    });
  });

  it("restarts the same frozen deck from chapter one, from a chapter or from the summary", () => {
    const second = dispatch(
      playing(),
      { type: "NEXT" },
      { type: "DATA_UPDATED", fingerprint: "dataset-2" }
    );
    const restarted = reduceRecapUiState(second, { type: "RESTART" });
    expect(restarted).toMatchObject({
      kind: "recap-chapter",
      chapterId: "summary",
      stale: true,
      direction: "forward"
    });
    if (second.kind !== "recap-chapter" || restarted.kind !== "recap-chapter") {
      throw new Error("expected recap chapters");
    }
    expect(restarted.deck).toBe(second.deck);

    const fromSummary = reduceRecapUiState(reduceRecapUiState(second, { type: "NEXT" }), { type: "RESTART" });
    expect(fromSummary).toMatchObject({ kind: "recap-chapter", chapterId: "summary", stale: true });
  });
  it("restarts with the latest deck for the same period, which clears stale", () => {
    const stale = dispatch(
      playing(),
      { type: "NEXT" },
      { type: "DATA_UPDATED", fingerprint: "dataset-2" }
    );
    const latest = deck("dataset-2");
    const restarted = reduceRecapUiState(stale, { type: "RESTART", deck: latest });
    expect(restarted).toMatchObject({ kind: "recap-chapter", chapterId: "summary", stale: false });
    if (restarted.kind !== "recap-chapter") throw new Error("expected a recap chapter");
    expect(restarted.deck.fingerprint).toBe("dataset-2");
    expect(restarted.deck).not.toBe(latest);
    expect(Object.isFrozen(restarted.deck)).toBe(true);
    // 之後同一份資料的 tick 不會再標成 stale。
    expect(reduceRecapUiState(restarted, { type: "DATA_UPDATED", fingerprint: "dataset-2" })).toBe(restarted);

    // 期間不同或 deck 無效時，重播凍結的那一份並保留 stale。
    const otherPeriod = { ...deck("dataset-3"), scopeKey: "watched:rolling:30" };
    const kept = reduceRecapUiState(stale, { type: "RESTART", deck: otherPeriod });
    expect(kept).toMatchObject({ kind: "recap-chapter", stale: true });
    if (kept.kind !== "recap-chapter" || stale.kind !== "recap-chapter") throw new Error("expected recap chapters");
    expect(kept.deck).toBe(stale.deck);
    const empty = { ...deck("dataset-4"), chapters: [] };
    const keptEmpty = reduceRecapUiState(stale, { type: "RESTART", deck: empty });
    if (keptEmpty.kind !== "recap-chapter") throw new Error("expected a recap chapter");
    expect(keptEmpty.deck).toBe(stale.deck);
  });
});

describe("data updates", () => {
  it("marks a playing deck stale without replacing it or changing its chapter", () => {
    const first = playing();
    const same = reduceRecapUiState(first, { type: "DATA_UPDATED", fingerprint: "dataset-1" });
    expect(same).toBe(first);

    const stale = reduceRecapUiState(first, { type: "DATA_UPDATED", fingerprint: "dataset-2" });
    expect(stale).toMatchObject({ kind: "recap-chapter", chapterId: "summary", stale: true });
    if (first.kind !== "recap-chapter" || stale.kind !== "recap-chapter") {
      throw new Error("expected recap chapters");
    }
    expect(stale.deck).toBe(first.deck);
    expect(reduceRecapUiState(stale, { type: "DATA_UPDATED", fingerprint: "dataset-3" })).toBe(stale);
  });

  it("preserves stale across evidence and the summary", () => {
    const evidence = dispatch(
      playing(),
      { type: "OPEN_EVIDENCE" },
      { type: "DATA_UPDATED", fingerprint: "dataset-2" }
    );
    expect(evidence).toMatchObject({ kind: "recap-evidence", stale: true });

    const summary = dispatch(
      evidence,
      { type: "CLOSE_EVIDENCE" },
      { type: "NEXT" },
      { type: "NEXT" }
    );
    expect(summary).toMatchObject({ kind: "recap-summary", stale: true });
  });
});

describe("illegal transitions", () => {
  it("consistently returns the exact same state object", () => {
    const dashboard = reduceRecapUiState(initialRecapUiState, { type: "OPEN" });
    for (const event of [
      { type: "OPEN" },
      { type: "NEXT" },
      { type: "PREVIOUS" },
      { type: "GOTO_CHAPTER", chapterId: "summary" },
      { type: "OPEN_EVIDENCE" },
      { type: "CLOSE_EVIDENCE" },
      { type: "RESTART" },
      { type: "DATA_UPDATED", fingerprint: "new" }
    ] as const satisfies readonly RecapUiEvent[]) {
      expect(reduceRecapUiState(dashboard, event)).toBe(dashboard);
    }
    expect(reduceRecapUiState(initialRecapUiState, {
      type: "SWITCH_SURFACE",
      surface: "recap"
    })).toBe(initialRecapUiState);
  });
});
