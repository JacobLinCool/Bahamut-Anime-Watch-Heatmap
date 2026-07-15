import { dashboardCss, renderDashboard } from "./analysis-dashboard";
import { formatHalfOpenRange } from "./analysis-format";
import { analyzeWatchHistory, type AnalyticsResult, type HistoryCoverage } from "./analytics";
import { ANALYSIS_OVERLAY_ID, ANALYSIS_TRIGGER_ID } from "./heatmap-view";
import { MAX_METADATA_REQUESTS_PER_SECOND } from "./metadata";
import { MetadataProgressEstimator } from "./metadata-progress";
import type { DayBoundaryMode, MetadataState, WatchEntry } from "./model";
import {
  analysisScopeKey,
  getAnalysisScopeOptionGroups,
  type AnalysisAxis,
  type AnalysisScope,
  type AnalysisScopeOptionGroup,
  type PeriodDefinition
} from "./period";
import { buildRecapDeck, type RecapPresentationDeck } from "./recap/recap-deck";
import {
  initialRecapUiState,
  reduceRecapUiState,
  type RecapUiEvent,
  type RecapUiState
} from "./recap/recap-state";
import {
  recapCss,
  RECAP_EVIDENCE_OPENER_FOCUS_KEY,
  renderRecapSurface
} from "./recap/recap-view";
import { createButton, element, textElement } from "./view-dom";

const TITLE_ID = "ani-gamer-watch-analysis-title";
const DESCRIPTION_ID = "ani-gamer-watch-analysis-description";
const LIVE_ID = "ani-gamer-watch-analysis-live";
const CACHE_FEEDBACK_ID = "ani-gamer-watch-analysis-cache-feedback";
const PERIOD_SELECT_ID = "ani-gamer-watch-analysis-period";
const DEFAULT_PERIOD_IDENTITY = "rolling:365";

export type AnalysisViewState = {
  readonly entries: readonly WatchEntry[];
  readonly metadataState: MetadataState;
  readonly historyCoverage: HistoryCoverage;
  readonly dayBoundaryMode: DayBoundaryMode;
  readonly historyStatus: "loading" | "ready" | "error";
  readonly historyError?: string;
};

type AnalysisViewOptions = {
  readonly onClearMetadataCache: () => Promise<number>;
  readonly onDownloadDebugData: () => Promise<string>;
};

export class AnalysisView {
  readonly #options: AnalysisViewOptions;
  #state: AnalysisViewState | undefined;
  #uiState: RecapUiState<RecapPresentationDeck> = initialRecapUiState;
  #selectedAxis: AnalysisAxis = "watched-at";
  #selectedPeriodIdentity = DEFAULT_PERIOD_IDENTITY;
  #selectedScopeKey = "";
  #scopeOptions = new Map<string, AnalysisScope>();
  #scopeSignature = "";
  #host: HTMLElement | undefined;
  #overlay: HTMLElement | undefined;
  #shell: HTMLElement | undefined;
  #heading: HTMLElement | undefined;
  #metadataProgress: HTMLElement | undefined;
  #metadataProgressDetail: HTMLElement | undefined;
  #metadataProgressBar: HTMLProgressElement | undefined;
  #surfaceNav: HTMLElement | undefined;
  #controls: HTMLElement | undefined;
  #axisControl: HTMLElement | undefined;
  #select: HTMLSelectElement | undefined;
  #periodDescription: HTMLElement | undefined;
  #main: HTMLElement | undefined;
  #live: HTMLElement | undefined;
  #cacheButton: HTMLButtonElement | undefined;
  #debugButton: HTMLButtonElement | undefined;
  #cacheFeedback: HTMLElement | undefined;
  #isClearingMetadataCache = false;
  #isDownloadingDebugData = false;
  #opener: HTMLElement | undefined;
  #priorBodyOverflow = "";
  #priorHtmlOverflow = "";
  #priorBodyOverflowPriority = "";
  #priorHtmlOverflowPriority = "";
  #lastAnnouncement = "";
  #inertBeforeOpen = new Map<HTMLElement, boolean>();
  #backgroundObserver: MutationObserver | undefined;
  #renderedFocusViewKey = "";
  #pendingFocusKey: string | undefined;
  readonly #metadataProgressEstimator = new MetadataProgressEstimator();

  constructor(options: AnalysisViewOptions) {
    this.#options = options;
  }

  get isOpen(): boolean {
    return this.#host?.isConnected === true;
  }

  update(state: AnalysisViewState): void {
    this.#state = state;
    if (!this.isOpen) return;
    this.#syncScopeOptions();
    this.#syncCacheButton();
    this.#syncMetadataProgress();
    this.#render();
  }

