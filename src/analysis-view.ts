import { dashboardCss, renderDashboard } from "./analysis-dashboard";
import {
  formatCompactDuration,
  formatDuration,
  formatHalfOpenRange,
  formatInteger
} from "./analysis-format";
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
  #settingsButton: HTMLButtonElement | undefined;
  #settingsPopover: HTMLElement | undefined;
  #settingsOpen = false;
  #isClosing = false;
  #pendingReveal = false;
  #renderedSurface: "dashboard" | "recap" | undefined;
  #countUpFrames: number[] = [];
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
    if (!this.isOpen || this.#isClosing) return;
    this.#syncScopeOptions();
    this.#syncCacheButton();
    this.#syncMetadataProgress();
    this.#render();
  }

  open(): void {
    if (this.#isClosing) this.#finalizeClose({ restoreFocus: false });
    if (this.#host && !this.#host.isConnected) this.#finalizeClose({ restoreFocus: false });
    if (this.isOpen) {
      this.#heading?.focus();
      return;
    }

    this.#opener = deepestActiveElement();
    this.#pendingReveal = true;
    this.#renderedSurface = undefined;
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

    const tools = element("div", "ani-analysis-tools");
    const settingsButton = createButton("ani-analysis-settings-button", "⋯");
    settingsButton.setAttribute("aria-label", "資料與除錯設定");
    settingsButton.setAttribute("aria-haspopup", "true");
    settingsButton.setAttribute("aria-expanded", "false");
    settingsButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.#toggleSettings();
    });
    const closeButton = createButton("ani-analysis-close", "×");
    closeButton.setAttribute("aria-label", "關閉我的觀看誌");
    closeButton.addEventListener("click", () => this.close());
    tools.append(settingsButton, closeButton);
    headerInner.append(brand, surfaceNav, tools);

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

    const settingsPopover = element("div", "ani-analysis-settings-popover");
    settingsPopover.hidden = true;
    settingsPopover.setAttribute("role", "group");
    settingsPopover.setAttribute("aria-label", "資料與除錯");
    const debugButton = createButton("ani-analysis-debug-button", "下載除錯資料");
    debugButton.setAttribute("aria-describedby", CACHE_FEEDBACK_ID);
    debugButton.addEventListener("click", () => void this.#downloadDebugData());
    const cacheButton = createButton("ani-analysis-cache-button", "清除作品資料快取");
    cacheButton.setAttribute("aria-describedby", CACHE_FEEDBACK_ID);
    cacheButton.addEventListener("click", () => void this.#clearMetadataCache());
    const cacheFeedback = element("div", "ani-analysis-cache-feedback");
    cacheFeedback.id = CACHE_FEEDBACK_ID;
    cacheFeedback.hidden = true;
    settingsPopover.append(
      textElement("p", "ani-analysis-settings-title", "資料與除錯"),
      debugButton,
      cacheButton,
      cacheFeedback
    );
    header.append(headerInner, metadataProgress, settingsPopover);

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
      this.#pendingReveal = true;
      this.#render();
    });
    periodField.append(periodLabel, select);

    const periodDescription = element("div", "ani-analysis-period-description");
    controlsInner.append(axisControl, periodField, periodDescription);
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
    this.#settingsButton = settingsButton;
    this.#settingsPopover = settingsPopover;

    overlay.addEventListener("keydown", this.#handleKeydown);
    overlay.addEventListener("click", this.#handleOverlayClick);
    document.body.append(host);
    this.#lockBackground();
    this.#syncScopeOptions();
    this.#syncCacheButton();
    this.#syncMetadataProgress();
    this.#render();
    queueMicrotask(() => heading.focus());
  }

  close(options: { readonly restoreFocus?: boolean } = {}): void {
    if (!this.#host || this.#isClosing) return;
    const overlay = this.#overlay;
    const shell = this.#shell;
    if (prefersReducedMotion() || !overlay || !shell) {
      this.#finalizeClose(options);
      return;
    }

    this.#isClosing = true;
    this.#closeSettings();
    overlay.dataset.phase = "leaving";
    let settled = false;
    const finalize = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      shell.removeEventListener("animationend", onAnimationEnd);
      this.#finalizeClose(options);
    };
    // animationend bubbles from descendants; only the shell's own exit animation ends the close.
    const onAnimationEnd = (event: AnimationEvent): void => {
      if (event.target === shell) finalize();
    };
    const timer = window.setTimeout(finalize, 420);
    shell.addEventListener("animationend", onAnimationEnd);
  }

  #finalizeClose(options: { readonly restoreFocus?: boolean } = {}): void {
    if (!this.#host) return;
    this.#isClosing = false;
    this.#settingsOpen = false;
    for (const id of this.#countUpFrames) cancelAnimationFrame(id);
    this.#countUpFrames = [];
    this.#uiState = reduceRecapUiState<RecapPresentationDeck>(this.#uiState, { type: "CLOSE" });
    this.#backgroundObserver?.disconnect();
    this.#backgroundObserver = undefined;
    this.#overlay?.removeEventListener("keydown", this.#handleKeydown);
    this.#overlay?.removeEventListener("click", this.#handleOverlayClick);
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
    this.#settingsButton = undefined;
    this.#settingsPopover = undefined;
    this.#renderedSurface = undefined;
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
    this.#isClosing = false;
    this.#finalizeClose({ restoreFocus: false });
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
      this.#pendingReveal = true;
      this.#syncScopeOptions();
      this.#render();
    });
    return button;
  }

  #dispatch(event: RecapUiEvent<RecapPresentationDeck>): void {
    const next = reduceRecapUiState<RecapPresentationDeck>(this.#uiState, event);
    if (next === this.#uiState) return;
    if (next.kind === "dashboard") this.#pendingReveal = true;
    this.#pendingFocusKey = postRecapDispatchFocusKey(this.#uiState, event, next);
    this.#uiState = next;
    this.#render();
  }

  #toggleSettings(): void {
    if (this.#settingsOpen) this.#closeSettings();
    else this.#openSettings();
  }

  #openSettings(): void {
    if (!this.#settingsPopover || !this.#settingsButton || this.#settingsOpen) return;
    this.#settingsOpen = true;
    this.#settingsPopover.hidden = false;
    this.#settingsButton.setAttribute("aria-expanded", "true");
  }

  #closeSettings(): void {
    if (!this.#settingsOpen) return;
    this.#settingsOpen = false;
    if (this.#settingsPopover) this.#settingsPopover.hidden = true;
    this.#settingsButton?.setAttribute("aria-expanded", "false");
  }

  readonly #handleOverlayClick = (event: MouseEvent): void => {
    if (!this.#settingsOpen) return;
    const target = event.target;
    if (target instanceof Node && (
      this.#settingsPopover?.contains(target) === true
      || this.#settingsButton?.contains(target) === true
    )) return;
    this.#closeSettings();
  };

  readonly #handleKeydown = (event: KeyboardEvent): void => {
    if (this.#isClosing) return;
    if (event.key === "Escape" && this.#settingsOpen) {
      event.preventDefault();
      event.stopPropagation();
      this.#closeSettings();
      this.#settingsButton?.focus();
      return;
    }
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
        this.#finalizeClose({ restoreFocus: false });
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
    if (this.#axisControl) this.#axisControl.dataset.active = this.#selectedAxis;
    for (const node of this.#axisControl?.querySelectorAll<HTMLButtonElement>("[data-axis]") ?? []) {
      const selected = node.dataset.axis === this.#selectedAxis;
      node.setAttribute("aria-pressed", String(selected));
    }
  }

  #syncSurfaceButtons(): void {
    const surface = this.#uiState.kind === "dashboard" ? "dashboard" : "recap";
    if (this.#surfaceNav) this.#surfaceNav.dataset.active = surface;
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
    for (const id of this.#countUpFrames) cancelAnimationFrame(id);
    this.#countUpFrames = [];
    const priorFocus = captureSemanticFocus(main);
    const focusViewKey = analysisFocusViewKey(this.#uiState);
    const previousFocusViewKey = this.#renderedFocusViewKey;
    const focusViewChanged = focusViewKey !== previousFocusViewKey;
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
      const reveal = this.#pendingReveal && !prefersReducedMotion();
      this.#pendingReveal = false;
      const dashboard = renderDashboard({
        result,
        onOpenRecap: () => this.#dispatch({ type: "SWITCH_SURFACE", surface: "recap" }),
        reveal
      });
      this.#applySurfaceEnter(dashboard, "dashboard");
      main.replaceChildren(dashboard);
      if (reveal) this.#runCountUp(main);
      this.#renderedSurface = "dashboard";
      this.#restoreFocusAfterRender(main, priorFocus, focusViewChanged);
      return;
    }

    const recap = renderRecapSurface({
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
    });
    this.#applySurfaceEnter(recap, "recap");
    main.replaceChildren(recap);
    // Chapter and intro numerals count up once per view; skip evidence round-trips,
    // which re-render the same chapter underneath the closing panel.
    if (
      focusViewChanged
      && this.#uiState.kind !== "recap-evidence"
      && !previousFocusViewKey.startsWith("recap-evidence")
    ) this.#runCountUp(main);
    this.#renderedSurface = "recap";
    this.#restoreFocusAfterRender(main, priorFocus, focusViewChanged);
  }

  #applySurfaceEnter(root: HTMLElement, surface: "dashboard" | "recap"): void {
    if (prefersReducedMotion()) return;
    // The dashboard's own reveal stagger is its entrance; only the recap surface,
    // which has no per-item reveal, needs a whole-surface "dim the lights" transition.
    if (surface === "recap" && this.#renderedSurface && this.#renderedSurface !== surface) {
      root.dataset.surfaceEnter = surface;
    }
  }

  #runCountUp(main: HTMLElement): void {
    for (const id of this.#countUpFrames) cancelAnimationFrame(id);
    this.#countUpFrames = [];
    if (prefersReducedMotion()) return;
    for (const node of main.querySelectorAll<HTMLElement>("[data-count-to]")) {
      const target = Number(node.dataset.countTo);
      if (Number.isFinite(target)) this.#animateCountUp(node, target);
    }
  }

  #animateCountUp(node: HTMLElement, target: number): void {
    const format = countUpFormatter(node.dataset.countFormat);
    if (target <= 0) {
      node.textContent = format(target);
      return;
    }
    node.textContent = format(0);
    const duration = 720;
    let startTs: number | undefined;
    const step = (ts: number): void => {
      startTs ??= ts;
      const progress = Math.min(1, (ts - startTs) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = format(Math.round(target * eased));
      if (progress < 1) this.#countUpFrames.push(requestAnimationFrame(step));
    };
    this.#countUpFrames.push(requestAnimationFrame(step));
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

const countUpFormatter = (format: string | undefined): (value: number) => string => {
  switch (format) {
    case "duration": return formatDuration;
    case "compact-duration": return formatCompactDuration;
    default: return formatInteger;
  }
};

const prefersReducedMotion = (): boolean => typeof window !== "undefined"
  && typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  --ani-bg: #f4f6fb;
  --ani-surface: #ffffff;
  --ani-surface-sunken: #f5f8fc;
  --ani-surface-veil: rgba(249, 251, 253, .84);
  --ani-line: #e5e9f0;
  --ani-line-strong: #cbd5e1;
  --ani-ink: #0d1526;
  --ani-ink-2: #46536b;
  --ani-ink-3: #6b7688;
  --ani-ink-4: #97a1b3;
  --ani-accent: #0284c7;
  --ani-accent-bright: #0ea5e9;
  --ani-accent-ink: #075985;
  --ani-accent-tint: #e0f2fe;
  --ani-hot: #f97316;
  --ani-hot-ink: #c2410c;
  --ani-hot-tint: #fff1e6;
  --ani-brand: linear-gradient(135deg, #0d1526 0%, #172554 52%, #0e4b57 100%);
  --ani-r-sm: 10px;
  --ani-r-md: 14px;
  --ani-r-lg: 20px;
  --ani-r-pill: 999px;
  --ani-shadow-1: 0 1px 2px rgba(15, 23, 42, .04), 0 10px 24px rgba(15, 23, 42, .06);
  --ani-shadow-2: 0 2px 6px rgba(15, 23, 42, .06), 0 18px 42px rgba(15, 23, 42, .1);
  --ani-shadow-3: 0 14px 38px rgba(15, 23, 42, .18);
  --ani-ease: cubic-bezier(.2, .8, .2, 1);
  --ani-ease-out: cubic-bezier(.16, 1, .3, 1);
  --ani-dur-1: 140ms;
  --ani-dur-2: 240ms;
  --ani-dur-3: 380ms;
  --ani-dur-4: 520ms;
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
  background: var(--ani-bg);
  color: var(--ani-ink);
  font-family: "Noto Sans TC", "Microsoft JhengHei", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.5;
  text-align: left;
  animation: ani-analysis-overlay-in var(--ani-dur-3) var(--ani-ease) both;
}
.ani-analysis-overlay[data-phase="leaving"] { animation: ani-analysis-overlay-out var(--ani-dur-2) var(--ani-ease) both; }
.ani-analysis-shell { display: grid; grid-template-rows: auto auto minmax(0, 1fr); height: 100%; min-height: 100dvh; animation: ani-analysis-shell-in var(--ani-dur-3) var(--ani-ease-out) both; }
.ani-analysis-overlay[data-phase="leaving"] .ani-analysis-shell { animation: ani-analysis-shell-out var(--ani-dur-2) var(--ani-ease) both; }
.ani-analysis-shell[data-playback="true"] { grid-template-rows: auto minmax(0, 1fr); }
.ani-analysis-header { position: sticky; top: 0; z-index: 20; border-bottom: 1px solid var(--ani-line); background: var(--ani-surface-veil); padding: max(12px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) 12px max(18px, env(safe-area-inset-left)); backdrop-filter: blur(18px); }
.ani-analysis-header-inner, .ani-analysis-controls-inner, .ani-analysis-main { width: min(100%, 1120px); margin-inline: auto; }
.ani-analysis-header-inner { display: grid; grid-template-columns: minmax(0, 1fr) max-content max-content; align-items: center; gap: 16px; }
.ani-analysis-brand { min-width: 0; }
.ani-analysis-title { margin: 0; color: var(--ani-ink); font-size: clamp(19px, 2vw, 24px); font-weight: 900; letter-spacing: -.03em; line-height: 1.2; }
.ani-analysis-title:focus { outline: none; }
.ani-analysis-subtitle { overflow: hidden; margin: 3px 0 0; color: var(--ani-ink-3); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.ani-analysis-tools { display: inline-flex; align-items: center; gap: 8px; }
.ani-analysis-metadata-progress { display: grid; gap: 6px; width: min(100%, 1120px); margin: 12px auto 2px; }
.ani-analysis-metadata-progress[hidden] { display: none; }
.ani-analysis-metadata-progress-header { display: flex; justify-content: space-between; gap: 16px; color: var(--ani-ink-2); font-size: 10px; }
.ani-analysis-metadata-progress-header strong { color: var(--ani-ink); font-size: 11px; font-weight: 800; }
.ani-analysis-metadata-progress-bar { appearance: none; display: block; width: 100%; height: 6px; overflow: hidden; border: 0; border-radius: var(--ani-r-pill); background: #dbe3ec; }
.ani-analysis-metadata-progress-bar::-webkit-progress-bar { border-radius: var(--ani-r-pill); background: #dbe3ec; }
.ani-analysis-metadata-progress-bar::-webkit-progress-value { border-radius: var(--ani-r-pill); background: linear-gradient(90deg, var(--ani-accent-bright), var(--ani-accent)); transition: width 180ms var(--ani-ease-out); }
.ani-analysis-metadata-progress-bar::-moz-progress-bar { border-radius: var(--ani-r-pill); background: linear-gradient(90deg, var(--ani-accent-bright), var(--ani-accent)); }
.ani-analysis-surface-nav, .ani-analysis-axis-control { position: relative; display: grid; grid-template-columns: 1fr 1fr; align-items: center; border: 1px solid var(--ani-line); border-radius: var(--ani-r-pill); background: #e7edf4; padding: 3px; }
.ani-analysis-surface-nav { width: 200px; }
.ani-analysis-axis-control { width: 236px; justify-self: end; }
.ani-analysis-surface-nav::before, .ani-analysis-axis-control::before { content: ""; position: absolute; z-index: 0; inset: 3px auto 3px 3px; width: calc(50% - 3px); border-radius: var(--ani-r-pill); background: var(--ani-surface); box-shadow: 0 2px 8px rgba(15, 23, 42, .12); transition: transform var(--ani-dur-2) var(--ani-ease); }
.ani-analysis-surface-nav[data-active="recap"]::before, .ani-analysis-axis-control[data-active="released-at"]::before { transform: translateX(100%); }
.ani-analysis-surface-button, .ani-analysis-axis-button { position: relative; z-index: 1; min-height: 32px; border: 0; border-radius: var(--ani-r-pill); background: transparent; color: var(--ani-ink-3); cursor: pointer; font: inherit; font-size: 12px; font-weight: 850; padding: 6px 10px; text-align: center; white-space: nowrap; transition: color var(--ani-dur-1) var(--ani-ease); }
.ani-analysis-surface-button[aria-current="page"], .ani-analysis-axis-button[aria-pressed="true"] { color: var(--ani-ink); }
.ani-analysis-settings-button, .ani-analysis-close { display: grid; place-items: center; width: 40px; height: 40px; border: 1px solid var(--ani-line-strong); border-radius: 50%; background: var(--ani-surface); color: var(--ani-ink); cursor: pointer; font: inherit; line-height: 1; padding: 0; transition: background var(--ani-dur-1) var(--ani-ease), color var(--ani-dur-1) var(--ani-ease), border-color var(--ani-dur-1) var(--ani-ease); }
.ani-analysis-settings-button { color: var(--ani-ink-2); font-size: 22px; }
.ani-analysis-close { font-size: 24px; }
.ani-analysis-settings-button:hover, .ani-analysis-close:hover { background: var(--ani-surface-sunken); color: var(--ani-ink); }
.ani-analysis-settings-button[aria-expanded="true"] { background: var(--ani-accent-tint); border-color: var(--ani-accent-bright); color: var(--ani-accent-ink); }
.ani-analysis-settings-popover { position: absolute; z-index: 30; top: calc(100% - 4px); right: max(18px, env(safe-area-inset-right)); display: grid; gap: 8px; width: min(300px, calc(100vw - 32px)); border: 1px solid var(--ani-line); border-radius: var(--ani-r-md); background: var(--ani-surface); box-shadow: var(--ani-shadow-3); padding: 14px; animation: ani-pop-in var(--ani-dur-2) var(--ani-ease-out) both; }
.ani-analysis-settings-popover[hidden] { display: none; }
.ani-analysis-settings-title { margin: 0 0 2px; color: var(--ani-ink-3); font-size: 10px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
.ani-analysis-cache-button, .ani-analysis-debug-button { min-height: 38px; border: 1px solid var(--ani-line-strong); border-radius: var(--ani-r-sm); background: var(--ani-surface); color: var(--ani-ink-2); cursor: pointer; font: inherit; font-size: 12px; font-weight: 800; padding: 8px 12px; text-align: left; transition: background var(--ani-dur-1) var(--ani-ease); }
.ani-analysis-cache-button:hover, .ani-analysis-debug-button:hover { background: var(--ani-surface-sunken); }
.ani-analysis-cache-button:disabled, .ani-analysis-debug-button:disabled { cursor: not-allowed; opacity: .58; }
.ani-analysis-cache-feedback { border: 1px solid var(--ani-line); border-radius: var(--ani-r-sm); background: var(--ani-surface-sunken); color: var(--ani-ink-2); font-size: 11px; line-height: 1.5; padding: 9px 11px; }
.ani-analysis-cache-feedback[data-tone="error"] { border-color: #fecaca; background: #fff5f5; color: #b91c1c; }
.ani-analysis-controls { border-bottom: 1px solid var(--ani-line); background: var(--ani-surface-veil); padding: 12px max(18px, env(safe-area-inset-right)) 12px max(18px, env(safe-area-inset-left)); }
.ani-analysis-controls[hidden] { display: none; }
.ani-analysis-controls-inner { display: grid; grid-template-columns: max-content minmax(200px, 300px) minmax(0, 1fr); align-items: center; gap: 10px 16px; }
.ani-analysis-period-field { display: grid; grid-template-columns: max-content minmax(0, 1fr); align-items: center; gap: 8px; }
.ani-analysis-period-label { color: var(--ani-ink-2); font-size: 11px; font-weight: 900; }
.ani-analysis-select { width: 100%; min-height: 38px; border: 1px solid var(--ani-line-strong); border-radius: var(--ani-r-sm); background: var(--ani-surface); color: var(--ani-ink); font: inherit; font-size: 12px; padding: 7px 30px 7px 12px; cursor: pointer; }
.ani-analysis-period-description { min-width: 0; color: var(--ani-ink-3); font-size: 10px; line-height: 1.45; }
.ani-analysis-main { display: grid; padding: 26px 20px max(54px, env(safe-area-inset-bottom)); }
.ani-analysis-main--recap { width: 100%; min-height: 0; padding: 0; background: #060a14; }
.ani-analysis-status-panel { display: grid; place-items: center; align-content: center; min-height: 52vh; border: 1px solid var(--ani-line); border-radius: var(--ani-r-lg); background: var(--ani-surface); box-shadow: var(--ani-shadow-1); padding: 32px; text-align: center; }
.ani-analysis-status-title { margin: 0; color: var(--ani-ink); font-size: 22px; font-weight: 800; }
.ani-analysis-status-copy { max-width: 560px; margin: 8px 0 0; color: var(--ani-ink-3); font-size: 13px; }
.ani-analysis-error-panel { border-color: #fecaca; background: #fff7f7; }
.ani-analysis-visually-hidden { position: absolute !important; overflow: hidden !important; width: 1px !important; height: 1px !important; clip: rect(0 0 0 0) !important; clip-path: inset(50%) !important; white-space: nowrap !important; }
[data-surface-enter="recap"] { animation: ani-enter-deepen var(--ani-dur-4) var(--ani-ease-out) both; }
button:focus-visible, select:focus-visible, summary:focus-visible { outline: 3px solid var(--ani-accent-bright); outline-offset: 2px; }
@keyframes ani-analysis-overlay-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes ani-analysis-overlay-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes ani-analysis-shell-in { from { opacity: 0; transform: translateY(14px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes ani-analysis-shell-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(10px) scale(.99); } }
@keyframes ani-pop-in { from { opacity: 0; transform: translateY(-6px) scale(.98); } to { opacity: 1; transform: none; } }
@keyframes ani-enter-deepen { from { opacity: 0; transform: translateY(16px) scale(.99); } to { opacity: 1; transform: none; } }
${dashboardCss}
${recapCss}
@media (max-width: 760px) {
  .ani-analysis-header-inner { grid-template-columns: minmax(0, 1fr) max-content; }
  .ani-analysis-tools { grid-column: 2; grid-row: 1; }
  .ani-analysis-surface-nav { grid-row: 2; grid-column: 1 / -1; width: auto; justify-self: stretch; }
  .ani-analysis-metadata-progress-header { align-items: flex-start; flex-direction: column; gap: 2px; }
  .ani-analysis-controls-inner { grid-template-columns: 1fr; }
  .ani-analysis-axis-control { width: auto; justify-self: stretch; }
  .ani-analysis-period-description { order: 3; }
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
