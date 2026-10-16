import { formatHistoryNote } from "./analysis-format";
import { AnalysisView, analysisHostGuardCss, type AnalysisViewState } from "./analysis-view";
import type { HistoryCoverage } from "./analytics";
import {
  buildDebugExport,
  downloadDebugExport,
  parseMetadataDebugSnapshotWire
} from "./debug-export";
import {
  ANALYSIS_OVERLAY_ID,
  HEATMAP_ROOT_ID,
  HeatmapView
} from "./heatmap-view";
import {
  HISTORY_ROW_SELECTOR,
  type HistoryParseIssue,
  type HistoryRow,
  type HistoryWatch
} from "./history";
import {
  emptyHistoryLoadDiagnostics,
  evaluateHistoryPage,
  finalizeHistoryLoad,
  historyAccountHash,
  HISTORY_CACHE_STORAGE_KEY,
  historyCoverageFor,
  historySnapshotView,
  readBahamutUserId,
  selectHistoryCache,
  serializeHistoryCache,
  shouldForceFullHistoryLoad,
  watchEntriesDiffer,
  type HistoryCacheRecord,
  type HistoryCacheStatus,
  type HistoryLoadDiagnostics,
  type HistoryLoadEnd,
  type HistoryLoadResult,
  type IncrementalStopRejection
} from "./history-cache";
import { HistoryPageSession } from "./history-session";
import {
  collectEpisodeMetadata,
  overlayMetadataState,
  type MetadataResolver
} from "./metadata";
import { parseMetadataBundleWire } from "./metadata-cache";
import {
  METADATA_RUNTIME_MESSAGE,
  unwrapMetadataRuntimeResponse,
  type MetadataRuntimeRequest
} from "./metadata-protocol";
import {
  emptyMetadataState,
  type DayBoundaryMode,
  type MetadataProgress,
  type MetadataState,
  type WatchEntry
} from "./model";

const STYLE_ID = "ani-gamer-watch-heatmap-style";
const ACTIVE_DATA_ATTRIBUTE = "data-ani-heatmap-active";
const DAY_BOUNDARY_MODE_STORAGE_KEY = "ani-gamer-heatmap-day-boundary-mode";
const HISTORY_PAGE_LIMIT = 240;
const SHOW_MORE_SELECTOR = ".anime-btn-show-more";
// The site may re-render "顯示更多" after the appended cards, so a missing
// button only ends the history once it stays missing this long.
const HISTORY_END_SETTLE_MILLISECONDS = 500;
const HISTORY_REFRESHING_NOTE = "更新中…";
const HISTORY_REFRESH_FAILED_NOTE = "未能更新，顯示先前保存的紀錄";
const HISTORY_ACCOUNT_CHANGED_NOTE = "登入帳號已變更，重新整理頁面後才會更新";
// Each analysis render recomputes the whole dashboard, so progress ticks are
// coalesced; phase changes and final results still render at once.
const ANALYSIS_PROGRESS_UPDATE_INTERVAL_MILLISECONDS = 500;
const METADATA_PROGRESS_INTERVAL_MILLISECONDS = 250;

type HistoryStatus = "loading" | "ready" | "error";

type HistoryAccount = {
  /** Hash of the logged-in Bahamut id; null without a valid id. */
  readonly hash: string | null;
  readonly status: Extract<HistoryCacheStatus, "no-account" | "read-failed"> | "ok";
};

type HistoryCacheRead = {
  readonly cache: HistoryCacheRecord | null;
  readonly status: HistoryCacheStatus;
};

type HistoryPagesResult = {
  readonly end: HistoryLoadEnd;
  readonly rows: readonly HistoryRow[];
  readonly issues: readonly HistoryParseIssue[];
  readonly clickCount: number;
  readonly rowsPerPage: readonly number[];
  readonly incrementalRejection: IncrementalStopRejection | null;
  /** History DOM shape at the last read, so rows appended after it are not lost. */
  readonly domSignature: string;
};

type ShownHistory = {
  readonly watches: readonly HistoryWatch[];
  readonly collectedAt: Date;
  readonly complete: boolean;
  readonly parseIssues: readonly HistoryParseIssue[];
  /** False for a saved record, which may predate the page. */
  readonly fromPage: boolean;
  readonly note: string | undefined;
};

/** Mode-independent watches behind the shown entries (page rows or the saved cache). */
let currentWatches: readonly HistoryWatch[] = [];
let currentEntries: readonly WatchEntry[] = [];
let metadataState: MetadataState = emptyMetadataState();
/**
 * Snapshot time of the shown watches: the page's first render, or a saved
 * record's own collectedAt. Coverage and the 365-day window both end there.
 */