  open(): void {
    if (this.#host && !this.#host.isConnected) this.close({ restoreFocus: false });
    if (this.isOpen) {
      this.#heading?.focus();
      return;
    }

    this.#opener = deepestActiveElement();
    this.#uiState = reduceRecapUiState<RecapPresentationDeck>(
      initialRecapUiState,
      { type: "OPEN", surface: "dashboard" }
    );

    const host = document.createElement("ani-gamer-watch-analysis");
    host.id = ANALYSIS_OVERLAY_ID;
    host.dataset.aniHeatmapOwned = "true";
    isolateAnalysisHost(host);
    const shadow = host.attachShadow({ mode: "open" });
    const style = element("style");
    style.textContent = analysisCss;

    const overlay = element("div", "ani-analysis-overlay");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", TITLE_ID);
    overlay.setAttribute("aria-describedby", DESCRIPTION_ID);
    const shell = element("div", "ani-analysis-shell");

    const header = element("header", "ani-analysis-header");
    const headerInner = element("div", "ani-analysis-header-inner");
    const brand = element("div", "ani-analysis-brand");
    const heading = textElement("h2", "ani-analysis-title", "我的觀看誌");
    heading.id = TITLE_ID;
    heading.tabIndex = -1;
    const subtitle = textElement("p", "ani-analysis-subtitle", "從觀看時間與每集上架時間，整理你的追番節奏與選擇。");
    subtitle.id = DESCRIPTION_ID;
    brand.append(heading, subtitle);

    const surfaceNav = element("nav", "ani-analysis-surface-nav");
    surfaceNav.setAttribute("aria-label", "觀看誌頁面");
    surfaceNav.append(
      this.#surfaceButton("dashboard", "觀看總覽"),
      this.#surfaceButton("recap", "期間回顧")
    );

    const closeButton = createButton("ani-analysis-close", "×");
    closeButton.setAttribute("aria-label", "關閉我的觀看誌");
    closeButton.addEventListener("click", () => this.close());
    headerInner.append(brand, surfaceNav, closeButton);
    const metadataProgress = element("section", "ani-analysis-metadata-progress");
    metadataProgress.hidden = true;
    metadataProgress.setAttribute("aria-label", "完整分析載入進度");
    const metadataProgressHeader = element("div", "ani-analysis-metadata-progress-header");
    const metadataProgressTitle = textElement("strong", "", "正在準備完整分析");
    const metadataProgressDetail = element("span");
    metadataProgressHeader.append(metadataProgressTitle, metadataProgressDetail);
    const metadataProgressBar = element("progress", "ani-analysis-metadata-progress-bar");
    metadataProgressBar.setAttribute("aria-label", "作品資料整理進度");
    metadataProgress.append(metadataProgressHeader, metadataProgressBar);
    header.append(headerInner, metadataProgress);

    const controls = element("section", "ani-analysis-controls");
    controls.setAttribute("aria-label", "分析範圍");
    const controlsInner = element("div", "ani-analysis-controls-inner");
    const axisControl = element("div", "ani-analysis-axis-control");
    axisControl.setAttribute("role", "group");
    axisControl.setAttribute("aria-label", "資料時間軸");
    axisControl.append(
      this.#axisButton("watched-at", "我何時看"),
      this.#axisButton("released-at", "內容何時上架")
    );

    const periodField = element("div", "ani-analysis-period-field");
    const periodLabel = textElement("label", "ani-analysis-period-label", "期間");
    periodLabel.htmlFor = PERIOD_SELECT_ID;
    const select = element("select", "ani-analysis-select");
    select.id = PERIOD_SELECT_ID;
    select.addEventListener("change", () => {
      const scope = this.#scopeOptions.get(select.value);
      if (!scope) return;
      this.#selectedScopeKey = select.value;
      this.#selectedPeriodIdentity = periodIdentity(scope.period);
      this.#render();
    });
    periodField.append(periodLabel, select);

    const periodDescription = element("div", "ani-analysis-period-description");
    const cacheArea = element("div", "ani-analysis-cache-area");
    const debugButton = createButton("ani-analysis-debug-button", "下載除錯資料");
    debugButton.setAttribute("aria-describedby", CACHE_FEEDBACK_ID);
    debugButton.addEventListener("click", () => void this.#downloadDebugData());
    const cacheButton = createButton("ani-analysis-cache-button", "清除作品資料快取");
    cacheButton.setAttribute("aria-describedby", CACHE_FEEDBACK_ID);
    cacheButton.addEventListener("click", () => void this.#clearMetadataCache());
    const cacheFeedback = element("div", "ani-analysis-cache-feedback");
    cacheFeedback.id = CACHE_FEEDBACK_ID;
    cacheFeedback.hidden = true;
    cacheArea.append(debugButton, cacheButton, cacheFeedback);
    controlsInner.append(axisControl, periodField, periodDescription, cacheArea);
    controls.append(controlsInner);

    const main = element("main", "ani-analysis-main");
    const live = element("div", "ani-analysis-visually-hidden");
    live.id = LIVE_ID;
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    live.setAttribute("aria-atomic", "true");
    shell.append(header, controls, main, live);
    overlay.append(shell);
    shadow.append(style, overlay);

    this.#host = host;
    this.#overlay = overlay;
    this.#shell = shell;
    this.#heading = heading;
    this.#metadataProgress = metadataProgress;
    this.#metadataProgressDetail = metadataProgressDetail;
    this.#metadataProgressBar = metadataProgressBar;
    this.#surfaceNav = surfaceNav;
    this.#controls = controls;
    this.#axisControl = axisControl;
    this.#select = select;
    this.#periodDescription = periodDescription;
    this.#main = main;
    this.#live = live;
    this.#cacheButton = cacheButton;
    this.#debugButton = debugButton;
    this.#cacheFeedback = cacheFeedback;

    overlay.addEventListener("keydown", this.#handleKeydown);
    document.body.append(host);
    this.#lockBackground();
    this.#syncScopeOptions();
    this.#syncCacheButton();
    this.#syncMetadataProgress();
    this.#render();
    queueMicrotask(() => heading.focus());
  }

  close(options: { readonly restoreFocus?: boolean } = {}): void {
    if (!this.#host) return;
    this.#uiState = reduceRecapUiState<RecapPresentationDeck>(this.#uiState, { type: "CLOSE" });
    this.#backgroundObserver?.disconnect();
    this.#backgroundObserver = undefined;
    this.#overlay?.removeEventListener("keydown", this.#handleKeydown);
    for (const [node, wasInert] of this.#inertBeforeOpen) node.inert = wasInert;
    this.#inertBeforeOpen.clear();
    restoreStyleProperty(document.body.style, "overflow", this.#priorBodyOverflow, this.#priorBodyOverflowPriority);
    restoreStyleProperty(document.documentElement.style, "overflow", this.#priorHtmlOverflow, this.#priorHtmlOverflowPriority);
    this.#host.remove();

    this.#host = undefined;
    this.#overlay = undefined;
    this.#shell = undefined;
    this.#heading = undefined;
    this.#metadataProgress = undefined;
    this.#metadataProgressDetail = undefined;
    this.#metadataProgressBar = undefined;
    this.#surfaceNav = undefined;
    this.#controls = undefined;
    this.#axisControl = undefined;
    this.#select = undefined;
    this.#periodDescription = undefined;
    this.#main = undefined;
    this.#live = undefined;
    this.#cacheButton = undefined;
    this.#debugButton = undefined;
    this.#cacheFeedback = undefined;
    this.#scopeSignature = "";
    this.#lastAnnouncement = "";
    this.#renderedFocusViewKey = "";
    this.#pendingFocusKey = undefined;
    this.#metadataProgressEstimator.reset();

    const opener = this.#opener;
    this.#opener = undefined;
    if (options.restoreFocus !== false) restoreAnalysisOpenerFocus(opener);
  }

  destroy(): void {
    this.close({ restoreFocus: false });
    this.#state = undefined;
  }

  #surfaceButton(surface: "dashboard" | "recap", label: string): HTMLButtonElement {
    const button = createButton("ani-analysis-surface-button", label);
    button.dataset.surface = surface;
    button.addEventListener("click", () => {
      this.#dispatch({ type: "SWITCH_SURFACE", surface });
    });
    return button;
  }

  #axisButton(axis: AnalysisAxis, label: string): HTMLButtonElement {
    const button = createButton("ani-analysis-axis-button", label);
    button.dataset.axis = axis;
    button.addEventListener("click", () => {
      if (this.#selectedAxis === axis) return;
      this.#selectedAxis = axis;
      this.#scopeSignature = "";
      this.#syncScopeOptions();
      this.#render();
    });
    return button;
  }

  #dispatch(event: RecapUiEvent<RecapPresentationDeck>): void {
    const next = reduceRecapUiState<RecapPresentationDeck>(this.#uiState, event);
    if (next === this.#uiState) return;
    this.#pendingFocusKey = postRecapDispatchFocusKey(this.#uiState, event, next);
    this.#uiState = next;
    this.#render();
  }

  readonly #handleKeydown = (event: KeyboardEvent): void => {
    if (handleAnalysisEscapeKey(
      event,
      this.#uiState.kind === "recap-evidence",
      () => this.#dispatch({ type: "CLOSE_EVIDENCE" }),
      () => this.close()
    )) return;
    if (event.key !== "Tab" || !this.#overlay) return;

    const trapRoot = getAnalysisFocusTrapRoot(
      this.#overlay,
      this.#main,
      this.#uiState.kind === "recap-evidence"
    );
    const focusable = getFocusableElements(trapRoot);
    if (focusable.length === 0) {
      event.preventDefault();
      const fallback = trapRoot.querySelector<HTMLElement>("[data-recap-focus]") ?? this.#heading;
      fallback?.focus();
      return;
    }
    const target = resolveCyclicFocusTarget(focusable, deepestActiveElement(), event.shiftKey);
    if (target) {
      event.preventDefault();
      target.focus();
    }
  };

  #lockBackground(): void {
    if (!this.#host) return;
    this.#priorBodyOverflow = document.body.style.overflow;
    this.#priorHtmlOverflow = document.documentElement.style.overflow;
    this.#priorBodyOverflowPriority = document.body.style.getPropertyPriority("overflow");
    this.#priorHtmlOverflowPriority = document.documentElement.style.getPropertyPriority("overflow");
    document.body.style.setProperty("overflow", "hidden", "important");
    document.documentElement.style.setProperty("overflow", "hidden", "important");

    const makeInert = (node: HTMLElement): void => {
      if (node === this.#host || this.#inertBeforeOpen.has(node)) return;
      this.#inertBeforeOpen.set(node, node.inert);
      node.inert = true;
    };
    for (const child of document.body.children) {
      if (child instanceof HTMLElement) makeInert(child);
    }
    this.#backgroundObserver = new MutationObserver((mutations) => {
      if (this.#host && !this.#host.isConnected) {
        this.close({ restoreFocus: false });
        return;
      }
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) makeInert(node);
        }
      }
    });
    this.#backgroundObserver.observe(document.body, { childList: true });
  }

  #syncScopeOptions(): void {
    const state = this.#state;
    const select = this.#select;
    if (!state || !select) return;
    const asOf = analysisAsOf(state);
    const axis = this.#selectedAxis === "watched-at"
      ? { axis: this.#selectedAxis, dayBoundaryMode: state.dayBoundaryMode } as const
      : { axis: this.#selectedAxis } as const;
    const groups = getAnalysisScopeOptionGroups({ asOf, axis });
    const signature = `${this.#selectedAxis}:${state.dayBoundaryMode}:${asOf.toISOString().slice(0, 10)}`;

    const options = groups.flatMap((group) => group.options);
    const matching = options.find((option) => periodIdentity(option.scope.period) === this.#selectedPeriodIdentity)
      ?? options.find((option) => periodIdentity(option.scope.period) === DEFAULT_PERIOD_IDENTITY)
      ?? options[0];
    if (!matching) throw new Error("沒有可用的分析期間");
    this.#selectedScopeKey = matching.key;
    this.#selectedPeriodIdentity = periodIdentity(matching.scope.period);

    if (signature !== this.#scopeSignature) {
      this.#scopeOptions = new Map(options.map((option) => [option.key, option.scope]));
      select.replaceChildren(...groups.map(renderScopeOptionGroup));
      this.#scopeSignature = signature;
    }
    select.value = this.#selectedScopeKey;
    this.#syncAxisButtons();
  }

  #syncAxisButtons(): void {
    for (const node of this.#axisControl?.querySelectorAll<HTMLButtonElement>("[data-axis]") ?? []) {
      const selected = node.dataset.axis === this.#selectedAxis;
      node.setAttribute("aria-pressed", String(selected));
    }
  }

  #syncSurfaceButtons(): void {
    const surface = this.#uiState.kind === "dashboard" ? "dashboard" : "recap";
    for (const node of this.#surfaceNav?.querySelectorAll<HTMLButtonElement>("[data-surface]") ?? []) {
      const selected = node.dataset.surface === surface;
      node.setAttribute("aria-current", selected ? "page" : "false");
    }
  }

  #syncCacheButton(): void {
    const button = this.#cacheButton;
    const state = this.#state;
    if (!button || !state) return;
    const presentation = metadataCacheButtonPresentation(
      state.metadataState.progress.phase,
      this.#isClearingMetadataCache
    );
    button.textContent = presentation.label;
    button.disabled = presentation.disabled || this.#isDownloadingDebugData;
    button.setAttribute("aria-busy", String(presentation.busy));
    if (this.#debugButton) {
      const debugPresentation = debugDownloadButtonPresentation(
        this.#isDownloadingDebugData,
        this.#isClearingMetadataCache
      );
      this.#debugButton.textContent = debugPresentation.label;
      this.#debugButton.disabled = debugPresentation.disabled;
      this.#debugButton.setAttribute("aria-busy", String(debugPresentation.busy));
    }
  }

  #syncMetadataProgress(): void {
    const state = this.#state;
    const container = this.#metadataProgress;
    const detail = this.#metadataProgressDetail;
    const bar = this.#metadataProgressBar;
    if (!state || !container || !detail || !bar) return;

    const presentation = this.#metadataProgressEstimator.present(state.metadataState.progress);
    if (!presentation || state.historyStatus !== "ready" || state.entries.length === 0) {
      container.hidden = true;
      bar.removeAttribute("value");
      return;
    }

    container.hidden = false;
    detail.textContent = presentation.detail;
    bar.setAttribute("aria-valuetext", presentation.detail);
    if (presentation.percent === null) {
      bar.removeAttribute("value");
      bar.max = 1;
      return;
    }
    bar.max = presentation.total;
    bar.value = presentation.completed;
  }

  async #downloadDebugData(): Promise<void> {
    if (this.#isDownloadingDebugData || this.#isClearingMetadataCache) return;

    this.#isDownloadingDebugData = true;
    this.#setCacheFeedback("正在整理除錯資料…", "status");
    this.#syncCacheButton();
    try {
      const filename = await this.#options.onDownloadDebugData();
      this.#setCacheFeedback(`已下載 ${filename}。`, "status");
    } catch (error) {
      console.error("[ani-gamer-heatmap] 下載除錯資料失敗", error);
      this.#setCacheFeedback("除錯資料未能下載，請稍後再試。", "error");
    } finally {
      this.#isDownloadingDebugData = false;
      this.#syncCacheButton();
    }
  }

  async #clearMetadataCache(): Promise<void> {
    const state = this.#state;
    if (this.#isClearingMetadataCache || !state) return;

    const resolving = state.metadataState.progress.phase === "resolving";

    const confirmed = window.confirm(
      `${resolving ? "這會停止目前的作品資料取得，並" : "這會"}刪除擴充功能保存的單集上架時間、片長與作品資料。`
      + `觀看紀錄與日期設定會保留；若觀看紀錄可用，系統會以所有分頁合計每秒最多 ${MAX_METADATA_REQUESTS_PER_SECOND} 次重新取得。是否繼續？`
    );
    if (!confirmed) return;

    this.#isClearingMetadataCache = true;
    this.#setCacheFeedback(`正在清除作品資料；接著會以每秒最多 ${MAX_METADATA_REQUESTS_PER_SECOND} 次重新取得…`, "status");
    this.#syncCacheButton();
    try {
      const removedCount = await this.#options.onClearMetadataCache();
      const restartStarted = this.#state?.historyStatus === "ready"
        && this.#state.entries.length > 0;
      this.#setCacheFeedback(
        metadataCacheClearedMessage(removedCount, restartStarted),
        "status"
      );
    } catch (error) {
      console.error("[ani-gamer-heatmap] 清除作品資料失敗", error);
      this.#setCacheFeedback("作品資料未能清除，請稍後再試。", "error");
    } finally {
      this.#isClearingMetadataCache = false;
      this.#syncCacheButton();
    }
  }

