type WatchEntry = {
  readonly dateKey: string;
  readonly watchedAt: Date;
  readonly title: string;
  readonly episode: string;
};

type DailyWatch = {
  readonly dateKey: string;
  readonly date: Date;
  readonly entries: WatchEntry[];
};

type DayBoundaryMode = "calendar" | "thirty-hour";

const EXTENSION_ROOT_ID = "ani-gamer-watch-heatmap";
const STYLE_ID = "ani-gamer-watch-heatmap-style";
const ACTIVE_DATA_ATTRIBUTE = "data-ani-heatmap-active";
const DAY_BOUNDARY_MODE_STORAGE_KEY = "ani-gamer-heatmap-day-boundary-mode";

const css = `
#${EXTENSION_ROOT_ID} {
  box-sizing: border-box;
  width: 100%;
  margin: 18px 0 24px;
  padding: 0;
  color: #1f2937;
  font-family: "Noto Sans TC", "Microsoft JhengHei", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
#${EXTENSION_ROOT_ID} * {
  box-sizing: border-box;
}
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
.ani-heatmap-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px 10px;
}
.ani-heatmap-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.ani-heatmap-title h2 {
  margin: 0;
  color: #111827;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.4;
}
.ani-heatmap-total {
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
}
.ani-heatmap-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
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
  top: 2px;
  bottom: 2px;
  left: 2px;
  width: calc(50% - 2px);
  border-radius: 999px;
  background: #0ea5e9;
  box-shadow: 0 4px 12px rgba(14, 165, 233, 0.28);
  transition: transform 160ms ease;
}
.ani-heatmap-switch[data-mode="thirty-hour"]::before {
  transform: translateX(100%);
}
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
.ani-heatmap-switch-button[aria-pressed="true"] {
  color: #ffffff;
}
.ani-heatmap-switch-button:focus-visible {
  outline: 2px solid #0f172a;
  outline-offset: 3px;
}
.ani-heatmap-body {
  display: grid;
  grid-template-columns: max-content max-content max-content;
  gap: 8px 12px;
  align-items: start;
  justify-content: center;
  padding: 4px 18px 14px;
  overflow-x: auto;
}
.ani-heatmap-months {
  grid-column: 2;
  display: grid;
  grid-template-columns: repeat(53, 12px);
  gap: 3px;
  min-width: max-content;
  height: 18px;
  color: #475569;
  font-size: 12px;
}
.ani-heatmap-weekdays {
  grid-column: 1;
  display: grid;
  grid-template-rows: repeat(7, 12px);
  gap: 3px;
  padding-top: 0;
  color: #64748b;
  font-size: 12px;
  line-height: 12px;
  text-align: right;
}
.ani-heatmap-grid {
  grid-column: 2;
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(7, 12px);
  grid-auto-columns: 12px;
  gap: 3px;
  min-width: max-content;
}
.ani-heatmap-day {
  width: 12px;
  height: 12px;
  border: 0;
  border-radius: 2px;
  background: #edf2f7;
  cursor: default;
  outline: none;
  padding: 0;
}
.ani-heatmap-day[data-level="1"] { background: #bae6fd; }
.ani-heatmap-day[data-level="2"] { background: #7dd3fc; }
.ani-heatmap-day[data-level="3"] { background: #38bdf8; }
.ani-heatmap-day[data-level="4"] { background: #0284c7; }
.ani-heatmap-day[data-out-of-range="true"] {
  opacity: 0;
  pointer-events: none;
}
.ani-heatmap-day:focus-visible,
.ani-heatmap-day:hover {
  outline: 2px solid #0f172a;
  outline-offset: 1px;
}
.ani-heatmap-legend {
  grid-column: 3;
  display: grid;
  grid-template-columns: max-content max-content;
  gap: 5px 8px;
  align-items: center;
  color: #64748b;
  font-size: 12px;
  line-height: 12px;
  min-width: max-content;
}
.ani-heatmap-swatch {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  background: #edf2f7;
}
.ani-heatmap-swatch[data-level="1"] { background: #bae6fd; }
.ani-heatmap-swatch[data-level="2"] { background: #7dd3fc; }
.ani-heatmap-swatch[data-level="3"] { background: #38bdf8; }
.ani-heatmap-swatch[data-level="4"] { background: #0284c7; }
.ani-heatmap-footer {
  width: fit-content;
  margin: 0 auto;
  padding: 0 18px 16px 52px;
  color: #475569;
  font-size: 13px;
  line-height: 1.5;
}
.ani-heatmap-tooltip {
  position: fixed;
  z-index: 2147483647;
  width: min(360px, calc(100vw - 24px));
  max-height: min(420px, calc(100vh - 24px));
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.2);
  color: #111827;
  pointer-events: none;
}
.ani-heatmap-tooltip-title {
  padding: 12px 14px 10px;
  border-bottom: 1px solid #e2e8f0;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.45;
}
.ani-heatmap-tooltip-list {
  max-height: 330px;
  overflow-y: auto;
  padding: 6px 0;
}
.ani-heatmap-tooltip-item {
  display: grid;
  grid-template-columns: 42px 1fr;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid #f1f5f9;
}
.ani-heatmap-tooltip-item:last-child {
  border-bottom: 0;
}
.ani-heatmap-tooltip-time {
  color: #64748b;
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
}
.ani-heatmap-tooltip-name {
  min-width: 0;
  color: #111827;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
}
.ani-heatmap-tooltip-episode {
  margin-top: 2px;
  color: #475569;
  font-size: 12px;
  line-height: 1.45;
}
.ani-heatmap-empty {
  width: fit-content;
  margin: 0 auto;
  padding: 0 18px 16px 52px;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}
@media (max-width: 720px) {
  #${EXTENSION_ROOT_ID} {
    margin: 14px 0 18px;
  }
  .ani-heatmap-header {
    flex-direction: column;
    align-items: stretch;
    padding: 14px 14px 8px;
  }
  .ani-heatmap-actions {
    justify-content: flex-end;
  }
  .ani-heatmap-body {
    grid-template-columns: max-content max-content;
    justify-content: start;
    padding: 2px 14px 12px;
  }
  .ani-heatmap-legend {
    grid-column: 2;
    display: flex;
    justify-content: flex-end;
    margin-top: 2px;
  }
  .ani-heatmap-footer,
  .ani-heatmap-empty {
    width: auto;
    margin: 0;
    padding: 0 14px 14px 46px;
  }
}
`;