let historyCollectedAt: Date | undefined;
let historyCoverageComplete = false;
let dayBoundaryMode: DayBoundaryMode = "thirty-hour";
let historyCoverage: HistoryCoverage = createHistoryCoverage();
let historyParseIssues: readonly HistoryParseIssue[] = [];
let historyStatus: HistoryStatus = "loading";
let historyError: string | undefined;
let historyNote: string | undefined;
let historyLoad: HistoryLoadDiagnostics = emptyHistoryLoadDiagnostics();
/** History DOM shape at the last collection's final read, so its own clicks never retrigger it. */
let historyDomSignature: string | undefined;
/** The rows read since the UI was mounted; see HistoryPageSession. */
let historySession: HistoryPageSession | undefined;
let historyTimeOriginUsed = false;
/** First history change seen since the last collection; appended rows were fetched about then. */
let historyMutationObservedAt: Date | undefined;
let heatmapView: HeatmapView | undefined;
let analysisView: AnalysisView | undefined;
let observer: MutationObserver | undefined;
let refreshTimer: number | undefined;
let isCollectingHistory = false;
let loadedCompleteHistory = false;
let metadataController: AbortController | undefined;
let metadataGeneration = 0;
let metadataCollectionTask: Promise<void> | undefined;
let metadataCacheClearTask: Promise<number> | undefined;
let isClearingMetadataCache = false;
let metadataCollectionStartedAt: Date | undefined;
let metadataCollectionFinishedAt: Date | undefined;
let analysisUpdateTimer: number | undefined;
let lastAnalysisUpdateAt = Number.NEGATIVE_INFINITY;
let renderedMetadataPhase: MetadataProgress["phase"] | undefined;
const metadataResolver: MetadataResolver = async (videoSn, signal) => parseMetadataBundleWire(
  await sendMetadataRuntimeRequest({
    type: METADATA_RUNTIME_MESSAGE.resolveEpisode,
    videoSn
  }, signal)
);

const main = async (): Promise<void> => {
  if (document.documentElement.hasAttribute(ACTIVE_DATA_ATTRIBUTE)) {
    return;
  }

  document.documentElement.setAttribute(ACTIVE_DATA_ATTRIBUTE, "true");
  dayBoundaryMode = await loadDayBoundaryMode();
  injectStyle();
  watchForHistoryPage();
  if (isHistoryPage()) {
    void mountPageUi();
  }
};

const mountPageUi = async (): Promise<void> => {
  const anchor = findInsertionAnchor();
  if (!anchor) {
    return;
  }

  let root = document.getElementById(HEATMAP_ROOT_ID);
  if (!root) {
    root = document.createElement("section");
    root.id = HEATMAP_ROOT_ID;
    root.setAttribute("aria-label", "動畫瘋觀看熱力圖");
    anchor.insertAdjacentElement("afterend", root);
  }

  if (!heatmapView || heatmapView.root !== root) {
    heatmapView?.destroy();
    heatmapView = new HeatmapView(root, {
      onBoundaryModeChange: handleBoundaryModeChange,
      onOpenAnalysis: () => {
        heatmapView?.hideTooltip();
        analysisView?.open();
      }
    });
  }

  analysisView ??= new AnalysisView({
    onClearMetadataCache: clearMetadataCacheAndRestart,
    onDownloadDebugData: downloadCurrentDebugData
  });
  updateViews();

  if (!isCollectingHistory && historyStatus !== "ready") {
    await collectCompleteHistory();
  }
};

/**
 * Shows the saved history for this account at once, then refreshes it from the
 * page. The refresh stops paging as soon as the cache provably covers the rest,
 * and restarts metadata only when the shown entries changed. A page whose rows
 * may now mix two accounts, or that is older than another tab's saved read, is
 * not read at all.
 */