  #setCacheFeedback(text: string, tone: "status" | "error"): void {
    if (this.#cacheFeedback) {
      this.#cacheFeedback.hidden = false;
      this.#cacheFeedback.dataset.tone = tone;
      this.#cacheFeedback.textContent = text;
    }
    this.#announce(text);
  }

  #render(): void {
    const state = this.#state;
    const main = this.#main;
    const shell = this.#shell;
    if (!state || !main || !shell) return;
    const priorFocus = captureSemanticFocus(main);
    const focusViewKey = analysisFocusViewKey(this.#uiState);
    const focusViewChanged = focusViewKey !== this.#renderedFocusViewKey;
    this.#renderedFocusViewKey = focusViewKey;
    this.#syncSurfaceButtons();
    const playing = isRecapPlayback(this.#uiState);
    this.#controls?.toggleAttribute("hidden", playing);
    shell.dataset.uiKind = this.#uiState.kind;
    shell.dataset.playback = String(playing);
    main.className = playing ? "ani-analysis-main ani-analysis-main--recap" : "ani-analysis-main";
    main.setAttribute("aria-busy", String(
      state.historyStatus === "loading"
      || (state.historyStatus === "ready" && !metadataIsSettled(state.metadataState, state.entries.length))
    ));

    if (state.historyStatus === "loading") {
      main.replaceChildren(statusPanel("正在整理你的近一年觀看紀錄", "正在載入各頁紀錄，完成後就能查看月份、季度與年度變化。"));
      this.#setPeriodDescription("載入完成後，就能選擇月份、季度與年度。", false);
      this.#restoreFocusAfterRender(main, priorFocus, focusViewChanged);
      return;
    }
    if (state.historyStatus === "error") {
      main.replaceChildren(errorPanel("無法讀取觀看紀錄", state.historyError ?? "請重新整理頁面後再試一次。"));
      this.#setPeriodDescription("觀看紀錄恢復後，期間選單會重新開放。", false);
      this.#restoreFocusAfterRender(main, priorFocus, focusViewChanged);
      return;
    }

    const scope = this.#scopeOptions.get(this.#selectedScopeKey);
    if (!scope || analysisScopeKey(scope) !== this.#selectedScopeKey) {
      main.replaceChildren(errorPanel("這段期間暫時無法顯示", "請關閉後重新開啟觀看誌。"));
      this.#restoreFocusAfterRender(main, priorFocus, focusViewChanged);
      return;
    }

    let result: AnalyticsResult;
    try {
      result = analyzeWatchHistory({
        entries: state.entries,
        episodes: state.metadataState.episodes,
        anime: state.metadataState.anime,
        historyCoverage: state.historyCoverage,
        scope,
        asOf: analysisAsOf(state)
      });
    } catch (error) {
      console.error("[ani-gamer-heatmap] 分析所選期間失敗", error);
      main.replaceChildren(errorPanel("這段期間暫時無法分析", "請重新整理頁面後再試一次。"));
      this.#restoreFocusAfterRender(main, priorFocus, focusViewChanged);
      return;
    }

    this.#setPeriodDescription(
      `${result.period.label} · ${formatHalfOpenRange(result.period.effectiveRange.startInclusive, result.period.effectiveRange.endExclusive)} · ${axisDescription(result.scope)}`,
      true
    );

    if (isRecapPlayback(this.#uiState)) {
      const freshDeck = buildRecapDeck(result);
      this.#uiState = reduceRecapUiState<RecapPresentationDeck>(this.#uiState, {
        type: "DATA_UPDATED",
        fingerprint: freshDeck.fingerprint
      });
    }

    if (this.#uiState.kind === "dashboard") {
      main.replaceChildren(renderDashboard({
        result,
        onOpenRecap: () => this.#dispatch({ type: "SWITCH_SURFACE", surface: "recap" })
      }));
      this.#restoreFocusAfterRender(main, priorFocus, focusViewChanged);
      return;
    }

    main.replaceChildren(renderRecapSurface({
      state: this.#uiState,
      result,
      onStart: () => this.#dispatch({ type: "START_RECAP", deck: buildRecapDeck(result) }),
      onNext: () => this.#dispatch({ type: "NEXT" }),
      onPrevious: () => this.#dispatch({ type: "PREVIOUS" }),
      onOpenEvidence: () => this.#dispatch({ type: "OPEN_EVIDENCE" }),
      onCloseEvidence: () => this.#dispatch({ type: "CLOSE_EVIDENCE" }),
      onRestart: () => this.#dispatch({ type: "RESTART" }),
      onDashboard: () => this.#dispatch({ type: "SWITCH_SURFACE", surface: "dashboard" }),
      onAnimationFinished: () => this.#dispatch({ type: "ANIMATION_FINISHED" })
    }));
    this.#restoreFocusAfterRender(main, priorFocus, focusViewChanged);
  }

  #restoreFocusAfterRender(
    main: HTMLElement,
    priorFocus: SemanticFocusSnapshot | undefined,
    focusViewChanged: boolean
  ): void {
    const requestedFocusKey = this.#pendingFocusKey;
    this.#pendingFocusKey = undefined;
    const shouldFocusRecapHeading = shouldAutoFocusRecapHeading(
      focusViewChanged,
      this.#uiState.kind
    );
    queueMicrotask(() => {
      if (this.#main !== main || !main.isConnected) return;
      if (requestedFocusKey) {
        const requested = main.querySelector<HTMLElement>(
          `[data-analysis-focus-key="${requestedFocusKey}"]`
        );
        (requested ?? main.querySelector<HTMLElement>("[data-recap-focus]"))?.focus();
        return;
      }
      if (shouldFocusRecapHeading) {
        main.querySelector<HTMLElement>("[data-recap-focus]")?.focus();
        return;
      }
      if (!focusViewChanged && priorFocus) restoreSemanticFocus(main, priorFocus)?.focus();
    });
  }

  #setPeriodDescription(text: string, announce: boolean): void {
    if (this.#periodDescription) this.#periodDescription.textContent = text;
    if (announce) this.#announce(text);
  }

  #announce(text: string): void {
    if (this.#live && text !== this.#lastAnnouncement) {
      this.#live.textContent = text;
      this.#lastAnnouncement = text;
    }
  }
}

