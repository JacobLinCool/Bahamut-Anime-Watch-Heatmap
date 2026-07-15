import type { DayBoundaryMode, WatchEntry } from "./model";
import {
  addTaipeiCalendarDays,
  getTaipeiCalendarDate,
  taipeiStartOfDate,
  taipeiWeekday,
  toTaipeiDateKey
} from "./time";

export const HEATMAP_ROOT_ID = "ani-gamer-watch-heatmap";
export const ANALYSIS_TRIGGER_ID = "ani-gamer-watch-analysis-trigger";
export const ANALYSIS_OVERLAY_ID = "ani-gamer-watch-analysis-overlay";
const FOCUS_BRIDGE_SLOT = "ani-gamer-watch-focus-bridge";

type DailyWatch = {
  readonly dateKey: string;
  readonly date: Date | null;
  readonly entries: readonly WatchEntry[];
};

type HeatmapRenderState = {
  readonly loading?: boolean;
  readonly error?: string;
  readonly loadingMessage?: string;
};

type HeatmapFocusSnapshot =
  | { readonly kind: "analysis" }
  | { readonly kind: "mode"; readonly value: DayBoundaryMode }
  | { readonly kind: "day"; readonly dateKey: string };

type HeatmapViewOptions = {
  readonly onBoundaryModeChange: (mode: DayBoundaryMode) => void;
  readonly onOpenAnalysis: () => void;
};

const zhMonthFormatter = new Intl.DateTimeFormat("zh-TW", {
  month: "short",
  timeZone: "Asia/Taipei"
});
const zhDateFormatter = new Intl.DateTimeFormat("zh-TW", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  timeZone: "Asia/Taipei"
});
const timeFormatter = new Intl.DateTimeFormat("zh-TW", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Taipei"
});

export class HeatmapView {
  readonly root: HTMLElement;
  readonly #options: HeatmapViewOptions;
  readonly #shadowRoot: ShadowRoot;
  readonly #mount: HTMLElement;
  readonly #focusBridge: HTMLElement;
  #analysisButton: HTMLButtonElement | null = null;
  #tooltip: HTMLElement | null = null;
  #tooltipTarget: HTMLElement | null = null;
  #tooltipHideTimer: number | undefined;