const collectCompleteHistory = async (): Promise<void> => {
  if (isCollectingHistory) {
    return;
  }

  isCollectingHistory = true;
  observer?.disconnect();
  const startedAt = performance.now();
  const session = historySession ??= new HistoryPageSession(nextHistorySnapshotAt());
  const appendedAt = historyMutationObservedAt ?? new Date();
  historyMutationObservedAt = undefined;
  let load = emptyHistoryLoadDiagnostics();
  let domSignature: string | undefined;

  try {
    const account = await readHistoryAccount();
    if (session.bindAccount(account.hash) === "changed") {
      load = { ...load, refreshSkipped: "account-changed" };
      showHistoryAccountChanged();
      return;
    }
    const cacheRead = await readHistoryCacheForAccount(account);
    const cache = cacheRead.cache;
    load = { ...load, cacheStatus: cacheRead.status, cachedEntryCount: cache?.entries.length ?? null };

    if (cache && session.predates(cache)) {
      // Another tab saved a newer read; rows on this older page cannot add to it.
      showHistory({ ...cachedHistory(cache), note: undefined });
      load = { ...load, source: "cache-only", refreshSkipped: "newer-cache" };
      return;
    }

    if (historyStatus === "ready") {
      historyNote = HISTORY_REFRESHING_NOTE;
      updateViews();
    } else if (cache) {
      showHistory({ ...cachedHistory(cache), note: HISTORY_REFRESHING_NOTE });
      load = { ...load, source: "cache-only" };
    } else {
      resetMetadataCollection();
      historyStatus = "loading";
      historyError = undefined;
      historyNote = undefined;
      loadedCompleteHistory = false;
      historyCollectedAt = undefined;
      historyCoverageComplete = false;
      historyCoverage = createHistoryCoverage();
      updateViews();
    }
    historyLoad = load;

    try {
      const fullLoadReason = shouldForceFullHistoryLoad(cache, new Date());
      load = { ...load, fullLoadReason };
      const pages = await loadHistoryPagesIntoDom(session, cache, fullLoadReason === null, appendedAt);
      domSignature = pages.domSignature;
      if (
        pages.rows.length === 0
        && pages.issues.length === 0
        && cache
        && historySnapshotView({
          watches: cache.entries,
          collectedAt: cache.collectedAt,
          complete: cache.complete,
          mode: dayBoundaryMode
        }).entries.length > 0
      ) {
        // An empty page (for example a transient notice) never erases saved
        // watches that are still inside the window.
        throw new Error("觀看紀錄頁面沒有任何紀錄，保留先前保存的紀錄");
      }
      const result = finalizeHistoryLoad({
        end: pages.end,
        rows: pages.rows,
        issueCount: pages.issues.length,
        cache,
        collectedAt: session.snapshotAt
      });
      load = {
        ...load,
        source: result.source,
        end: pages.end,
        clickCount: pages.clickCount,
        rowsPerPage: pages.rowsPerPage,
        incrementalStopFired: pages.end === "incremental-stop",
        incrementalStopRejection: pages.end === "incremental-stop" ? null : pages.incrementalRejection,
        retainedCachedEntryCount: result.retainedCachedEntryCount,
        cacheWrite: await writeHistoryCache(session, result)
      };
      if (load.cacheWrite === "skipped-account-changed") {
        // The account changed during the load, so the appended pages may mix two accounts.
        showHistoryAccountChanged();
        return;
      }
      showHistory({
        watches: result.watches,
        collectedAt: session.snapshotAt,
        complete: result.complete,
        parseIssues: pages.issues,
        fromPage: true,
        note: undefined
      });
    } catch (error) {
      console.error("[ani-gamer-heatmap] 載入觀看紀錄失敗", error);
      load = { ...load, refreshError: errorMessage(error) };
      if (historyStatus === "ready") {
        // Saved or previously loaded entries stay authoritative until a refresh succeeds.
        historyNote = HISTORY_REFRESH_FAILED_NOTE;
        updateViews();
      } else {
        historyStatus = "error";
        historyError = "觀看紀錄尚未載入完成。請重新整理頁面後再試一次。";
        historyCoverageComplete = false;
        historyCoverage = createHistoryCoverage();
        updateViews();
      }
    }
  } finally {
    historyLoad = { ...load, durationMilliseconds: Math.round(performance.now() - startedAt) };
    isCollectingHistory = false;
    historyDomSignature = domSignature ?? readHistoryDomSignature();
    watchForHistoryPage();
    if (readHistoryDomSignature() !== historyDomSignature) {
      // Rows arrived after the last read, while the observer was disconnected.
      historyMutationObservedAt = new Date();
      scheduleHistoryRecollection();
    }
  }
};

const cachedHistory = (cache: HistoryCacheRecord): Omit<ShownHistory, "note"> => ({
  watches: cache.entries,
  collectedAt: cache.collectedAt,
  complete: cache.complete,
  parseIssues: [],
  fromPage: false
});

/**
 * Shows a snapshot of the history. While history is already shown, metadata
 * restarts only when the shown entries changed, and the analysis keeps the
 * previous records until the new collection replaces them.
 */