export const handleAnalysisEscapeKey = (
  event: Pick<KeyboardEvent, "key" | "preventDefault" | "stopPropagation">,
  evidenceOpen: boolean,
  closeEvidence: () => void,
  closeAnalysis: () => void
): boolean => {
  if (event.key !== "Escape") return false;
  event.preventDefault();
  event.stopPropagation();
  if (evidenceOpen) closeEvidence();
  else closeAnalysis();
  return true;
};

export const postRecapDispatchFocusKey = (
  current: RecapUiState<RecapPresentationDeck>,
  event: RecapUiEvent<RecapPresentationDeck>,
  next: RecapUiState<RecapPresentationDeck>
): string | undefined => current.kind === "recap-evidence"
  && event.type === "CLOSE_EVIDENCE"
  && next.kind === "recap-chapter"
  && next.chapterId === current.chapterId
  ? RECAP_EVIDENCE_OPENER_FOCUS_KEY
  : undefined;

export type MetadataCacheButtonPresentation = {
  readonly label: string;
  readonly disabled: boolean;
  readonly busy: boolean;
};

export type DebugDownloadButtonPresentation = {
  readonly label: string;
  readonly disabled: boolean;
  readonly busy: boolean;
};

export const debugDownloadButtonPresentation = (
  downloading: boolean,
  clearing: boolean
): DebugDownloadButtonPresentation => ({
  label: downloading ? "正在整理除錯資料…" : "下載除錯資料",
  disabled: downloading || clearing,
  busy: downloading
});