const zhMonthFormatter = new Intl.DateTimeFormat("zh-TW", { month: "short" });
const zhDateFormatter = new Intl.DateTimeFormat("zh-TW", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short"
});
const timeFormatter = new Intl.DateTimeFormat("zh-TW", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

let currentEntries: WatchEntry[] = [];
let tooltip: HTMLElement | null = null;
let refreshTimer: number | undefined;
let observer: MutationObserver | undefined;
let isCollecting = false;
let loadingMessage = "正在讀取頁面上的每集觀看時間。";
let dayBoundaryMode: DayBoundaryMode = loadDayBoundaryMode();

const main = (): void => {
  if (document.documentElement.hasAttribute(ACTIVE_DATA_ATTRIBUTE) && document.getElementById(EXTENSION_ROOT_ID)?.childElementCount) {
    return;
  }

  document.documentElement.setAttribute(ACTIVE_DATA_ATTRIBUTE, "true");
  injectStyle();

  if (!isHistoryPage()) {
    watchForHistoryPage();
    return;
  }

  void mountHeatmap();
  watchForHistoryPage();
};

const watchForHistoryPage = (): void => {
  observer?.disconnect();
  observer = new MutationObserver((mutations) => {
    if (mutations.every(isExtensionMutation)) {
      return;
    }

    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      const root = document.getElementById(EXTENSION_ROOT_ID);

      if (!isHistoryPage()) {
        root?.remove();
        return;
      }

      if (!root) {
        void mountHeatmap({ preserveExisting: true });
        return;
      }

      if (mutations.some(isHistoryMutation)) {
        currentEntries = dedupeEntries(parseWatchEntriesFromDom(dayBoundaryMode))
          .sort((a, b) => a.watchedAt.getTime() - b.watchedAt.getTime());
        renderHeatmap(root, currentEntries);
      }
    }, 300);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
};

const mountHeatmap = async (options: { preserveExisting?: boolean } = {}): Promise<void> => {
  const existing = document.getElementById(EXTENSION_ROOT_ID);
  if (existing && options.preserveExisting) {
    renderHeatmap(existing, currentEntries, { loading: isCollecting });
    return;
  }

  const root = existing ?? document.createElement("section");
  root.id = EXTENSION_ROOT_ID;
  root.setAttribute("aria-label", "動畫瘋觀看熱力圖");

  const anchor = findInsertionAnchor();
  if (!anchor) {
    return;
  }

  if (!existing) {
    anchor.insertAdjacentElement("afterend", root);
  }

  renderHeatmap(root, currentEntries, { loading: true });
  try {
    currentEntries = await collectWatchEntries();
    renderHeatmap(root, currentEntries);
  } catch (error) {
    renderHeatmap(root, currentEntries, { error: getErrorMessage(error) });
  }
};

const collectWatchEntries = async (): Promise<WatchEntry[]> => {
  if (isCollecting) {
    return currentEntries;
  }

  isCollecting = true;
  loadingMessage = "正在自動載入完整觀看紀錄...";
  const root = document.getElementById(EXTENSION_ROOT_ID);
  if (root) {
    renderHeatmap(root, currentEntries, { loading: true });
  }

  observer?.disconnect();

  try {
    await loadAllHistoryPagesIntoDom();
    const parsedEntries = parseWatchEntriesFromDom(dayBoundaryMode);
    return dedupeEntries(parsedEntries).sort((a, b) => a.watchedAt.getTime() - b.watchedAt.getTime());
  } finally {
    isCollecting = false;
    loadingMessage = "正在讀取頁面上的每集觀看時間。";
    watchForHistoryPage();
  }
};

const loadAllHistoryPagesIntoDom = async (): Promise<void> => {
  await waitForHistoryDom();

  for (let attempts = 0; attempts < 60; attempts += 1) {
    const button = document.querySelector<HTMLElement>(".anime-btn-show-more");
    if (!button) {
      return;
    }

    const previousSubListCount = document.querySelectorAll(".user-watchTime-list").length;
    const previousCardCount = document.querySelectorAll(".user-watch-list").length;
    button.click();
    await waitForHistoryPageAppend(previousSubListCount, previousCardCount);
  }

  throw new Error("自動載入觀看紀錄超過預期頁數");
};

const waitForHistoryDom = async (): Promise<void> => {
  if (document.querySelector(".user-watchTime-list, .anime-btn-show-more, .notice")) {
    return;
  }

  await waitForDomChange(() => Boolean(document.querySelector(".user-watchTime-list, .anime-btn-show-more, .notice")), 8000);
};

const waitForHistoryPageAppend = async (previousSubListCount: number, previousCardCount: number): Promise<void> => {
  await waitForDomChange(() => {
    const nextSubListCount = document.querySelectorAll(".user-watchTime-list").length;
    const nextCardCount = document.querySelectorAll(".user-watch-list").length;
    const isLoading = !document.querySelector(".loading-anime.is-hide") && Boolean(document.querySelector(".loading-anime"));

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

const parseWatchEntriesFromDom = (mode: DayBoundaryMode): WatchEntry[] => {
  const entries: WatchEntry[] = [];
  const links = document.querySelectorAll<HTMLAnchorElement>(".user-watchTime-list .user-watch-textlist a");

  for (const link of links) {
    const watchedAt = parseWatchDate(cleanText(link.querySelector(".date")?.textContent ?? ""));
    const rawTitle = cleanText(link.querySelector(".history-list-anime-title")?.textContent ?? "");

    const watchDate = watchedAt ? toWatchDate(watchedAt, mode) : null;

    if (!watchedAt || !watchDate || !rawTitle || !isWithinLastYear(watchDate)) {
      continue;
    }

    const episode = extractEpisode(rawTitle);
    const title = cleanTitle(rawTitle, episode);

    entries.push({
      dateKey: toDateKey(watchDate),
      watchedAt,
      title: title || rawTitle,
      episode: episode || "單集紀錄"
    });
  }

  return entries;
};

const extractEpisode = (text: string): string => {
  const normalized = normalizeText(text);
  const bracketEpisode = normalized.match(/[\[【]\s*(\d+(?:\.\d+)?)\s*[\]】]/);
  if (bracketEpisode?.[1]) {
    return `第 ${bracketEpisode[1]} 集`;
  }

  const numberedEpisode = normalized.match(/第\s*(\d+(?:\.\d+)?)\s*(話|集|季|部)/);
  if (numberedEpisode?.[0]) {
    return numberedEpisode[0].replace(/\s+/g, " ");
  }

  const englishEpisode = normalized.match(/\b(?:episode|ep\.?)\s*(\d+(?:\.\d+)?)/i);
  if (englishEpisode?.[1]) {
    return `第 ${englishEpisode[1]} 集`;
  }

  if (/電影|劇場版/.test(normalized)) {
    return "電影";
  }

  if (/\bOVA\b/i.test(normalized)) {
    return "OVA";
  }

  return "";
};

const cleanTitle = (text: string, episode: string): string => {
  return cleanText(text)
    .replace(/\b20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s+\d{1,2}:\d{2}\b/g, "")
    .replace(/[\[【]\s*\d+(?:\.\d+)?\s*[\]】]/g, "")
    .replace(episode, "")
    .replace(/觀看紀錄|觀看記錄|觀看結束|已更新|繼續觀看/g, "")
    .trim();
};

const dedupeEntries = (entries: WatchEntry[]): WatchEntry[] => {
  const seen = new Set<string>();
  const deduped: WatchEntry[] = [];

  for (const entry of entries) {
    const key = [entry.dateKey, entry.watchedAt.getHours(), entry.watchedAt.getMinutes(), entry.title, entry.episode].join("|");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
};

const renderHeatmap = (
  root: HTMLElement,
  entries: WatchEntry[],
  options: { loading?: boolean; error?: string } = {}
): void => {
  const days = buildDailyWatches(entries);
  const maxCount = Math.max(1, ...days.map((day) => day.entries.length));
  const longestStreak = getLongestWatchStreak(days);
  const weeks = chunkDaysByWeek(days);
  const total = entries.length;

  root.innerHTML = "";
  const card = element("div", "ani-heatmap-card");
  const header = element("div", "ani-heatmap-header");
  const titleWrap = element("div", "ani-heatmap-title");
  const title = element("h2");
  title.textContent = "觀看熱力圖";

  const totalText = element("div", "ani-heatmap-total");
  totalText.textContent = options.loading
    ? "整理觀看紀錄中..."
    : options.error
      ? "讀取失敗"
      : `過去一年共觀看 ${total} 集`;

  titleWrap.append(title, totalText);

  const actions = element("div", "ani-heatmap-actions");
  actions.append(renderBoundarySwitch(root, options.loading === true));
  header.append(titleWrap, actions);

  const body = element("div", "ani-heatmap-body");
  body.append(renderMonthLabels(weeks), renderWeekdayLabels(), renderGrid(weeks, maxCount), renderLegend());

  const footer = element("div", entries.length === 0 && !options.loading ? "ani-heatmap-empty" : "ani-heatmap-footer");
  const modeLabel = dayBoundaryMode === "thirty-hour" ? "30 小時制" : "24 小時制";
  footer.textContent = options.loading
    ? loadingMessage
    : options.error
      ? options.error
      : entries.length === 0
      ? "尚未從目前已載入的觀看紀錄讀到過去一年的單集觀看時間。請確認已登入並位於觀看紀錄頁面。"
      : `${modeLabel}；最多一天看 ${maxCount} 集，最長連續觀看 ${longestStreak} 天。`;

  card.append(header, body, footer);
  root.append(card);
};

const renderBoundarySwitch = (root: HTMLElement, disabled: boolean): HTMLElement => {
  const switchRoot = element("div", "ani-heatmap-switch");
  switchRoot.dataset.mode = dayBoundaryMode;
  switchRoot.setAttribute("role", "group");
  switchRoot.setAttribute("aria-label", "日期歸屬模式");

  const calendarButton = renderBoundarySwitchButton(root, "calendar", "24H", disabled);
  const thirtyHourButton = renderBoundarySwitchButton(root, "thirty-hour", "30H", disabled);
  switchRoot.append(calendarButton, thirtyHourButton);

  return switchRoot;
};

const renderBoundarySwitchButton = (
  root: HTMLElement,
  mode: DayBoundaryMode,
  label: string,
  disabled: boolean
): HTMLButtonElement => {
  const button = element("button", "ani-heatmap-switch-button") as HTMLButtonElement;
  button.type = "button";
  button.textContent = label;
  button.disabled = disabled;
  button.setAttribute("aria-pressed", String(dayBoundaryMode === mode));
  button.addEventListener("click", () => {
    if (dayBoundaryMode === mode) {
      return;
    }

    dayBoundaryMode = mode;
    saveDayBoundaryMode(mode);
    currentEntries = dedupeEntries(parseWatchEntriesFromDom(dayBoundaryMode))
      .sort((a, b) => a.watchedAt.getTime() - b.watchedAt.getTime());
    renderHeatmap(root, currentEntries);
  });

  return button;
};

const renderMonthLabels = (weeks: DailyWatch[][]): HTMLElement => {
  const months = element("div", "ani-heatmap-months");
  let previousMonth: number | null = null;

  weeks.forEach((week, index) => {
    const label = element("span");
    const firstVisibleDay = week.find((day) => isValidDate(day.date));
    const currentMonth = firstVisibleDay?.date.getMonth();

    if (firstVisibleDay && currentMonth !== undefined && (index === 0 || currentMonth !== previousMonth)) {
      label.textContent = zhMonthFormatter.format(firstVisibleDay.date);
      previousMonth = currentMonth;
    }

    months.append(label);
  });

  return months;
};

const renderWeekdayLabels = (): HTMLElement => {
  const weekdays = element("div", "ani-heatmap-weekdays");
  ["", "週一", "", "週三", "", "週五", ""].forEach((label) => {
    const item = element("span");
    item.textContent = label;
    weekdays.append(item);
  });
  return weekdays;
};

const renderGrid = (weeks: DailyWatch[][], maxCount: number): HTMLElement => {
  const grid = element("div", "ani-heatmap-grid");

  for (const week of weeks) {
    for (const day of week) {
      const button = element("button", "ani-heatmap-day") as HTMLButtonElement;
      const count = day.entries.length;
      const isPadding = !isValidDate(day.date);
      button.type = "button";
      button.dataset.level = String(getLevel(count, maxCount));
      button.dataset.date = day.dateKey;
      button.setAttribute("aria-label", `${formatDisplayDate(day.date)}，觀看 ${count} 集`);

      if (isPadding) {
        button.dataset.outOfRange = "true";
      } else {
        button.addEventListener("mouseenter", () => showTooltip(button, day));
        button.addEventListener("focus", () => showTooltip(button, day));
        button.addEventListener("mouseleave", hideTooltip);
        button.addEventListener("blur", hideTooltip);
      }

      grid.append(button);
    }
  }

  return grid;
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

const showTooltip = (target: HTMLElement, day: DailyWatch): void => {
  hideTooltip();

  tooltip = element("div", "ani-heatmap-tooltip");
  const title = element("div", "ani-heatmap-tooltip-title");
  title.textContent = day.entries.length === 0
    ? `${formatDisplayDate(day.date)} 沒有觀看紀錄`
    : `${formatDisplayDate(day.date)} 看了 ${day.entries.length} 集`;
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

  document.body.append(tooltip);
  positionTooltip(target, tooltip);
};

const hideTooltip = (): void => {
  tooltip?.remove();
  tooltip = null;
};

const positionTooltip = (target: HTMLElement, panel: HTMLElement): void => {
  const targetRect = target.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const margin = 12;
  const topCandidate = targetRect.bottom + 10;
  const bottomCandidate = targetRect.top - panelRect.height - 10;
  const top = topCandidate + panelRect.height + margin <= window.innerHeight
    ? topCandidate
    : Math.max(margin, bottomCandidate);
  const left = Math.min(
    Math.max(margin, targetRect.left + targetRect.width / 2 - panelRect.width / 2),
    window.innerWidth - panelRect.width - margin
  );

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
};

const buildDailyWatches = (entries: WatchEntry[]): DailyWatch[] => {
  const today = startOfDay(new Date());
  const start = addDays(today, -364);
  const entriesByDate = new Map<string, WatchEntry[]>();

  for (const entry of entries) {
    const existing = entriesByDate.get(entry.dateKey) ?? [];
    existing.push(entry);
    entriesByDate.set(entry.dateKey, existing);
  }

  return Array.from({ length: 365 }, (_, offset) => {
    const date = addDays(start, offset);
    const dateKey = toDateKey(date);
    const dayEntries = entriesByDate.get(dateKey) ?? [];
    return {
      dateKey,
      date,
      entries: dayEntries.slice().sort((a, b) => a.watchedAt.getTime() - b.watchedAt.getTime())
    };
  });
};

const getLongestWatchStreak = (days: DailyWatch[]): number => {
  let longest = 0;
  let current = 0;

  for (const day of days) {
    if (day.entries.length > 0) {
      current += 1;
      longest = Math.max(longest, current);
      continue;
    }

    current = 0;
  }

  return longest;
};

const chunkDaysByWeek = (days: DailyWatch[]): DailyWatch[][] => {
  const firstWeekday = days[0]?.date.getDay() ?? 0;
  const paddingBefore = Array.from({ length: firstWeekday }, () => createPaddingDay());
  const padded = [...paddingBefore, ...days];
  const paddingAfter = (7 - (padded.length % 7)) % 7;
  padded.push(...Array.from({ length: paddingAfter }, () => createPaddingDay()));

  const weeks: DailyWatch[][] = [];
  for (let index = 0; index < padded.length; index += 7) {
    weeks.push(padded.slice(index, index + 7));
  }

  return weeks;
};

const createPaddingDay = (): DailyWatch => ({
  dateKey: "",
  date: new Date(Number.NaN),
  entries: []
});

const getLevel = (count: number, maxCount: number): number => {
  if (count <= 0) {
    return 0;
  }

  if (maxCount <= 4) {
    return Math.min(4, count);
  }

  if (count >= Math.ceil(maxCount * 0.75)) {
    return 4;
  }

  if (count >= Math.ceil(maxCount * 0.5)) {
    return 3;
  }

  if (count >= Math.ceil(maxCount * 0.25)) {
    return 2;
  }

  return 1;
};

const isWithinLastYear = (date: Date): boolean => {
  const today = startOfDay(new Date());
  const start = addDays(today, -364);
  const checked = startOfDay(date);
  return checked.getTime() >= start.getTime() && checked.getTime() <= today.getTime();
};

const parseWatchDate = (text: string): Date | null => {
  const absolute = text.match(/\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\s+(\d{1,2}):(\d{2})\b/);
  if (absolute) {
    const [, year, month, day, hour, minute] = absolute;
    return validDateOrNull(new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
  }

  const relativeDay = text.match(/^(昨天|前天)\s+(\d{1,2}):(\d{2})$/);
  if (relativeDay) {
    const [, label, hour, minute] = relativeDay;
    const date = addDays(startOfDay(new Date()), label === "昨天" ? -1 : -2);
    date.setHours(Number(hour), Number(minute), 0, 0);
    return validDateOrNull(date);
  }

  const relativeMinutes = text.match(/^(\d+)\s*分前$/);
  if (relativeMinutes?.[1]) {
    return validDateOrNull(new Date(Date.now() - Number(relativeMinutes[1]) * 60 * 1000));
  }

  const relativeHours = text.match(/^(\d+)\s*小時前$/);
  if (relativeHours?.[1]) {
    return validDateOrNull(new Date(Date.now() - Number(relativeHours[1]) * 60 * 60 * 1000));
  }

  if (text === "1 分內") {
    return new Date();
  }

  return null;
};

const findInsertionAnchor = (): Element | null => {
  return Array.from(document.querySelectorAll<HTMLElement>("h1, h2, .page-title, [class*='title']"))
    .find((element) => /觀看紀錄|觀看記錄/.test(normalizeText(element.textContent ?? ""))) ?? null;
};

const isHistoryPage = (): boolean => {
  const path = location.pathname.toLowerCase();
  if (/history|record|watch/.test(path)) {
    return true;
  }

  const pageTitle = normalizeText(document.title);
  if (/觀看紀錄|觀看記錄/.test(pageTitle)) {
    return true;
  }

  return Array.from(document.querySelectorAll<HTMLElement>("h1, h2, .page-title, [class*='title']"))
    .some((element) => /觀看紀錄|觀看記錄/.test(normalizeText(element.textContent ?? "")));
};

const isExtensionMutation = (mutation: MutationRecord): boolean => {
  const root = document.getElementById(EXTENSION_ROOT_ID);
  if (!root) {
    return false;
  }

  const target = mutation.target;
  const targetIsExtension = target === root || (target instanceof Element && Boolean(target.closest(`#${EXTENSION_ROOT_ID}`)));
  const addedNodesAreExtension = mutation.addedNodes.length > 0 && Array.from(mutation.addedNodes).every((node) => {
    return node === root || (node instanceof Element && Boolean(node.closest(`#${EXTENSION_ROOT_ID}`)));
  });
  const removedNodesAreExtension = mutation.removedNodes.length > 0 && Array.from(mutation.removedNodes).every((node) => {
    return node === root || (node instanceof Element && node.id === EXTENSION_ROOT_ID);
  });

  return targetIsExtension || addedNodesAreExtension || removedNodesAreExtension;
};

const isHistoryMutation = (mutation: MutationRecord): boolean => {
  const changedNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
  return changedNodes.some((node) => {
    if (!(node instanceof Element)) {
      return false;
    }

    return node.matches(".user-watchTime-list, .history-list-anime-title, .date")
      || Boolean(node.querySelector(".user-watchTime-list, .history-list-anime-title, .date"));
  });
};

const injectStyle = (): void => {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.append(style);
};

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const startOfDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const toDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const toWatchDate = (date: Date, mode: DayBoundaryMode): Date => {
  return mode === "calendar" || date.getHours() >= 6 ? date : addDays(date, -1);
};

const formatDisplayDate = (date: Date): string => {
  if (!isValidDate(date)) {
    return "";
  }

  return zhDateFormatter.format(date);
};

const validDateOrNull = (date: Date): Date | null => isValidDate(date) ? date : null;

const isValidDate = (date: Date): boolean => !Number.isNaN(date.getTime());

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return `讀取觀看紀錄失敗：${error.message}`;
  }

  return "讀取觀看紀錄失敗。";
};

function loadDayBoundaryMode(): DayBoundaryMode {
  const saved = window.localStorage.getItem(DAY_BOUNDARY_MODE_STORAGE_KEY);
  return saved === "calendar" || saved === "thirty-hour" ? saved : "thirty-hour";
}

const saveDayBoundaryMode = (mode: DayBoundaryMode): void => {
  window.localStorage.setItem(DAY_BOUNDARY_MODE_STORAGE_KEY, mode);
};

const normalizeText = (text: string): string => cleanText(text).replace(/\s+/g, " ");

const cleanText = (text: string): string => text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

const element = (tagName: string, className?: string): HTMLElement => {
  const node = document.createElement(tagName);
  if (className) {
    node.className = className;
  }
  return node;
};

void main();

export {};