const showHistory = (history: ShownHistory): void => {
  const wasShowingHistory = historyStatus === "ready";
  if (!wasShowingHistory) resetMetadataCollection();
  const previousEntries = currentEntries;
  currentWatches = history.watches;
  historyCollectedAt = new Date(history.collectedAt.getTime());
  historyCoverageComplete = history.complete;
  historyParseIssues = history.parseIssues;
  loadedCompleteHistory = history.fromPage;
  historyStatus = "ready";
  historyError = undefined;
  historyNote = history.note;
  deriveCurrentHistory();
  updateViews();

  if (!wasShowingHistory) {
    void startMetadataCollection();
  } else if (watchEntriesDiffer(previousEntries, currentEntries)) {
    void startMetadataCollection({ keepVisibleState: true });
  }
};

const showHistoryAccountChanged = (): void => {
  if (historyStatus === "ready") {
    historyNote = HISTORY_ACCOUNT_CHANGED_NOTE;
    updateViews();
    return;
  }
  historyStatus = "error";
  historyError = "登入帳號已變更。請重新整理頁面後再試一次。";
  historyCoverageComplete = false;
  historyCoverage = createHistoryCoverage();
  updateViews();
};

/**
 * The first mount reads the page as served, so its rows were fetched no
 * earlier than navigation start; a later mount reads rows rendered since.
 */
const nextHistorySnapshotAt = (): Date => {
  const origin = Math.floor(performance.timeOrigin);
  if (historyTimeOriginUsed || !Number.isFinite(origin) || origin > Date.now()) {
    return new Date();
  }
  historyTimeOriginUsed = true;
  return new Date(origin);
};

const resetMetadataCollection = (): void => {
  metadataController?.abort();
  metadataController = undefined;
  metadataGeneration += 1;
  metadataState = emptyMetadataState();
  metadataCollectionStartedAt = undefined;
  metadataCollectionFinishedAt = undefined;
};

const deriveCurrentHistory = (): void => {
  const view = historySnapshotView({
    watches: currentWatches,
    collectedAt: historyCollectedAt ?? new Date(),
    complete: historyCoverageComplete,
    mode: dayBoundaryMode
  });
  currentEntries = view.entries;
  historyCoverage = view.coverage;
};

/**
 * With `keepVisibleState`, the analysis keeps showing the previous records
 * until the new collection settles each videoSn again, so a refresh never
 * flashes empty and an interrupted collection's partial records still fill in.
 */
const startMetadataCollection = (
  { keepVisibleState = false }: { readonly keepVisibleState?: boolean } = {}
): Promise<void> => {
  if (isClearingMetadataCache) {
    return Promise.resolve();
  }

  metadataController?.abort();
  const previousTask = metadataCollectionTask;
  const controller = new AbortController();
  metadataController = controller;
  const generation = ++metadataGeneration;

  const task = (async (): Promise<void> => {
    if (previousTask) {
      await previousTask;
    }
    if (generation !== metadataGeneration || controller.signal.aborted) {
      return;
    }

    const visibleState = keepVisibleState ? metadataState : undefined;
    metadataCollectionStartedAt = new Date();
    metadataCollectionFinishedAt = undefined;
    try {
      const result = await collectEpisodeMetadata(currentEntries, {
        signal: controller.signal,
        concurrency: 4,
        resolver: metadataResolver,
        progressIntervalMilliseconds: METADATA_PROGRESS_INTERVAL_MILLISECONDS,
        onProgress: (state) => {
          if (generation !== metadataGeneration || controller.signal.aborted) {
            return;
          }
          metadataState = visibleState ? overlayMetadataState(visibleState, state) : state;
          if (state.progress.phase === renderedMetadataPhase) {
            scheduleAnalysisViewUpdate();
          } else {
            updateAnalysisView();
          }
        }
      });

      if (generation === metadataGeneration && !controller.signal.aborted) {
        metadataState = result;
        metadataCollectionFinishedAt = new Date();
        updateAnalysisView();
      }
    } catch (error) {
      if (generation !== metadataGeneration || controller.signal.aborted) {
        return;
      }

      const videoSns = [...new Set(currentEntries.map((entry) => entry.videoSn))];
      metadataState = {
        episodes: new Map(),
        anime: new Map(),
        issues: videoSns.map((videoSn) => ({
          videoSn,
          kind: "network" as const,
          message: `上架時間資料層無法啟動：${errorMessage(error)}`
        })),
        progress: {
          phase: "complete",
          total: videoSns.length,
          completed: videoSns.length,
          available: 0,
          unavailable: 0,
          failed: videoSns.length
        }
      };
      metadataCollectionFinishedAt = new Date();
      updateAnalysisView();
    }
  })();

  metadataCollectionTask = task;
  void task.then(
    () => finishMetadataCollectionTask(task, controller),
    () => finishMetadataCollectionTask(task, controller)
  );
  return task;
};