export const metadataCacheButtonPresentation = (
  phase: MetadataState["progress"]["phase"],
  clearing: boolean
): MetadataCacheButtonPresentation => {
  if (clearing) {
    return {
      label: "正在重新整理作品資料…",
      disabled: true,
      busy: true
    };
  }
  return {
    label: phase === "resolving" ? "停止取得並清除作品資料" : "清除作品資料快取",
    disabled: false,
    busy: false
  };
};

export const metadataCacheClearedMessage = (
  removedCount: number,
  restartStarted: boolean
): string => restartStarted
  ? `已清除 ${removedCount} 筆作品資料；正以每秒最多 ${MAX_METADATA_REQUESTS_PER_SECOND} 次重新取得。`
  : `已清除 ${removedCount} 筆作品資料。`;

const renderScopeOptionGroup = (group: AnalysisScopeOptionGroup): HTMLOptGroupElement => {
  const node = element("optgroup");
  node.label = group.label;
  for (const item of group.options) {
    const option = element("option");
    option.value = item.key;
    option.textContent = item.label;
    node.append(option);
  }
  return node;
};

const periodIdentity = (period: PeriodDefinition): string => {
  switch (period.kind) {
    case "rolling-days": return `rolling:${period.days}`;
    case "calendar-month": return `month:${period.year}-${period.month}`;
    case "calendar-season": return `season:${period.year}-${period.season}`;
    case "calendar-year": return `year:${period.year}`;
  }
};

