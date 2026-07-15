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
import { parseWatchEntriesFromDom, type HistoryParseIssue } from "./history";
import {
  collectEpisodeMetadata,
  type MetadataResolver
} from "./metadata";
import { parseMetadataBundleWire } from "./metadata-cache";
import {
  METADATA_RUNTIME_MESSAGE,
  unwrapMetadataRuntimeResponse,
  type MetadataRuntimeRequest
} from "./metadata-protocol";
import { emptyMetadataState, type DayBoundaryMode, type MetadataState, type WatchEntry } from "./model";
import { addTaipeiCalendarDays, taipeiStartOfDate, toTaipeiDateKey } from "./time";

const STYLE_ID = "ani-gamer-watch-heatmap-style";
const ACTIVE_DATA_ATTRIBUTE = "data-ani-heatmap-active";
const DAY_BOUNDARY_MODE_STORAGE_KEY = "ani-gamer-heatmap-day-boundary-mode";
const HISTORY_PAGE_LIMIT = 240;

type HistoryStatus = "loading" | "ready" | "error";

let currentEntries: readonly WatchEntry[] = [];
let metadataState: MetadataState = emptyMetadataState();
let historyCollectedAt: Date | undefined;
let dayBoundaryMode: DayBoundaryMode = "thirty-hour";
let historyCoverage: HistoryCoverage = createHistoryCoverage(false);
let historyParseIssues: readonly HistoryParseIssue[] = [];
let historyStatus: HistoryStatus = "loading";
let historyError: string | undefined;
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

const collectCompleteHistory = async (): Promise<void> => {
  if (isCollectingHistory) {
    return;
  }

  isCollectingHistory = true;
  metadataController?.abort();
  metadataController = undefined;
  metadataGeneration += 1;
  metadataState = emptyMetadataState();
  historyStatus = "loading";
  historyError = undefined;
  loadedCompleteHistory = false;
  historyCollectedAt = undefined;
  historyCoverage = createHistoryCoverage(false);
  updateViews();
  observer?.disconnect();

  try {
    await loadAllHistoryPagesIntoDom();
    loadedCompleteHistory = true;
    historyCollectedAt = new Date();
    parseCurrentHistory();
    historyStatus = "ready";
    updateViews();
    void startMetadataCollection();
  } catch (error) {
    console.error("[ani-gamer-heatmap] 載入觀看紀錄失敗", error);
    historyStatus = "error";
    historyError = "觀看紀錄尚未載入完成。請重新整理頁面後再試一次。";
    historyCoverage = createHistoryCoverage(false);
    updateViews();
  } finally {
    isCollectingHistory = false;
    watchForHistoryPage();
  }
};

const parseCurrentHistory = (): void => {
  const result = parseWatchEntriesFromDom(
    document,
    dayBoundaryMode,
    historyCollectedAt ?? new Date()
  );
  currentEntries = result.entries;
  historyParseIssues = result.issues;
  historyCoverage = createHistoryCoverage(loadedCompleteHistory && historyParseIssues.length === 0);
};

const startMetadataCollection = (): Promise<void> => {
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

    try {
      const result = await collectEpisodeMetadata(currentEntries, {
        signal: controller.signal,
        concurrency: 4,
        resolver: metadataResolver,
        onProgress: (state) => {
          if (generation !== metadataGeneration || controller.signal.aborted) {
            return;
          }
          metadataState = state;
          updateAnalysisView();
        }
      });

      if (generation === metadataGeneration && !controller.signal.aborted) {
        metadataState = result;
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
  parseCurrentHistory();
  updateViews();
};

const updateViews = (): void => {
  heatmapView?.render(currentEntries, dayBoundaryMode, {
    loading: historyStatus === "loading",
    error: historyStatus === "error" ? historyError : undefined,
    loadingMessage: "正在載入過去一年的觀看紀錄…"
  });
  updateAnalysisView();
};

const updateAnalysisView = (): void => {
  if (!analysisView) {
    return;
  }

  const state: AnalysisViewState = {
    entries: currentEntries,
    metadataState,
    historyCoverage,
    dayBoundaryMode,
    historyStatus,
    historyError
  };
  analysisView.update(state);
};

const watchForHistoryPage = (): void => {
  observer?.disconnect();
  observer = new MutationObserver((mutations) => {
    if (mutations.every(isExtensionMutation)) {
      return;
    }

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

      if (!isCollectingHistory && mutations.some(isHistoryMutation)) {
        void collectCompleteHistory();
      }
    }, 300);
  });

  observer.observe(document.body, { childList: true, subtree: true });
};