const finishMetadataCollectionTask = (task: Promise<void>, controller: AbortController): void => {
  if (metadataCollectionTask === task) metadataCollectionTask = undefined;
  if (metadataController === controller) metadataController = undefined;
};

const clearMetadataCacheAndRestart = (): Promise<number> => {
  if (metadataCacheClearTask) {
    return metadataCacheClearTask;
  }

  isClearingMetadataCache = true;
  metadataController?.abort();
  metadataGeneration += 1;
  const previousTask = metadataCollectionTask;
  const task = (async (): Promise<number> => {
    try {
      if (previousTask) {
        await previousTask;
      }
      const removedCount = await clearMetadataCache();
      metadataState = emptyMetadataState();
      updateAnalysisView();
      isClearingMetadataCache = false;
      if (historyStatus === "ready" && currentEntries.length > 0 && isHistoryPage()) {
        void startMetadataCollection();
      }
      return removedCount;
    } finally {
      isClearingMetadataCache = false;
    }
  })();

  metadataCacheClearTask = task;
  void task.then(
    () => { if (metadataCacheClearTask === task) metadataCacheClearTask = undefined; },
    () => { if (metadataCacheClearTask === task) metadataCacheClearTask = undefined; }
  );
  return task;
};

const handleBoundaryModeChange = (mode: DayBoundaryMode): void => {
  if (dayBoundaryMode === mode) {
    return;
  }
  void persistDayBoundaryMode(mode).catch((error: unknown) => {
    console.error("[ani-gamer-heatmap] 無法保存日期制式設定", error);
    updateViews();
  });
};

const persistDayBoundaryMode = async (mode: DayBoundaryMode): Promise<void> => {
  await chrome.storage.local.set({ [DAY_BOUNDARY_MODE_STORAGE_KEY]: mode });
  dayBoundaryMode = mode;
  deriveCurrentHistory();
  updateViews();
};

const updateViews = (): void => {
  updateHeatmapView();
  updateAnalysisView();
};

const updateHeatmapView = (): void => {
  heatmapView?.render(currentEntries, dayBoundaryMode, {
    loading: historyStatus === "loading",
    error: historyStatus === "error" ? historyError : undefined,
    loadingMessage: "正在載入過去一年的觀看紀錄…",
    note: historyStatus === "ready" ? historyNote : undefined
  });
};

const scheduleAnalysisViewUpdate = (): void => {
  if (analysisUpdateTimer !== undefined) {
    return;
  }
  const elapsed = performance.now() - lastAnalysisUpdateAt;
  analysisUpdateTimer = window.setTimeout(
    updateAnalysisView,
    Math.max(0, ANALYSIS_PROGRESS_UPDATE_INTERVAL_MILLISECONDS - elapsed)
  );
};

const updateAnalysisView = (): void => {
  window.clearTimeout(analysisUpdateTimer);
  analysisUpdateTimer = undefined;
  lastAnalysisUpdateAt = performance.now();
  renderedMetadataPhase = metadataState.progress.phase;
  if (!analysisView) {
    return;
  }

  const state: AnalysisViewState = {
    entries: currentEntries,
    metadataState,
    historyCoverage,
    dayBoundaryMode,
    historyStatus,
    historyError,
    historyNote: analysisHistoryNote()
  };
  analysisView.update(state);
};

/** The heatmap's note, plus the snapshot time when the overlay shows a saved record rather than this page. */
const analysisHistoryNote = (): string | undefined => {
  if (historyStatus !== "ready" || historyNote === undefined) return undefined;
  return formatHistoryNote(historyNote, loadedCompleteHistory ? null : historyCollectedAt ?? null);
};

const watchForHistoryPage = (): void => {
  observer?.disconnect();
  observer = new MutationObserver((mutations) => {
    if (mutations.every(isExtensionMutation)) {
      return;
    }
    const historyChanged = mutations.some(isHistoryMutation);
    if (historyChanged) historyMutationObservedAt ??= new Date();

    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      if (!isHistoryPage()) {
        teardownPageUi();
        return;
      }

      if (!document.getElementById(HEATMAP_ROOT_ID)) {
        void mountPageUi();
        return;
      }

      if (historyChanged) recollectHistoryIfChanged();
    }, 300);
  });

  observer.observe(document.body, { childList: true, subtree: true });
};