const analysisAsOf = (state: AnalysisViewState): Date => {
  const value = state.historyCoverage.coveredThrough;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("觀看紀錄的資料時間無效");
  }
  return new Date(value.getTime());
};

const metadataIsSettled = (metadata: MetadataState, entryCount: number): boolean =>
  metadata.progress.phase === "complete"
  || (entryCount === 0 && metadata.progress.phase === "idle");

const axisDescription = (scope: AnalysisScope): string => scope.axis === "released-at"
  ? "依單集實際上架時間"
  : scope.dayBoundaryMode === "thirty-hour"
    ? "依觀看時間（30 小時制）"
    : "依觀看時間（24 小時制）";

const isRecapPlayback = (state: RecapUiState): boolean => state.kind === "recap-chapter"
  || state.kind === "recap-evidence"
  || state.kind === "recap-outro";

const statusPanel = (title: string, message: string): HTMLElement => {
  const panel = element("section", "ani-analysis-status-panel");
  panel.append(
    textElement("h3", "ani-analysis-status-title", title),
    textElement("p", "ani-analysis-status-copy", message)
  );
  return panel;
};

const errorPanel = (title: string, message: string): HTMLElement => {
  const panel = statusPanel(title, message);
  panel.classList.add("ani-analysis-error-panel");
  return panel;
};

const getFocusableElements = (root: HTMLElement): HTMLElement[] => Array.from(
  root.querySelectorAll<HTMLElement>(
    "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex='-1'])"
  )
).filter((node) => !node.hidden && node.getAttribute("aria-hidden") !== "true" && node.offsetParent !== null);

export const getAnalysisFocusTrapRoot = (
  overlay: HTMLElement,
  main: HTMLElement | undefined,
  evidenceOpen: boolean
): HTMLElement => evidenceOpen
  ? main?.querySelector<HTMLElement>(".ani-recap-evidence-panel") ?? overlay
  : overlay;

export const resolveCyclicFocusTarget = <T>(
  focusable: readonly T[],
  active: T | undefined,
  shiftKey: boolean
): T | undefined => {
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return undefined;
  if (!active || !focusable.includes(active)) return shiftKey ? last : first;
  if (shiftKey && active === first) return last;
  if (!shiftKey && active === last) return first;
  return undefined;
};

type SemanticFocusSnapshot = {
  readonly identity: string;
  readonly ordinal: number;
};

const SEMANTIC_FOCUS_CANDIDATE_SELECTOR = [
  "button",
  "[href]",
  "input",
  "select",
  "textarea",
  "summary",
  "[tabindex]",
  "[data-recap-focus]"
].join(", ");

const semanticFocusCandidates = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(SEMANTIC_FOCUS_CANDIDATE_SELECTOR));

export const semanticFocusIdentity = (node: HTMLElement): string => {
  const explicit = node.dataset.analysisFocusKey;
  if (explicit) return `explicit:${explicit}`;
  if (node.id) return `id:${node.id}`;

  const data = Object.entries(node.dataset)
    .filter(([key]) => key !== "transition")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(";");
  const classes = Array.from(node.classList).sort().join(".");
  const label = node.getAttribute("aria-label")
    ?? node.getAttribute("title")
    ?? node.textContent?.replace(/\s+/g, " ").trim()
    ?? "";
  return [
    node.tagName.toLowerCase(),
    node.getAttribute("role") ?? "",
    node.getAttribute("name") ?? "",
    node.getAttribute("type") ?? "",
    classes,
    data,
    label
  ].join("|");
};

