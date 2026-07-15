export type RecapSurface = "dashboard" | "recap";

export type RecapChapter = {
  readonly id: string;
  readonly title: string;
};

export type RecapDeck<TChapter extends RecapChapter = RecapChapter> = {
  readonly fingerprint: string;
  readonly scopeKey: string;
  readonly chapters: readonly TChapter[];
};

export type RecapTransition =
  | { readonly phase: "idle" }
  | {
      readonly phase: "running";
      readonly direction: "forward" | "backward";
    };

export type ClosedRecapUiState = {
  readonly kind: "closed";
};

export type DashboardRecapUiState = {
  readonly kind: "dashboard";
};

export type RecapIntroUiState = {
  readonly kind: "recap-intro";
};

export type RecapChapterUiState<TDeck extends RecapDeck = RecapDeck> = {
  readonly kind: "recap-chapter";
  readonly deck: TDeck;
  readonly chapterId: string;
  readonly stale: boolean;
  readonly transition: RecapTransition;
};

export type RecapEvidenceUiState<TDeck extends RecapDeck = RecapDeck> = {
  readonly kind: "recap-evidence";
  readonly deck: TDeck;
  readonly chapterId: string;
  readonly stale: boolean;
};

export type RecapOutroUiState<TDeck extends RecapDeck = RecapDeck> = {
  readonly kind: "recap-outro";
  readonly deck: TDeck;
  readonly stale: boolean;
  readonly transition: RecapTransition;
};

export type RecapUiState<TDeck extends RecapDeck = RecapDeck> =
  | ClosedRecapUiState
  | DashboardRecapUiState
  | RecapIntroUiState
  | RecapChapterUiState<TDeck>
  | RecapEvidenceUiState<TDeck>
  | RecapOutroUiState<TDeck>;

export type RecapUiEvent<TDeck extends RecapDeck = RecapDeck> =
  | { readonly type: "OPEN"; readonly surface?: RecapSurface }
  | { readonly type: "CLOSE" }
  | { readonly type: "SWITCH_SURFACE"; readonly surface: RecapSurface }
  | { readonly type: "START_RECAP"; readonly deck: TDeck }
  | { readonly type: "NEXT" }
  | { readonly type: "PREVIOUS" }
  | { readonly type: "OPEN_EVIDENCE" }
  | { readonly type: "CLOSE_EVIDENCE" }
  | { readonly type: "RESTART" }
  | { readonly type: "DATA_UPDATED"; readonly fingerprint: string }
  | { readonly type: "ANIMATION_FINISHED" };

export const initialRecapUiState: ClosedRecapUiState = Object.freeze({ kind: "closed" });

const idleTransition: RecapTransition = Object.freeze({ phase: "idle" });

/**
 * Applies one UI event. Events that are not legal in the current state are a
 * deliberate no-op and return the exact same state object.
 */
export const reduceRecapUiState = <TDeck extends RecapDeck = RecapDeck>(
  state: RecapUiState<TDeck>,
  event: RecapUiEvent<TDeck>
): RecapUiState<TDeck> => {
  switch (event.type) {
    case "OPEN":
      if (state.kind !== "closed") return state;
      return event.surface === "recap" ? { kind: "recap-intro" } : { kind: "dashboard" };

    case "CLOSE":
      return state.kind === "closed" ? state : initialRecapUiState;

    case "SWITCH_SURFACE":
      if (state.kind === "closed") return state;
      if (event.surface === "dashboard") {
        return state.kind === "dashboard" ? state : { kind: "dashboard" };
      }
      return state.kind === "dashboard" ? { kind: "recap-intro" } : state;

    case "START_RECAP": {
      if (state.kind !== "recap-intro" || !isValidDeck(event.deck)) return state;
      const deck = snapshotDeck(event.deck);
      const firstChapter = deck.chapters[0];
      if (!firstChapter) return state;
      return {
        kind: "recap-chapter",
        deck,
        chapterId: firstChapter.id,
        stale: false,
        transition: runningTransition("forward")
      };
    }

    case "NEXT":
      return moveNext(state);

    case "PREVIOUS":
      return movePrevious(state);

    case "OPEN_EVIDENCE":
      if (state.kind !== "recap-chapter" || state.transition.phase !== "idle") return state;
      return {
        kind: "recap-evidence",
        deck: state.deck,
        chapterId: state.chapterId,
        stale: state.stale
      };

    case "CLOSE_EVIDENCE":
      if (state.kind !== "recap-evidence") return state;
      return {
        kind: "recap-chapter",
        deck: state.deck,
        chapterId: state.chapterId,
        stale: state.stale,
        transition: idleTransition
      };

    case "RESTART":
      return restart(state);

    case "DATA_UPDATED":
      return markDeckStale(state, event.fingerprint);

    case "ANIMATION_FINISHED":
      if (state.kind === "recap-chapter" && state.transition.phase === "running") {
        return { ...state, transition: idleTransition };
      }
      if (state.kind === "recap-outro" && state.transition.phase === "running") {
        return { ...state, transition: idleTransition };
      }
      return state;

    default:
      return assertNever(event);
  }
};