const scheduleHistoryRecollection = (): void => {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(recollectHistoryIfChanged, 300);
};

const recollectHistoryIfChanged = (): void => {
  if (isCollectingHistory || !isHistoryPage() || !document.getElementById(HEATMAP_ROOT_ID)) {
    return;
  }
  if (readHistoryDomSignature() === historyDomSignature) {
    // Nothing new to read; a later append must not inherit this time.
    historyMutationObservedAt = undefined;
    return;
  }
  void collectCompleteHistory();
};

const teardownPageUi = (): void => {
  resetMetadataCollection();
  window.clearTimeout(analysisUpdateTimer);
  analysisUpdateTimer = undefined;
  analysisView?.destroy();
  analysisView = undefined;
  heatmapView?.destroy();
  heatmapView = undefined;
  currentWatches = [];
  currentEntries = [];
  historyParseIssues = [];
  historyStatus = "loading";
  historyError = undefined;
  historyNote = undefined;
  historyLoad = emptyHistoryLoadDiagnostics();
  historyDomSignature = undefined;
  historySession = undefined;
  historyMutationObservedAt = undefined;
  loadedCompleteHistory = false;
  historyCollectedAt = undefined;
  historyCoverageComplete = false;
  historyCoverage = createHistoryCoverage();
};

/**
 * Pages through "顯示更多" until the incremental rule proves the cache covers the
 * rest, the window is exhausted, or the history ends. Rows already read in this
 * page session keep their pages; rows appended since (by the site or by the
 * user) form the newest page, so a re-collection starts from them.
 */
const loadHistoryPagesIntoDom = async (
  session: HistoryPageSession,
  cache: HistoryCacheRecord | null,
  incremental: boolean,
  appendedAt: Date
): Promise<HistoryPagesResult> => {
  await waitForHistoryDom();

  let incrementalRejection: IncrementalStopRejection | null = null;
  let fetchedAt = appendedAt;
  for (let clickCount = 0; ; clickCount += 1) {
    const domSignature = readHistoryDomSignature();
    const read = session.read(
      Array.from(document.querySelectorAll<HTMLElement>(HISTORY_ROW_SELECTOR)),
      fetchedAt,
      location.href
    );
    // A click that appended no rows still yields an (empty) newest page.
    const pages = clickCount > 0 && read.appendedRowCount === 0 ? [...read.pages, []] : read.pages;
    const finish = (end: HistoryLoadEnd): HistoryPagesResult => ({
      end,
      rows: read.rows,
      issues: read.issues,
      clickCount,
      rowsPerPage: pages.map((page) => page.length),
      incrementalRejection,
      domSignature
    });

    const outcome = evaluateHistoryPage({ cache, incremental, pages, collectedAt: session.snapshotAt });
    if (outcome.kind === "incremental-stop") return finish("incremental-stop");
    if (outcome.kind === "window-stop") return finish("window-stop");
    incrementalRejection = outcome.incrementalRejection;

    const button = await findShowMoreButton();
    if (!button) {
      return finish("end-of-history");
    }
    if (clickCount >= HISTORY_PAGE_LIMIT) {
      throw new Error(`觀看紀錄超過 ${HISTORY_PAGE_LIMIT} 頁，無法證明資料完整`);
    }

    const previousSubListCount = document.querySelectorAll(".user-watchTime-list").length;
    const previousCardCount = document.querySelectorAll(".user-watch-list").length;
    fetchedAt = new Date();
    button.click();
    await waitForHistoryPageAppend(previousSubListCount, previousCardCount);
  }
};

/** The button, or null once it has stayed missing for the settle period. */
const findShowMoreButton = async (): Promise<HTMLElement | null> => {
  const present = (): boolean => Boolean(document.querySelector(SHOW_MORE_SELECTOR));
  if (!present()) {
    await waitForDomCondition(present, HISTORY_END_SETTLE_MILLISECONDS);
  }
  return document.querySelector<HTMLElement>(SHOW_MORE_SELECTOR);
};

const readHistoryDomSignature = (): string => [
  document.querySelectorAll(HISTORY_ROW_SELECTOR).length,
  document.querySelector(SHOW_MORE_SELECTOR) ? 1 : 0
].join("|");

/** Hashes the logged-in account id for cache scoping; the id itself is never stored. */
const readHistoryAccount = async (): Promise<HistoryAccount> => {
  const userId = readBahamutUserId(document.cookie);
  if (!userId) return { hash: null, status: "no-account" };
  try {
    return { hash: await historyAccountHash(userId), status: "ok" };
  } catch (error) {
    console.error("[ani-gamer-heatmap] 無法建立觀看紀錄快取範圍", error);
    return { hash: null, status: "read-failed" };
  }
};