const captureSemanticFocus = (root: HTMLElement): SemanticFocusSnapshot | undefined => {
  const active = deepestActiveElement();
  if (!active || !root.contains(active)) return undefined;
  const identity = semanticFocusIdentity(active);
  const matches = semanticFocusCandidates(root).filter((candidate) => semanticFocusIdentity(candidate) === identity);
  const ordinal = matches.indexOf(active);
  return ordinal < 0 ? undefined : { identity, ordinal };
};

const restoreSemanticFocus = (
  root: HTMLElement,
  snapshot: SemanticFocusSnapshot
): HTMLElement | undefined => resolveSemanticFocusTarget(semanticFocusCandidates(root), snapshot);

export const resolveSemanticFocusTarget = (
  candidates: readonly HTMLElement[],
  snapshot: SemanticFocusSnapshot
): HTMLElement | undefined => candidates
  .filter((candidate) => semanticFocusIdentity(candidate) === snapshot.identity)
  .at(snapshot.ordinal);

export const analysisFocusViewKey = (state: RecapUiState): string => {
  switch (state.kind) {
    case "closed": return "closed";
    case "dashboard": return "dashboard";
    case "recap-intro": return "recap-intro";
    case "recap-chapter": return `recap-chapter:${state.chapterId}`;
    case "recap-evidence": return `recap-evidence:${state.chapterId}`;
    case "recap-outro": return "recap-outro";
  }
};

export const shouldAutoFocusRecapHeading = (
  focusViewChanged: boolean,
  stateKind: RecapUiState["kind"]
): boolean => focusViewChanged && stateKind !== "dashboard" && stateKind !== "closed";

const restoreAnalysisOpenerFocus = (opener: HTMLElement | undefined): void => {
  selectAnalysisFocusRestoreTarget(
    opener,
    document.getElementById(ANALYSIS_TRIGGER_ID)
  )?.focus();
};

export const selectAnalysisFocusRestoreTarget = <T extends { readonly isConnected: boolean }>(
  opener: T | null | undefined,
  bridge: T | null | undefined
): T | undefined => opener?.isConnected ? opener : bridge?.isConnected ? bridge : undefined;

const deepestActiveElement = (): HTMLElement | undefined => {
  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active instanceof HTMLElement ? active : undefined;
};

const isolateAnalysisHost = (host: HTMLElement): void => {
  for (const [property, value] of [
    ["all", "initial"],
    ["display", "block"],
    ["position", "fixed"],
    ["inset", "0"],
    ["z-index", "2147483647"],
    ["isolation", "isolate"],
    ["margin", "0"],
    ["padding", "0"],
    ["border", "0"],
    ["visibility", "visible"],
    ["opacity", "1"],
    ["pointer-events", "auto"],
    ["direction", "ltr"],
    ["writing-mode", "horizontal-tb"],
    ["color-scheme", "light"]
  ] as const) host.style.setProperty(property, value, "important");
};

const restoreStyleProperty = (
  style: CSSStyleDeclaration,
  property: string,
  value: string,
  priority: string
): void => {
  if (value) style.setProperty(property, value, priority);
  else style.removeProperty(property);
};

export const analysisHostGuardCss = `
#${ANALYSIS_OVERLAY_ID}::before,
#${ANALYSIS_OVERLAY_ID}::after {
  content: none !important;
  display: none !important;
}
`;

