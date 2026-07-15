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

const dispatch = (state: RecapUiState, ...events: readonly RecapUiEvent[]): RecapUiState =>
  events.reduce(reduceRecapUiState, state);

const playing = (): RecapUiState => dispatch(
  initialRecapUiState,
  { type: "OPEN", surface: "recap" },
  { type: "START_RECAP", deck: deck() }
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
  it("waits for animation completion before accepting another navigation", () => {
    const started = playing();
    expect(started.kind).toBe("recap-chapter");
    expect(reduceRecapUiState(started, { type: "NEXT" })).toBe(started);

    const idle = reduceRecapUiState(started, { type: "ANIMATION_FINISHED" });
    const second = reduceRecapUiState(idle, { type: "NEXT" });
    expect(second).toMatchObject({
      kind: "recap-chapter",
      chapterId: "preference",
      transition: { phase: "running", direction: "forward" }
    });

    const back = dispatch(second, { type: "ANIMATION_FINISHED" }, { type: "PREVIOUS" });
    expect(back).toMatchObject({
      kind: "recap-chapter",
      chapterId: "summary",
      transition: { phase: "running", direction: "backward" }
    });
  });

  it("moves between intro, chapters, and outro without changing the deck", () => {
    const firstIdle = dispatch(playing(), { type: "ANIMATION_FINISHED" });
    expect(reduceRecapUiState(firstIdle, { type: "PREVIOUS" })).toEqual({ kind: "recap-intro" });

    const secondIdle = dispatch(firstIdle, { type: "NEXT" }, { type: "ANIMATION_FINISHED" });
    const outro = reduceRecapUiState(secondIdle, { type: "NEXT" });
    expect(outro).toMatchObject({
      kind: "recap-outro",
      transition: { phase: "running", direction: "forward" }
    });
    if (outro.kind !== "recap-outro" || secondIdle.kind !== "recap-chapter") {
      throw new Error("expected outro and chapter");
    }
    expect(outro.deck).toBe(secondIdle.deck);

    const last = dispatch(outro, { type: "ANIMATION_FINISHED" }, { type: "PREVIOUS" });
    expect(last).toMatchObject({
      kind: "recap-chapter",
      chapterId: "preference",
      transition: { phase: "running", direction: "backward" }
    });
  });
});

describe("evidence and restart", () => {
  it("opens evidence only from an idle chapter and returns to that chapter", () => {
    const started = playing();
    expect(reduceRecapUiState(started, { type: "OPEN_EVIDENCE" })).toBe(started);
    const idle = reduceRecapUiState(started, { type: "ANIMATION_FINISHED" });
    const evidence = reduceRecapUiState(idle, { type: "OPEN_EVIDENCE" });
    expect(evidence).toMatchObject({ kind: "recap-evidence", chapterId: "summary" });
    expect(reduceRecapUiState(evidence, { type: "NEXT" })).toBe(evidence);
    expect(reduceRecapUiState(evidence, { type: "CLOSE_EVIDENCE" })).toMatchObject({
      kind: "recap-chapter",
      chapterId: "summary",
      transition: { phase: "idle" }
    });
  });

  it("restarts the same frozen deck from chapter one", () => {
    const second = dispatch(
      playing(),
      { type: "ANIMATION_FINISHED" },
      { type: "NEXT" },
      { type: "ANIMATION_FINISHED" },
      { type: "DATA_UPDATED", fingerprint: "dataset-2" }
    );
    const restarted = reduceRecapUiState(second, { type: "RESTART" });
    expect(restarted).toMatchObject({
      kind: "recap-chapter",
      chapterId: "summary",
      stale: true,
      transition: { phase: "running", direction: "forward" }
    });
    if (second.kind !== "recap-chapter" || restarted.kind !== "recap-chapter") {
      throw new Error("expected recap chapters");
    }
    expect(restarted.deck).toBe(second.deck);
  });
});

describe("data updates", () => {
  it("marks a playing deck stale without replacing it or changing its chapter", () => {
    const idle = dispatch(playing(), { type: "ANIMATION_FINISHED" });
    const same = reduceRecapUiState(idle, { type: "DATA_UPDATED", fingerprint: "dataset-1" });
    expect(same).toBe(idle);

    const stale = reduceRecapUiState(idle, { type: "DATA_UPDATED", fingerprint: "dataset-2" });
    expect(stale).toMatchObject({ kind: "recap-chapter", chapterId: "summary", stale: true });
    if (idle.kind !== "recap-chapter" || stale.kind !== "recap-chapter") {
      throw new Error("expected recap chapters");
    }
    expect(stale.deck).toBe(idle.deck);
    expect(reduceRecapUiState(stale, { type: "DATA_UPDATED", fingerprint: "dataset-3" })).toBe(stale);
  });

  it("preserves stale across evidence and outro", () => {
    const evidence = dispatch(
      playing(),
      { type: "ANIMATION_FINISHED" },
      { type: "OPEN_EVIDENCE" },
      { type: "DATA_UPDATED", fingerprint: "dataset-2" }
    );
    expect(evidence).toMatchObject({ kind: "recap-evidence", stale: true });

    const outro = dispatch(
      evidence,
      { type: "CLOSE_EVIDENCE" },
      { type: "NEXT" },
      { type: "ANIMATION_FINISHED" },
      { type: "NEXT" }
    );
    expect(outro).toMatchObject({ kind: "recap-outro", stale: true });
  });
});

describe("illegal transitions", () => {
  it("consistently returns the exact same state object", () => {
    const dashboard = reduceRecapUiState(initialRecapUiState, { type: "OPEN" });
    for (const event of [
      { type: "OPEN" },
      { type: "NEXT" },
      { type: "PREVIOUS" },
      { type: "OPEN_EVIDENCE" },
      { type: "CLOSE_EVIDENCE" },
      { type: "RESTART" },
      { type: "DATA_UPDATED", fingerprint: "new" },
      { type: "ANIMATION_FINISHED" }
    ] as const satisfies readonly RecapUiEvent[]) {
      expect(reduceRecapUiState(dashboard, event)).toBe(dashboard);
    }
    expect(reduceRecapUiState(initialRecapUiState, {
      type: "SWITCH_SURFACE",
      surface: "recap"
    })).toBe(initialRecapUiState);
  });
});