const readHistoryCacheForAccount = async (account: HistoryAccount): Promise<HistoryCacheRead> => {
  if (account.hash === null) {
    return { cache: null, status: account.status === "read-failed" ? "read-failed" : "no-account" };
  }
  try {
    const stored = await chrome.storage.local.get([HISTORY_CACHE_STORAGE_KEY]);
    const selected = selectHistoryCache(stored[HISTORY_CACHE_STORAGE_KEY], account.hash, new Date());
    if (selected.status === "invalid") {
      console.warn("[ani-gamer-heatmap] 已忽略格式無效的觀看紀錄快取");
    }
    return selected;
  } catch (error) {
    console.error("[ani-gamer-heatmap] 無法讀取觀看紀錄快取", error);
    return { cache: null, status: "read-failed" };
  }
};

/**
 * Saves the load for the session's account. The cookie and the stored record
 * are checked again right before writing, because the account or another tab
 * may have changed them during the load.
 */
const writeHistoryCache = async (
  session: HistoryPageSession,
  result: HistoryLoadResult
): Promise<HistoryLoadDiagnostics["cacheWrite"]> => {
  const account = await readHistoryAccount();
  if (account.hash === null) return "skipped-no-account";
  if (session.bindAccount(account.hash) !== "same") return "skipped-account-changed";
  try {
    const stored = await chrome.storage.local.get([HISTORY_CACHE_STORAGE_KEY]);
    const current = selectHistoryCache(stored[HISTORY_CACHE_STORAGE_KEY], account.hash, new Date());
    if (current.cache && session.predates(current.cache)) return "skipped-newer-cache";
    await chrome.storage.local.set({
      [HISTORY_CACHE_STORAGE_KEY]: serializeHistoryCache({
        accountHash: account.hash,
        collectedAt: session.snapshotAt,
        lastFullSyncAt: result.lastFullSyncAt,
        complete: result.complete,
        entries: result.watches
      })
    });
    return "written";
  } catch (error) {
    console.error("[ani-gamer-heatmap] 無法保存觀看紀錄快取", error);
    return "failed";
  }
};

const waitForHistoryDom = async (): Promise<void> => {
  const selector = `.user-watchTime-list, ${SHOW_MORE_SELECTOR}, .notice`;
  await waitForDomChange(() => Boolean(document.querySelector(selector)), 8000);
};

const waitForHistoryPageAppend = async (previousSubListCount: number, previousCardCount: number): Promise<void> => {
  await waitForDomChange(() => {
    const nextSubListCount = document.querySelectorAll(".user-watchTime-list").length;
    const nextCardCount = document.querySelectorAll(".user-watch-list").length;
    const loading = document.querySelector(".loading-anime");
    const isLoading = Boolean(loading && !loading.classList.contains("is-hide"));
    return nextSubListCount > previousSubListCount
      || nextCardCount > previousCardCount
      || (!isLoading && !document.querySelector(SHOW_MORE_SELECTOR));
  }, 12000);
};

const waitForDomChange = async (predicate: () => boolean, timeoutMs: number): Promise<void> => {
  if (!await waitForDomCondition(predicate, timeoutMs)) {
    throw new Error("等待觀看紀錄載入逾時");
  }
};

/** Resolves true once `predicate` holds, or false after `timeoutMs`. */
const waitForDomCondition = (predicate: () => boolean, timeoutMs: number): Promise<boolean> => {
  if (predicate()) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      mutationObserver.disconnect();
      resolve(false);
    }, timeoutMs);
    const mutationObserver = new MutationObserver(() => {
      if (!predicate()) {
        return;
      }
      window.clearTimeout(timeout);
      mutationObserver.disconnect();
      resolve(true);
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"]
    });
  });
};

function createHistoryCoverage(): HistoryCoverage {
  return historyCoverageFor({
    collectedAt: historyCollectedAt ?? new Date(),
    complete: historyCoverageComplete,
    mode: dayBoundaryMode
  });
}

const findInsertionAnchor = (): Element | null => Array.from(
  document.querySelectorAll<HTMLElement>("h1, h2, .page-title, [class*='title']")
).find((node) => /觀看紀錄|觀看記錄/.test(normalizeText(node.textContent ?? ""))) ?? null;