const teardownPageUi = (): void => {
  metadataController?.abort();
  metadataController = undefined;
  metadataGeneration += 1;
  analysisView?.destroy();
  analysisView = undefined;
  heatmapView?.destroy();
  heatmapView = undefined;
  currentEntries = [];
  metadataState = emptyMetadataState();
  historyParseIssues = [];
  historyStatus = "loading";
  historyError = undefined;
  loadedCompleteHistory = false;
  historyCollectedAt = undefined;
  historyCoverage = createHistoryCoverage(false);
};

const loadAllHistoryPagesIntoDom = async (): Promise<void> => {
  await waitForHistoryDom();

  for (let attempt = 0; attempt < HISTORY_PAGE_LIMIT; attempt += 1) {
    const button = document.querySelector<HTMLElement>(".anime-btn-show-more");
    if (!button) {
      return;
    }

    const previousSubListCount = document.querySelectorAll(".user-watchTime-list").length;
    const previousCardCount = document.querySelectorAll(".user-watch-list").length;
    button.click();
    await waitForHistoryPageAppend(previousSubListCount, previousCardCount);
  }

  throw new Error(`觀看紀錄超過 ${HISTORY_PAGE_LIMIT} 頁，無法證明資料完整`);
};

const waitForHistoryDom = async (): Promise<void> => {
  if (document.querySelector(".user-watchTime-list, .anime-btn-show-more, .notice")) {
    return;
  }
  await waitForDomChange(
    () => Boolean(document.querySelector(".user-watchTime-list, .anime-btn-show-more, .notice")),
    8000
  );
};

const waitForHistoryPageAppend = async (previousSubListCount: number, previousCardCount: number): Promise<void> => {
  await waitForDomChange(() => {
    const nextSubListCount = document.querySelectorAll(".user-watchTime-list").length;
    const nextCardCount = document.querySelectorAll(".user-watch-list").length;
    const loading = document.querySelector(".loading-anime");
    const isLoading = Boolean(loading && !loading.classList.contains("is-hide"));
    return nextSubListCount > previousSubListCount
      || nextCardCount > previousCardCount
      || (!isLoading && !document.querySelector(".anime-btn-show-more"));
  }, 12000);
};

const waitForDomChange = (predicate: () => boolean, timeoutMs: number): Promise<void> => {
  if (predicate()) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      mutationObserver.disconnect();
      reject(new Error("等待觀看紀錄載入逾時"));
    }, timeoutMs);
    const mutationObserver = new MutationObserver(() => {
      if (!predicate()) {
        return;
      }
      window.clearTimeout(timeout);
      mutationObserver.disconnect();
      resolve();
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"]
    });
  });
};

function createHistoryCoverage(complete: boolean): HistoryCoverage {
  const now = historyCollectedAt ?? new Date();
  const coveredFromKey = addTaipeiCalendarDays(toTaipeiDateKey(now, dayBoundaryMode), -364);
  const boundaryOffset = dayBoundaryMode === "thirty-hour" ? 6 * 60 * 60 * 1000 : 0;
  return {
    coveredFrom: new Date(taipeiStartOfDate(coveredFromKey).getTime() + boundaryOffset),
    coveredThrough: now,
    complete
  };
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
    historyParseIssues
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