export const analysisCss = `
:host {
  all: initial !important;
  display: block !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483647 !important;
  isolation: isolate !important;
  direction: ltr !important;
  color-scheme: light !important;
}
:host::before,
:host::after { content: none !important; display: none !important; }
.ani-analysis-overlay,
.ani-analysis-overlay *,
.ani-analysis-overlay *::before,
.ani-analysis-overlay *::after { box-sizing: border-box; }
.ani-analysis-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: #f3f6fa;
  color: #0f172a;
  font-family: "Noto Sans TC", "Microsoft JhengHei", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.5;
  text-align: left;
}
.ani-analysis-shell { display: grid; grid-template-rows: auto auto minmax(0, 1fr); height: 100%; min-height: 100dvh; }
.ani-analysis-shell[data-playback="true"] { grid-template-rows: auto minmax(0, 1fr); }
.ani-analysis-header { position: sticky; top: 0; z-index: 20; border-bottom: 1px solid rgba(203, 213, 225, .8); background: rgba(248, 250, 252, .9); padding: max(12px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) 12px max(18px, env(safe-area-inset-left)); backdrop-filter: blur(18px); }
.ani-analysis-header-inner, .ani-analysis-controls-inner, .ani-analysis-main { width: min(100%, 1120px); margin-inline: auto; }
.ani-analysis-header-inner { display: grid; grid-template-columns: minmax(0, 1fr) max-content 42px; align-items: center; gap: 18px; }
.ani-analysis-brand { min-width: 0; }
.ani-analysis-title { margin: 0; color: #0f172a; font-size: clamp(19px, 2vw, 24px); font-weight: 900; letter-spacing: -.03em; line-height: 1.2; }
.ani-analysis-title:focus { outline: none; }
.ani-analysis-subtitle { overflow: hidden; margin: 3px 0 0; color: #64748b; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.ani-analysis-metadata-progress { display: grid; gap: 6px; width: min(100%, 1120px); margin: 10px auto 0; }
.ani-analysis-metadata-progress[hidden] { display: none; }
.ani-analysis-metadata-progress-header { display: flex; justify-content: space-between; gap: 16px; color: #334155; font-size: 10px; }
.ani-analysis-metadata-progress-header strong { color: #0f172a; font-size: 11px; }
.ani-analysis-metadata-progress-bar { appearance: none; display: block; width: 100%; height: 6px; overflow: hidden; border: 0; border-radius: 999px; background: #dbe3ec; }
.ani-analysis-metadata-progress-bar::-webkit-progress-bar { border-radius: 999px; background: #dbe3ec; }
.ani-analysis-metadata-progress-bar::-webkit-progress-value { border-radius: 999px; background: linear-gradient(90deg, #38bdf8, #0284c7); transition: width 180ms ease-out; }
.ani-analysis-metadata-progress-bar::-moz-progress-bar { border-radius: 999px; background: linear-gradient(90deg, #38bdf8, #0284c7); }
.ani-analysis-surface-nav, .ani-analysis-axis-control { display: inline-flex; align-items: center; border: 1px solid #dbe3ec; border-radius: 999px; background: #e9eef5; padding: 3px; }
.ani-analysis-surface-button, .ani-analysis-axis-button { min-height: 32px; border: 0; border-radius: 999px; background: transparent; color: #64748b; cursor: pointer; font: inherit; font-size: 12px; font-weight: 850; padding: 6px 13px; }
.ani-analysis-surface-button[aria-current="page"], .ani-analysis-axis-button[aria-pressed="true"] { background: #fff; color: #0f172a; box-shadow: 0 2px 8px rgba(15, 23, 42, .1); }
.ani-analysis-close { display: grid; place-items: center; width: 42px; height: 42px; border: 1px solid #cbd5e1; border-radius: 50%; background: #fff; color: #0f172a; cursor: pointer; font: inherit; font-size: 25px; line-height: 1; }
.ani-analysis-controls { border-bottom: 1px solid rgba(203, 213, 225, .7); background: rgba(243, 246, 250, .94); padding: 10px max(18px, env(safe-area-inset-right)) 10px max(18px, env(safe-area-inset-left)); }
.ani-analysis-controls[hidden] { display: none; }
.ani-analysis-controls-inner { display: grid; grid-template-columns: max-content minmax(190px, 280px) minmax(0, 1fr) max-content; align-items: center; gap: 10px 14px; }
.ani-analysis-period-field { display: grid; grid-template-columns: max-content minmax(0, 1fr); align-items: center; gap: 8px; }
.ani-analysis-period-label { color: #475569; font-size: 11px; font-weight: 900; }
.ani-analysis-select { width: 100%; min-height: 38px; border: 1px solid #94a3b8; border-radius: 10px; background: #fff; color: #0f172a; font: inherit; font-size: 12px; padding: 7px 30px 7px 10px; }
.ani-analysis-period-description { min-width: 0; color: #64748b; font-size: 10px; line-height: 1.45; }
.ani-analysis-cache-area { position: relative; display: flex; align-items: center; gap: 7px; }
.ani-analysis-cache-button, .ani-analysis-debug-button { min-height: 36px; border: 1px solid #cbd5e1; border-radius: 999px; background: #fff; color: #475569; cursor: pointer; font: inherit; font-size: 10px; font-weight: 850; padding: 7px 12px; white-space: nowrap; }
.ani-analysis-debug-button { border-color: #94a3b8; color: #334155; }
.ani-analysis-cache-button:disabled, .ani-analysis-debug-button:disabled { cursor: not-allowed; opacity: .58; }
.ani-analysis-cache-feedback { position: absolute; top: calc(100% + 8px); right: 0; z-index: 10; width: min(320px, 80vw); border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; box-shadow: 0 12px 30px rgba(15, 23, 42, .15); color: #475569; font-size: 10px; padding: 9px 11px; }
.ani-analysis-cache-feedback[data-tone="error"] { border-color: #fecaca; color: #b91c1c; }
.ani-analysis-main { display: grid; padding: 24px 20px max(54px, env(safe-area-inset-bottom)); }
.ani-analysis-main--recap { width: 100%; min-height: 0; padding: 0; }
.ani-analysis-status-panel { display: grid; place-items: center; align-content: center; min-height: 52vh; border: 1px solid #e2e8f0; border-radius: 20px; background: #fff; padding: 32px; text-align: center; }
.ani-analysis-status-title { margin: 0; color: #0f172a; font-size: 22px; }
.ani-analysis-status-copy { max-width: 560px; margin: 8px 0 0; color: #64748b; font-size: 13px; }
.ani-analysis-error-panel { border-color: #fecaca; background: #fff7f7; }
.ani-analysis-visually-hidden { position: absolute !important; overflow: hidden !important; width: 1px !important; height: 1px !important; clip: rect(0 0 0 0) !important; clip-path: inset(50%) !important; white-space: nowrap !important; }
button:focus-visible, select:focus-visible, summary:focus-visible { outline: 3px solid #38bdf8; outline-offset: 2px; }
${dashboardCss}
${recapCss}
@media (max-width: 760px) {
  .ani-analysis-header-inner { grid-template-columns: minmax(0, 1fr) 42px; }
  .ani-analysis-surface-nav { grid-row: 2; grid-column: 1 / -1; justify-self: stretch; }
  .ani-analysis-surface-button { flex: 1; }
  .ani-analysis-close { grid-column: 2; grid-row: 1; }
  .ani-analysis-metadata-progress-header { align-items: flex-start; flex-direction: column; gap: 2px; }
  .ani-analysis-controls-inner { grid-template-columns: 1fr; }
  .ani-analysis-axis-control { justify-self: stretch; }
  .ani-analysis-axis-button { flex: 1; }
  .ani-analysis-period-description { order: 3; }
  .ani-analysis-cache-area { order: 4; display: grid; grid-template-columns: 1fr 1fr; }
  .ani-analysis-cache-button, .ani-analysis-debug-button { width: 100%; white-space: normal; }
  .ani-analysis-cache-feedback { left: 0; right: auto; }
  .ani-analysis-main { padding-inline: 12px; }
  .ani-analysis-main--recap { padding: 0; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
}
@media (forced-colors: active) {
  .ani-analysis-surface-button[aria-current="page"], .ani-analysis-axis-button[aria-pressed="true"] { border: 1px solid CanvasText; }
}
`;