const isHistoryPage = (): boolean => {
  const path = location.pathname.toLowerCase();
  if (/history|record|watch/.test(path)) {
    return true;
  }
  if (/觀看紀錄|觀看記錄/.test(normalizeText(document.title))) {
    return true;
  }
  return findInsertionAnchor() !== null;
};

const isExtensionMutation = (mutation: MutationRecord): boolean => {
  const targetIsOwned = mutation.target instanceof Element && isOwnedElement(mutation.target);
  const addedAreOwned = mutation.addedNodes.length > 0
    && Array.from(mutation.addedNodes).every(isOwnedNode);
  const removedAreOwned = mutation.removedNodes.length > 0
    && Array.from(mutation.removedNodes).every(isOwnedNode);
  return targetIsOwned || addedAreOwned || removedAreOwned;
};

const isOwnedNode = (node: Node): boolean => node instanceof Element && isOwnedElement(node);

const isOwnedElement = (node: Element): boolean => node.id === HEATMAP_ROOT_ID
  || node.id === ANALYSIS_OVERLAY_ID
  || node.matches("[data-ani-heatmap-owned='true']")
  || Boolean(node.closest(`#${HEATMAP_ROOT_ID}, #${ANALYSIS_OVERLAY_ID}, [data-ani-heatmap-owned='true']`));

const isHistoryMutation = (mutation: MutationRecord): boolean => {
  const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return changedNodes.some((node) => node instanceof Element && (
    node.matches(".user-watchTime-list, .user-watch-textlist, .history-list-anime-title, .date, .anime-btn-show-more")
    || Boolean(node.querySelector(".user-watchTime-list, .user-watch-textlist, .history-list-anime-title, .date, .anime-btn-show-more"))
  ));
};

const clearMetadataCache = async (): Promise<number> => {
  const value = requireRuntimeRecord(await sendMetadataRuntimeRequest({
    type: METADATA_RUNTIME_MESSAGE.clearCache
  }), "metadata cache clear response");
  if (
    Object.keys(value).length !== 1
    || typeof value.removedCount !== "number"
    || !Number.isSafeInteger(value.removedCount)
    || value.removedCount < 0
  ) {
    throw new Error("metadata cache clear response 格式無效");
  }
  return value.removedCount;
};

const downloadCurrentDebugData = async (): Promise<string> => {
  const cacheSnapshot = parseMetadataDebugSnapshotWire(await sendMetadataRuntimeRequest({
    type: METADATA_RUNTIME_MESSAGE.exportDebugSnapshot
  }));
  const report = buildDebugExport({
    generatedAt: new Date(),
    cacheSnapshot,
    entries: currentEntries,
    metadataState,
    dayBoundaryMode,
    historyStatus,
    historyError,
    historyCollectedAt,
    loadedCompleteHistory,
    historyCoverage,
    historyParseIssues,
    historyLoad,
    metadataCollectionStartedAt,
    metadataCollectionFinishedAt
  });
  return downloadDebugExport(report);
};

const sendMetadataRuntimeRequest = (
  request: MetadataRuntimeRequest,
  signal?: AbortSignal
): Promise<unknown> => {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("aborted", "AbortError"));
  }

  const pending = chrome.runtime.sendMessage(request);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (operation: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      operation();
    };
    const onAbort = (): void => {
      finish(() => reject(signal?.reason ?? new DOMException("aborted", "AbortError")));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (response) => finish(() => {
        try {
          resolve(unwrapMetadataRuntimeResponse(response));
        } catch (error) {
          reject(error);
        }
      }),
      (error) => finish(() => reject(error))
    );
    if (signal?.aborted) onAbort();
  });
};

const requireRuntimeRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} 必須是 object`);
  }
  return value as Record<string, unknown>;
};

const injectStyle = (): void => {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = analysisHostGuardCss;
  document.head.append(style);
};

const loadDayBoundaryMode = async (): Promise<DayBoundaryMode> => {
  const stored = await chrome.storage.local.get([DAY_BOUNDARY_MODE_STORAGE_KEY]);
  const saved = stored[DAY_BOUNDARY_MODE_STORAGE_KEY];
  if (saved === undefined) return "thirty-hour";
  if (saved === "calendar" || saved === "thirty-hour") return saved;
  await chrome.storage.local.remove([DAY_BOUNDARY_MODE_STORAGE_KEY]);
  return "thirty-hour";
};

const normalizeText = (text: string): string => text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

void main().catch((error: unknown) => {
  document.documentElement.removeAttribute(ACTIVE_DATA_ATTRIBUTE);
  console.error("[ani-gamer-heatmap] 初始化失敗", error);
});

export {};
