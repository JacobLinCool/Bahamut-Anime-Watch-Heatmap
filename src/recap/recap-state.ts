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

/**
 * 抵達目前畫面的方向：只決定換場往哪裡推，不再是「動畫進行中」的閘門。
 * 換場隨時可被下一個操作打斷並重新導向，狀態機因此不需要等待動畫結束。
 */
export type RecapDirection = "forward" | "backward";

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
  readonly direction: RecapDirection;
};

export type RecapEvidenceUiState<TDeck extends RecapDeck = RecapDeck> = {
  readonly kind: "recap-evidence";
  readonly deck: TDeck;
  readonly chapterId: string;
  readonly stale: boolean;
};

export type RecapSummaryUiState<TDeck extends RecapDeck = RecapDeck> = {
  readonly kind: "recap-summary";
  readonly deck: TDeck;
  readonly stale: boolean;
  readonly direction: RecapDirection;
};

export type RecapUiState<TDeck extends RecapDeck = RecapDeck> =
  | ClosedRecapUiState
  | DashboardRecapUiState
  | RecapIntroUiState
  | RecapChapterUiState<TDeck>
  | RecapEvidenceUiState<TDeck>
  | RecapSummaryUiState<TDeck>;

export type RecapUiEvent<TDeck extends RecapDeck = RecapDeck> =
  | { readonly type: "OPEN"; readonly surface?: RecapSurface }
  | { readonly type: "CLOSE" }
  | { readonly type: "SWITCH_SURFACE"; readonly surface: RecapSurface }
  | { readonly type: "START_RECAP"; readonly deck: TDeck }
  | { readonly type: "NEXT" }
  | { readonly type: "PREVIOUS" }
  | { readonly type: "GOTO_CHAPTER"; readonly chapterId: string }
  | { readonly type: "OPEN_EVIDENCE" }
  | { readonly type: "CLOSE_EVIDENCE" }
  /** With `deck` (built from the latest data for the same period), the replay shows it and is no longer stale. */
  | { readonly type: "RESTART"; readonly deck?: TDeck }
  | { readonly type: "DATA_UPDATED"; readonly fingerprint: string };

export const initialRecapUiState: ClosedRecapUiState = Object.freeze({ kind: "closed" });

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
        direction: "forward"
      };
    }

    case "NEXT":
      return moveNext(state);

    case "PREVIOUS":
      return movePrevious(state);

    case "GOTO_CHAPTER":
      return gotoChapter(state, event.chapterId);

    case "OPEN_EVIDENCE":
      if (state.kind !== "recap-chapter") return state;
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
        direction: "forward"
      };

    case "RESTART":
      return restart(state, event.deck);

    case "DATA_UPDATED":
      return markDeckStale(state, event.fingerprint);

    default:
      return assertNever(event);
  }
};

const moveNext = <TDeck extends RecapDeck>(state: RecapUiState<TDeck>): RecapUiState<TDeck> => {
  if (state.kind !== "recap-chapter") return state;
  const currentIndex = chapterIndex(state.deck, state.chapterId);
  if (currentIndex < 0) return state;
  const nextChapter = state.deck.chapters[currentIndex + 1];
  if (!nextChapter) {
    return {
      kind: "recap-summary",
      deck: state.deck,
      stale: state.stale,
      direction: "forward"
    };
  }
  return { ...state, chapterId: nextChapter.id, direction: "forward" };
};

const movePrevious = <TDeck extends RecapDeck>(state: RecapUiState<TDeck>): RecapUiState<TDeck> => {
  if (state.kind === "recap-summary") {
    const lastChapter = state.deck.chapters.at(-1);
    if (!lastChapter) return state;
    return {
      kind: "recap-chapter",
      deck: state.deck,
      chapterId: lastChapter.id,
      stale: state.stale,
      direction: "backward"
    };
  }
  if (state.kind !== "recap-chapter") return state;
  const currentIndex = chapterIndex(state.deck, state.chapterId);
  if (currentIndex < 0) return state;
  if (currentIndex === 0) return { kind: "recap-intro" };
  const previousChapter = state.deck.chapters[currentIndex - 1];
  if (!previousChapter) return state;
  return { ...state, chapterId: previousChapter.id, direction: "backward" };
};

/** 從進度條或總結磚跳回任一章；方向依章節先後決定，維持同一條空間軸。 */
const gotoChapter = <TDeck extends RecapDeck>(
  state: RecapUiState<TDeck>,
  chapterId: string
): RecapUiState<TDeck> => {
  if (state.kind !== "recap-chapter" && state.kind !== "recap-summary") return state;
  const targetIndex = chapterIndex(state.deck, chapterId);
  if (targetIndex < 0) return state;
  if (state.kind === "recap-chapter") {
    const currentIndex = chapterIndex(state.deck, state.chapterId);
    if (currentIndex === targetIndex) return state;
    return {
      ...state,
      chapterId,
      direction: targetIndex > currentIndex ? "forward" : "backward"
    };
  }
  return {
    kind: "recap-chapter",
    deck: state.deck,
    chapterId,
    stale: state.stale,
    direction: "backward"
  };
};

/**
 * 從第一章重播。帶著同一期間的最新 deck 時改播它並清掉 stale，結尾「從頭播放即可查看最新回顧」
 * 才是真的；沒有（或期間不同、deck 無效）就重播凍結的那一份。
 */
const restart = <TDeck extends RecapDeck>(
  state: RecapUiState<TDeck>,
  latest: TDeck | undefined
): RecapUiState<TDeck> => {
  if (
    state.kind !== "recap-chapter"
    && state.kind !== "recap-evidence"
    && state.kind !== "recap-summary"
  ) {
    return state;
  }
  const fresh = latest && latest.scopeKey === state.deck.scopeKey && isValidDeck(latest)
    ? snapshotDeck(latest)
    : undefined;
  const deck = fresh ?? state.deck;
  const firstChapter = deck.chapters[0];
  if (!firstChapter) return state;
  return {
    kind: "recap-chapter",
    deck,
    chapterId: firstChapter.id,
    stale: fresh ? false : state.stale,
    direction: "forward"
  };
};

const markDeckStale = <TDeck extends RecapDeck>(
  state: RecapUiState<TDeck>,
  fingerprint: string
): RecapUiState<TDeck> => {
  if (
    state.kind !== "recap-chapter"
    && state.kind !== "recap-evidence"
    && state.kind !== "recap-summary"
  ) {
    return state;
  }
  if (state.stale || fingerprint === state.deck.fingerprint) return state;
  return { ...state, stale: true };
};

const chapterIndex = (deck: RecapDeck, chapterId: string): number =>
  deck.chapters.findIndex((chapter) => chapter.id === chapterId);

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