const moveNext = <TDeck extends RecapDeck>(state: RecapUiState<TDeck>): RecapUiState<TDeck> => {
  if (state.kind !== "recap-chapter" || state.transition.phase !== "idle") return state;
  const currentIndex = chapterIndex(state.deck, state.chapterId);
  if (currentIndex < 0) return state;
  const nextChapter = state.deck.chapters[currentIndex + 1];
  if (!nextChapter) {
    return {
      kind: "recap-outro",
      deck: state.deck,
      stale: state.stale,
      transition: runningTransition("forward")
    };
  }
  return {
    ...state,
    chapterId: nextChapter.id,
    transition: runningTransition("forward")
  };
};

const movePrevious = <TDeck extends RecapDeck>(state: RecapUiState<TDeck>): RecapUiState<TDeck> => {
  if (state.kind === "recap-outro") {
    if (state.transition.phase !== "idle") return state;
    const lastChapter = state.deck.chapters.at(-1);
    if (!lastChapter) return state;
    return {
      kind: "recap-chapter",
      deck: state.deck,
      chapterId: lastChapter.id,
      stale: state.stale,
      transition: runningTransition("backward")
    };
  }
  if (state.kind !== "recap-chapter" || state.transition.phase !== "idle") return state;
  const currentIndex = chapterIndex(state.deck, state.chapterId);
  if (currentIndex < 0) return state;
  if (currentIndex === 0) return { kind: "recap-intro" };
  const previousChapter = state.deck.chapters[currentIndex - 1];
  if (!previousChapter) return state;
  return {
    ...state,
    chapterId: previousChapter.id,
    transition: runningTransition("backward")
  };
};

const restart = <TDeck extends RecapDeck>(state: RecapUiState<TDeck>): RecapUiState<TDeck> => {
  if (
    state.kind !== "recap-chapter"
    && state.kind !== "recap-evidence"
    && state.kind !== "recap-outro"
  ) {
    return state;
  }
  const firstChapter = state.deck.chapters[0];
  if (!firstChapter) return state;
  return {
    kind: "recap-chapter",
    deck: state.deck,
    chapterId: firstChapter.id,
    stale: state.stale,
    transition: runningTransition("forward")
  };
};

const markDeckStale = <TDeck extends RecapDeck>(
  state: RecapUiState<TDeck>,
  fingerprint: string
): RecapUiState<TDeck> => {
  if (
    state.kind !== "recap-chapter"
    && state.kind !== "recap-evidence"
    && state.kind !== "recap-outro"
  ) {
    return state;
  }
  if (state.stale || fingerprint === state.deck.fingerprint) return state;
  return { ...state, stale: true };
};

const chapterIndex = (deck: RecapDeck, chapterId: string): number =>
  deck.chapters.findIndex((chapter) => chapter.id === chapterId);

const runningTransition = (direction: "forward" | "backward"): RecapTransition =>
  Object.freeze({ phase: "running", direction });

const isValidDeck = (deck: RecapDeck): boolean => {
  if (
    !isNonEmptyString(deck.fingerprint)
    || !isNonEmptyString(deck.scopeKey)
    || !Array.isArray(deck.chapters)
    || deck.chapters.length === 0
  ) {
    return false;
  }
  const ids = new Set<string>();
  for (const chapter of deck.chapters) {
    if (!isNonEmptyString(chapter.id) || !isNonEmptyString(chapter.title) || ids.has(chapter.id)) {
      return false;
    }
    ids.add(chapter.id);
  }
  return true;
};

const snapshotDeck = <TDeck extends RecapDeck>(deck: TDeck): TDeck => {
  const chapters = Object.freeze(deck.chapters.map((chapter) => Object.freeze({ ...chapter })));
  return Object.freeze({ ...deck, chapters }) as TDeck;
};

const isNonEmptyString = (value: string): boolean => value.trim().length > 0;

const assertNever = (value: never): never => {
  throw new Error(`未處理的 recap UI event：${JSON.stringify(value)}`);
};