  constructor(root: HTMLElement, options: HeatmapViewOptions) {
    this.root = root;
    this.#options = options;
    isolateHeatmapHost(root);
    this.#shadowRoot = root.shadowRoot ?? root.attachShadow({ mode: "open" });
    this.#shadowRoot.replaceChildren();
    const style = document.createElement("style");
    style.textContent = heatmapCss;
    this.#mount = element("div", "ani-heatmap-mount");
    const focusSlot = document.createElement("slot");
    focusSlot.setAttribute("name", FOCUS_BRIDGE_SLOT);
    this.#shadowRoot.append(style, this.#mount, focusSlot);
    this.#focusBridge = createFocusBridge(() => this.#analysisButton?.focus());
    this.#focusBridge.setAttribute("slot", FOCUS_BRIDGE_SLOT);
    this.root.replaceChildren(this.#focusBridge);
  }

  render(entries: readonly WatchEntry[], mode: DayBoundaryMode, state: HeatmapRenderState = {}): void {
    const priorFocus = captureHeatmapFocus(this.#shadowRoot);
    const days = buildDailyWatches(entries, mode);
    const maxCount = Math.max(1, ...days.map((day) => day.entries.length));
    const longestStreak = getLongestWatchStreak(days);
    const weeks = chunkDaysByWeek(days);

    this.hideTooltip();
    this.root.replaceChildren(this.#focusBridge);
    this.#mount.replaceChildren();
    const card = element("div", "ani-heatmap-card");
    const header = element("div", "ani-heatmap-header");
    const titleWrap = element("div", "ani-heatmap-title");
    const title = element("h2");
    title.textContent = "觀看熱力圖";
    const totalText = element("div", "ani-heatmap-total");
    totalText.textContent = state.loading
      ? "正在整理觀看紀錄…"
      : state.error
        ? "讀取失敗"
        : `過去一年共有 ${entries.length} 次觀看`;
    titleWrap.append(title, totalText);

    const actions = element("div", "ani-heatmap-actions");
    const analysisButton = this.renderAnalysisButton();
    this.#analysisButton = analysisButton;
    actions.append(analysisButton, this.renderBoundarySwitch(mode, state.loading === true));
    header.append(titleWrap, actions);

    const body = element("div", "ani-heatmap-body");
    body.append(
      renderMonthLabels(weeks),
      renderWeekdayLabels(),
      this.renderGrid(weeks, maxCount),
      renderLegend()
    );

    const footer = element("div", entries.length === 0 && !state.loading ? "ani-heatmap-empty" : "ani-heatmap-footer");
    const modeLabel = mode === "thirty-hour" ? "30 小時制" : "24 小時制";
    footer.textContent = state.loading
      ? state.loadingMessage ?? "正在讀取頁面上的每集觀看時間。"
      : state.error
        ? state.error
        : entries.length === 0
          ? "這一年還沒有可辨識的觀看紀錄。若你曾觀看，請確認已登入後重新整理頁面。"
          : `${modeLabel} · 單日最多 ${maxCount} 次觀看 · 最長連續 ${longestStreak} 天`;

    card.append(header, body, footer);
    this.#mount.append(card);
    restoreHeatmapFocus(this.#shadowRoot, priorFocus);
  }

  hideTooltip(): void {
    window.clearTimeout(this.#tooltipHideTimer);
    this.#tooltipHideTimer = undefined;
    this.#tooltipTarget?.removeAttribute("aria-describedby");
    this.#tooltipTarget = null;
    this.#tooltip?.remove();
    this.#tooltip = null;
  }

  #scheduleHideTooltip(): void {
    window.clearTimeout(this.#tooltipHideTimer);
    this.#tooltipHideTimer = window.setTimeout(() => this.hideTooltip(), 150);
  }

  destroy(): void {
    this.hideTooltip();
    this.#analysisButton = null;
    this.#mount.replaceChildren();
    this.#shadowRoot.replaceChildren();
    this.root.replaceChildren();
    this.root.removeAttribute("style");
    this.root.remove();
  }

  #showTooltip(target: HTMLElement, day: DailyWatch): void {
    this.hideTooltip();
    if (!day.date) {
      return;
    }

    const tooltip = element("div", "ani-heatmap-tooltip");
    tooltip.id = "ani-gamer-watch-heatmap-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.dataset.aniHeatmapOwned = "true";
    const title = element("div", "ani-heatmap-tooltip-title");
    title.textContent = day.entries.length === 0
      ? `${formatDisplayDate(day.date)} 沒有觀看紀錄`
      : `${formatDisplayDate(day.date)} 有 ${day.entries.length} 次觀看`;
    tooltip.append(title);

    if (day.entries.length > 0) {
      const list = element("div", "ani-heatmap-tooltip-list");
      for (const entry of day.entries) {
        const item = element("div", "ani-heatmap-tooltip-item");
        const time = element("div", "ani-heatmap-tooltip-time");
        time.textContent = timeFormatter.format(entry.watchedAt);
        const detail = element("div");
        const name = element("div", "ani-heatmap-tooltip-name");
        name.textContent = entry.title;
        const episode = element("div", "ani-heatmap-tooltip-episode");
        episode.textContent = entry.episode;
        detail.append(name, episode);
        item.append(time, detail);
        list.append(item);
      }
      tooltip.append(list);
    }

    this.#shadowRoot.append(tooltip);
    this.#tooltip = tooltip;
    this.#tooltipTarget = target;
    target.setAttribute("aria-describedby", tooltip.id);
    tooltip.addEventListener("mouseenter", () => window.clearTimeout(this.#tooltipHideTimer));
    tooltip.addEventListener("mouseleave", () => this.#scheduleHideTooltip());
    positionTooltip(target, tooltip);
  }

  private renderAnalysisButton(): HTMLButtonElement {
    const button = element("button", "ani-heatmap-analysis-button") as HTMLButtonElement;
    button.type = "button";
    button.textContent = "看分析";
    button.setAttribute("aria-label", "開啟觀看分析");
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", ANALYSIS_OVERLAY_ID);
    button.addEventListener("click", this.#options.onOpenAnalysis);
    return button;
  }

  private renderBoundarySwitch(mode: DayBoundaryMode, disabled: boolean): HTMLElement {
    const switchRoot = element("div", "ani-heatmap-switch");
    switchRoot.dataset.mode = mode;
    switchRoot.setAttribute("role", "group");
    switchRoot.setAttribute("aria-label", "日期歸屬模式");

    for (const [value, label] of [["calendar", "24H"], ["thirty-hour", "30H"]] as const) {
      const button = element("button", "ani-heatmap-switch-button") as HTMLButtonElement;
      button.type = "button";
      button.textContent = label;
      button.dataset.modeValue = value;
      button.disabled = disabled;
      button.setAttribute(
        "aria-label",
        value === "calendar" ? "午夜換日（24 小時制）" : "清晨 6 點換日（30 小時制）"
      );
      button.title = value === "calendar" ? "午夜換日" : "清晨 6 點換日";
      button.setAttribute("aria-pressed", String(mode === value));
      button.addEventListener("click", () => {
        if (mode !== value) {
          this.#options.onBoundaryModeChange(value);
        }
      });
      switchRoot.append(button);
    }

    return switchRoot;
  }

  private renderGrid(weeks: readonly (readonly DailyWatch[])[], maxCount: number): HTMLElement {
    const grid = element("div", "ani-heatmap-grid");
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "過去一年每日觀看紀錄");
    const dayButtons: HTMLButtonElement[] = [];
    const currentDateKey = toTaipeiDateKey(new Date());
    for (const [weekIndex, week] of weeks.entries()) {
      for (const [weekdayIndex, day] of week.entries()) {
        const count = day.entries.length;
        if (!day.date) {
          const padding = element("span", "ani-heatmap-day");
          padding.dataset.outOfRange = "true";
          padding.setAttribute("aria-hidden", "true");
          grid.append(padding);
          continue;
        }

        const button = element("button", "ani-heatmap-day") as HTMLButtonElement;
        button.type = "button";
        button.dataset.level = String(getLevel(count, maxCount));
        button.dataset.date = day.dateKey;
        button.dataset.gridCellIndex = String(weekIndex * 7 + weekdayIndex);
        button.tabIndex = day.dateKey === currentDateKey ? 0 : -1;
        button.setAttribute("aria-label", `${formatDisplayDate(day.date)}，${count} 次觀看`);
        button.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown ArrowLeft ArrowRight Home End");
        button.addEventListener("mouseenter", () => this.#showTooltip(button, day));
        button.addEventListener("focus", () => this.#showTooltip(button, day));
        button.addEventListener("mouseleave", () => this.#scheduleHideTooltip());
        button.addEventListener("blur", () => this.#scheduleHideTooltip());
        dayButtons.push(button);
        grid.append(button);
      }
    }

    if (!dayButtons.some((button) => button.tabIndex === 0)) {
      const last = dayButtons.at(-1);
      if (last) last.tabIndex = 0;
    }
    grid.addEventListener("keydown", (event) => navigateGrid(event, dayButtons));
    return grid;
  }
}

const isolateHeatmapHost = (host: HTMLElement): void => {
  const declarations: readonly [string, string][] = [
    ["all", "initial"],
    ["display", "block"],
    ["box-sizing", "border-box"],
    ["position", "relative"],
    ["inset", "auto"],
    ["float", "none"],
    ["clear", "both"],
    ["width", "100%"],
    ["min-width", "0"],
    ["max-width", "none"],
    ["height", "auto"],
    ["min-height", "0"],
    ["max-height", "none"],
    ["margin", "0"],
    ["padding", "0"],
    ["border", "0"],
    ["border-radius", "0"],
    ["background", "transparent"],
    ["box-shadow", "none"],
    ["overflow", "visible"],
    ["opacity", "1"],
    ["visibility", "visible"],
    ["pointer-events", "auto"],
    ["transform", "none"],
    ["transform-origin", "center"],
    ["filter", "none"],
    ["perspective", "none"],
    ["clip", "auto"],
    ["clip-path", "none"],
    ["contain", "none"],
    ["isolation", "isolate"],
    ["z-index", "auto"],
    ["animation", "none"],
    ["transition", "none"],
    ["font-family", '"Noto Sans TC", "Microsoft JhengHei", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'],
    ["font-size", "16px"],
    ["font-style", "normal"],
    ["font-weight", "400"],
    ["line-height", "normal"],
    ["color", "#1f2937"],
    ["text-align", "left"],
    ["text-indent", "0"],
    ["text-transform", "none"],
    ["text-decoration", "none"],
    ["letter-spacing", "normal"],
    ["word-spacing", "normal"],
    ["white-space", "normal"],
    ["direction", "ltr"],
    ["writing-mode", "horizontal-tb"],
    ["vertical-align", "baseline"],
    ["color-scheme", "light"],
    ["zoom", "1"]
  ];
  for (const [property, value] of declarations) {
    host.style.setProperty(property, value, "important");
  }
};

const createFocusBridge = (restoreFocus: () => void): HTMLElement => {
  const bridge = document.createElement("span");
  bridge.id = ANALYSIS_TRIGGER_ID;
  bridge.tabIndex = -1;
  for (const [property, value] of [
    ["all", "initial"],
    ["position", "absolute"],
    ["inset", "0 auto auto 0"],
    ["display", "block"],
    ["width", "1px"],
    ["height", "1px"],
    ["margin", "0"],
    ["padding", "0"],
    ["border", "0"],
    ["overflow", "hidden"],
    ["opacity", "0"],
    ["pointer-events", "none"],
    ["clip-path", "inset(50%)"],
    ["contain", "strict"],
    ["z-index", "-1"]
  ] as const) {
    bridge.style.setProperty(property, value, "important");
  }
  bridge.addEventListener("focus", restoreFocus);
  return bridge;
};

export const heatmapCss = `
:host {
  all: initial !important;
  display: block !important;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: none;
  height: auto;
  min-height: 0;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  overflow: visible !important;
  opacity: 1 !important;
  visibility: visible !important;
  pointer-events: auto !important;
  transform: none !important;
  filter: none !important;
  contain: none !important;
  isolation: isolate !important;
  color-scheme: light;
}
:host::before, :host::after {
  content: none !important;
  display: none !important;
}
slot[name="ani-gamer-watch-focus-bridge"] {
  all: initial !important;
  position: fixed !important;
  inset: 0 auto auto 0 !important;
  display: block !important;
  width: 1px !important;
  height: 1px !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  overflow: hidden !important;
  opacity: 0 !important;
  visibility: visible !important;
  pointer-events: none !important;
  contain: strict !important;
  z-index: -1 !important;
}
.ani-heatmap-mount {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin: 18px 0 24px;
  padding: 0;
  color: #1f2937;
  font-family: "Noto Sans TC", "Microsoft JhengHei", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 16px;
  font-style: normal;
  font-weight: 400;
  line-height: normal;
  text-align: left;
  direction: ltr;
  writing-mode: horizontal-tb;
}
.ani-heatmap-mount *,
.ani-heatmap-mount *::before,
.ani-heatmap-mount *::after,
.ani-heatmap-tooltip,
.ani-heatmap-tooltip::before,
.ani-heatmap-tooltip::after,
.ani-heatmap-tooltip *,
.ani-heatmap-tooltip *::before,
.ani-heatmap-tooltip *::after { box-sizing: border-box; }
.ani-heatmap-card {
  position: relative;
  overflow: visible;
  width: min(100%, 1088px);
  margin: 0 auto;
  border: 1px solid rgba(148, 163, 184, 0.36);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(12px);
}
.ani-heatmap-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 16px 18px 10px; }
.ani-heatmap-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ani-heatmap-title h2 { margin: 0; color: #111827; font-size: 16px; font-weight: 700; line-height: 1.4; }
.ani-heatmap-total { color: #64748b; font-size: 12px; line-height: 1.5; white-space: nowrap; }
.ani-heatmap-actions { display: flex; align-items: center; gap: 8px; flex: none; }
.ani-heatmap-analysis-button {
  height: 30px;
  border: 1px solid #bae6fd;
  border-radius: 999px;
  background: #f0f9ff;
  color: #0369a1;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  padding: 0 13px;
}
.ani-heatmap-analysis-button:hover { background: #e0f2fe; }
.ani-heatmap-analysis-button:focus-visible,
.ani-heatmap-switch-button:focus-visible { outline: 2px solid #0f172a; outline-offset: 3px; }
.ani-heatmap-switch {
  display: inline-grid;
  grid-template-columns: 1fr 1fr;
  width: 100px;
  height: 30px;
  border: 1px solid rgba(14, 165, 233, 0.36);
  border-radius: 999px;
  background: #f8fafc;
  padding: 2px;
  position: relative;
}
.ani-heatmap-switch::before {
  content: "";
  position: absolute;
  inset: 2px auto 2px 2px;
  width: calc(50% - 2px);
  border-radius: 999px;
  background: #0369a1;
  box-shadow: 0 4px 12px rgba(14, 165, 233, 0.28);
  transition: transform 160ms ease;
}
.ani-heatmap-switch[data-mode="thirty-hour"]::before { transform: translateX(100%); }
.ani-heatmap-switch-button {
  position: relative;
  z-index: 1;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  padding: 0;
}
.ani-heatmap-switch-button[aria-pressed="true"] { color: #fff; }
.ani-heatmap-switch-button:disabled { cursor: wait; }
.ani-heatmap-body {
  display: grid;
  grid-template-columns: max-content max-content max-content;
  gap: 8px 12px;
  align-items: start;
  justify-content: center;
  padding: 4px 18px 14px;
  overflow-x: auto;
}
.ani-heatmap-months { grid-column: 2; display: grid; grid-template-columns: repeat(53, 12px); gap: 3px; min-width: max-content; height: 18px; color: #475569; font-size: 12px; }
.ani-heatmap-weekdays { grid-column: 1; display: grid; grid-template-rows: repeat(7, 12px); gap: 3px; color: #64748b; font-size: 12px; line-height: 12px; text-align: right; }
.ani-heatmap-grid { grid-column: 2; display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 12px); grid-auto-columns: 12px; gap: 3px; min-width: max-content; }
.ani-heatmap-day { width: 12px; height: 12px; border: 0; border-radius: 2px; background: #edf2f7; cursor: default; outline: none; padding: 0; }
.ani-heatmap-day[data-level="1"] { background: #bae6fd; }
.ani-heatmap-day[data-level="2"] { background: #7dd3fc; }
.ani-heatmap-day[data-level="3"] { background: #38bdf8; }
.ani-heatmap-day[data-level="4"] { background: #0284c7; }
.ani-heatmap-day[data-out-of-range="true"] { opacity: 0; pointer-events: none; }
.ani-heatmap-day:focus-visible, .ani-heatmap-day:hover { outline: 2px solid #0f172a; outline-offset: 1px; }
.ani-heatmap-legend { grid-column: 3; display: grid; grid-template-columns: max-content max-content; gap: 5px 8px; align-items: center; color: #64748b; font-size: 12px; line-height: 12px; min-width: max-content; }
.ani-heatmap-swatch { width: 12px; height: 12px; border-radius: 2px; background: #edf2f7; }
.ani-heatmap-swatch[data-level="1"] { background: #bae6fd; }
.ani-heatmap-swatch[data-level="2"] { background: #7dd3fc; }
.ani-heatmap-swatch[data-level="3"] { background: #38bdf8; }
.ani-heatmap-swatch[data-level="4"] { background: #0284c7; }
.ani-heatmap-footer { width: fit-content; margin: 0 auto; padding: 0 18px 16px 52px; color: #475569; font-size: 13px; line-height: 1.5; }
.ani-heatmap-empty { width: fit-content; margin: 0 auto; padding: 0 18px 16px 52px; color: #64748b; font-size: 13px; line-height: 1.6; }
.ani-heatmap-tooltip {
  position: fixed;
  z-index: 2147483646;
  width: min(360px, calc(100vw - 24px));
  max-height: min(420px, calc(100vh - 24px));
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.2);
  color: #111827;
  pointer-events: auto;
  font-family: "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif;
}
.ani-heatmap-tooltip-title { padding: 12px 14px 10px; border-bottom: 1px solid #e2e8f0; font-size: 14px; font-weight: 800; line-height: 1.45; }
.ani-heatmap-tooltip-list { max-height: 330px; overflow-y: auto; padding: 6px 0; }
.ani-heatmap-tooltip-item { display: grid; grid-template-columns: 42px 1fr; gap: 10px; padding: 8px 14px; border-bottom: 1px solid #f1f5f9; }
.ani-heatmap-tooltip-item:last-child { border-bottom: 0; }
.ani-heatmap-tooltip-time { color: #64748b; font-size: 12px; line-height: 1.4; white-space: nowrap; }
.ani-heatmap-tooltip-name { min-width: 0; color: #111827; font-size: 13px; font-weight: 700; line-height: 1.45; }
.ani-heatmap-tooltip-episode { margin-top: 2px; color: #475569; font-size: 12px; line-height: 1.45; }
@media (max-width: 720px) {
  .ani-heatmap-mount { margin: 14px 0 18px; }
  .ani-heatmap-header { flex-direction: column; align-items: stretch; padding: 14px 14px 8px; }
  .ani-heatmap-actions { justify-content: flex-end; }
  .ani-heatmap-body { grid-template-columns: max-content max-content; justify-content: start; padding: 2px 14px 12px; }
  .ani-heatmap-legend { grid-column: 2; display: flex; justify-content: flex-end; margin-top: 2px; }
  .ani-heatmap-footer, .ani-heatmap-empty { width: auto; margin: 0; padding: 0 14px 14px 46px; }
}
@media (prefers-reduced-motion: reduce) {
  .ani-heatmap-switch::before { transition: none; }
}
@media (forced-colors: active) {
  .ani-heatmap-day { border: 1px solid CanvasText; }
}
`;

const buildDailyWatches = (entries: readonly WatchEntry[], mode: DayBoundaryMode): DailyWatch[] => {
  const todayKey = toTaipeiDateKey(new Date(), mode);
  const firstKey = addTaipeiCalendarDays(todayKey, -364);
  const entriesByDate = new Map<string, WatchEntry[]>();
  for (const entry of entries) {
    const dateKey = toTaipeiDateKey(entry.watchedAt, mode);
    const dayEntries = entriesByDate.get(dateKey) ?? [];
    dayEntries.push(entry);
    entriesByDate.set(dateKey, dayEntries);
  }

  return Array.from({ length: 365 }, (_, offset) => {
    const dateKey = addTaipeiCalendarDays(firstKey, offset);
    return {
      dateKey,
      date: taipeiStartOfDate(dateKey),
      entries: (entriesByDate.get(dateKey) ?? []).slice().sort((left, right) => left.watchedAt.getTime() - right.watchedAt.getTime())
    };
  });
};

const getLongestWatchStreak = (days: readonly DailyWatch[]): number => {
  let longest = 0;
  let current = 0;
  for (const day of days) {
    current = day.entries.length > 0 ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
};

const chunkDaysByWeek = (days: readonly DailyWatch[]): DailyWatch[][] => {
  const first = days[0];
  const paddingBefore = Array.from({ length: first ? taipeiWeekday(first.dateKey) : 0 }, createPaddingDay);
  const padded = [...paddingBefore, ...days];
  padded.push(...Array.from({ length: (7 - padded.length % 7) % 7 }, createPaddingDay));
  return Array.from({ length: padded.length / 7 }, (_, index) => padded.slice(index * 7, index * 7 + 7));
};

const createPaddingDay = (): DailyWatch => ({ dateKey: "", date: null, entries: [] });

const renderMonthLabels = (weeks: readonly (readonly DailyWatch[])[]): HTMLElement => {
  const months = element("div", "ani-heatmap-months");
  let previousMonth: number | null = null;
  weeks.forEach((week, index) => {
    const label = element("span");
    const firstVisibleDay = week.find((day) => day.date !== null);
    if (firstVisibleDay?.date) {
      const month = getTaipeiCalendarDate(firstVisibleDay.date).month;
      if (index === 0 || month !== previousMonth) {
        label.textContent = zhMonthFormatter.format(firstVisibleDay.date);
        previousMonth = month;
      }
    }
    months.append(label);
  });
  return months;
};

const renderWeekdayLabels = (): HTMLElement => {
  const weekdays = element("div", "ani-heatmap-weekdays");
  for (const label of ["", "週一", "", "週三", "", "週五", ""]) {
    const item = element("span");
    item.textContent = label;
    weekdays.append(item);
  }
  return weekdays;
};

const renderLegend = (): HTMLElement => {
  const legend = element("div", "ani-heatmap-legend");
  const label = element("span");
  label.textContent = "觀看數量";
  label.style.gridColumn = "1 / -1";
  legend.append(label);
  ["0", "1", "2", "3", "4+"].forEach((text, index) => {
    const swatch = element("span", "ani-heatmap-swatch");
    swatch.dataset.level = String(index);
    const amount = element("span");
    amount.textContent = text;
    legend.append(swatch, amount);
  });
  return legend;
};

const getLevel = (count: number, maxCount: number): number => {
  if (count <= 0) return 0;
  if (maxCount <= 4) return Math.min(4, count);
  if (count >= Math.ceil(maxCount * 0.75)) return 4;
  if (count >= Math.ceil(maxCount * 0.5)) return 3;
  if (count >= Math.ceil(maxCount * 0.25)) return 2;
  return 1;
};

const formatDisplayDate = (date: Date): string => zhDateFormatter.format(date);

const positionTooltip = (target: HTMLElement, panel: HTMLElement): void => {
  const targetRect = target.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const margin = 12;
  const topCandidate = targetRect.bottom + 10;
  const bottomCandidate = targetRect.top - panelRect.height - 10;
  const top = topCandidate + panelRect.height + margin <= window.innerHeight ? topCandidate : Math.max(margin, bottomCandidate);
  const left = Math.min(
    Math.max(margin, targetRect.left + targetRect.width / 2 - panelRect.width / 2),
    window.innerWidth - panelRect.width - margin
  );
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
};

const navigateGrid = (event: KeyboardEvent, buttons: readonly HTMLButtonElement[]): void => {
  const current = event.target;
  if (!(current instanceof HTMLButtonElement)) return;
  if (!buttons.includes(current)) return;

  const currentCellIndex = parseGridCellIndex(current);
  if (currentCellIndex === null) return;
  const buttonsByCellIndex = new Map<number, HTMLButtonElement>();
  for (const button of buttons) {
    const cellIndex = parseGridCellIndex(button);
    if (cellIndex !== null) buttonsByCellIndex.set(cellIndex, button);
  }

  let target: HTMLButtonElement | undefined;
  switch (event.key) {
    case "Home":
      target = buttons[0];
      break;
    case "End":
      target = buttons.at(-1);
      break;
    case "ArrowLeft":
      target = buttonsByCellIndex.get(currentCellIndex - 7);
      break;
    case "ArrowRight":
      target = buttonsByCellIndex.get(currentCellIndex + 7);
      break;
    case "ArrowUp":
      if (currentCellIndex % 7 > 0) target = buttonsByCellIndex.get(currentCellIndex - 1);
      break;
    case "ArrowDown":
      if (currentCellIndex % 7 < 6) target = buttonsByCellIndex.get(currentCellIndex + 1);
      break;
    default:
      return;
  }

  event.preventDefault();
  event.stopPropagation();
  for (const button of buttons) button.tabIndex = -1;
  const resolvedTarget = target ?? current;
  resolvedTarget.tabIndex = 0;
  if (resolvedTarget !== current) resolvedTarget.focus();
};

const captureHeatmapFocus = (shadowRoot: ShadowRoot): HeatmapFocusSnapshot | undefined => {
  const active = shadowRoot.activeElement;
  if (!(active instanceof HTMLElement)) return undefined;
  if (active.classList.contains("ani-heatmap-analysis-button")) return { kind: "analysis" };
  if (active.classList.contains("ani-heatmap-switch-button")) {
    const value = active.dataset.modeValue;
    if (value === "calendar" || value === "thirty-hour") return { kind: "mode", value };
  }
  if (active.classList.contains("ani-heatmap-day")) {
    const dateKey = active.dataset.date;
    if (dateKey) return { kind: "day", dateKey };
  }
  return undefined;
};

const restoreHeatmapFocus = (
  shadowRoot: ShadowRoot,
  snapshot: HeatmapFocusSnapshot | undefined
): void => {
  if (!snapshot) return;
  let target: HTMLElement | null;
  switch (snapshot.kind) {
    case "analysis":
      target = shadowRoot.querySelector(".ani-heatmap-analysis-button");
      break;
    case "mode":
      target = shadowRoot.querySelector(`[data-mode-value="${snapshot.value}"]`);
      break;
    case "day":
      target = shadowRoot.querySelector(`[data-date="${snapshot.dateKey}"]`);
      break;
  }
  target?.focus();
};

const parseGridCellIndex = (button: HTMLButtonElement): number | null => {
  const value = button.dataset.gridCellIndex;
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const element = (tagName: string, className?: string): HTMLElement => {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  return node;
};
