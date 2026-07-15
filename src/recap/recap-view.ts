import type { AnalyticsResult } from "../analytics";
import {
  formatCompactDuration,
  formatDuration,
  formatInteger,
  formatLag,
  formatPercent
} from "../analysis-format";
import { createButton, createCover, element, textElement } from "../view-dom";
import {
  buildRecapDeck,
  type RecapEvidenceRow,
  type RecapPresentationChapter,
  type RecapPresentationDeck
} from "./recap-deck";
import type { RecapUiState } from "./recap-state";

export type RecapSurfaceRenderOptions = {
  readonly state: RecapUiState<RecapPresentationDeck>;
  readonly result: AnalyticsResult;
  readonly onStart: () => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onOpenEvidence: () => void;
  readonly onCloseEvidence: () => void;
  readonly onRestart: () => void;
  readonly onDashboard: () => void;
  readonly onAnimationFinished: () => void;
};

export const RECAP_EVIDENCE_OPENER_FOCUS_KEY = "recap-evidence-opener";

export const renderRecapSurface = (options: RecapSurfaceRenderOptions): HTMLElement => {
  if (options.state.kind === "recap-intro") return renderIntro(options);
  if (options.state.kind === "recap-chapter") return renderChapterStage(options);
  if (options.state.kind === "recap-evidence") return renderEvidenceStage(options);
  if (options.state.kind === "recap-outro") return renderOutro(options);
  return renderInvalidState(options.onDashboard);
};

const renderIntro = (options: RecapSurfaceRenderOptions): HTMLElement => {
  const deck = buildRecapDeck(options.result);
  const root = element("section", "ani-recap-intro");
  root.append(renderBackdrop());

  const content = element("div", "ani-recap-intro-content");
  const copy = element("div", "ani-recap-intro-copy");
  const axis = options.result.scope.axis === "released-at"
    ? "沿著作品實際上架的日子展開"
    : "沿著你的觀看時間展開";
  const title = renderStoryTitle("h3", "ani-recap-intro-title", recapTitle(options.result));
  title.tabIndex = -1;
  title.dataset.recapFocus = "true";
  const introCopy = deck.chapters.length === 0
    ? "這段期間沒有觀看紀錄。"
    : options.result.scope.axis === "released-at"
      ? `${formatInteger(options.result.summary.watchCount)} 次觀看，來自這段期間上架的 ${formatInteger(options.result.summary.animeCount)} 部作品。看看你最常看哪一季，又先選了誰。`
      : `${formatInteger(options.result.summary.watchCount)} 次觀看，來自 ${formatInteger(options.result.summary.animeCount)} 部作品。看看你最常看什麼，又先選了誰。`;
  copy.append(
    textElement("p", "ani-recap-eyebrow", axis),
    title,
    textElement("p", "ani-recap-intro-lede", introCopy)
  );

  const facts = element("div", "ani-recap-intro-facts");
  facts.append(
    introFact("不同單集", options.result.summary.uniqueEpisodeCount),
    introFact("作品", options.result.summary.animeCount)
  );
  if (options.result.summary.knownContentMinutes > 0) {
    facts.append(introFact("觀看片長", options.result.summary.knownContentMinutes, "compact-duration"));
  }
  copy.append(facts);

  const actions = element("div", "ani-recap-intro-actions");
  const start = createButton("ani-recap-primary-button", "開始回顧");
  start.disabled = deck.chapters.length === 0;
  start.addEventListener("click", options.onStart);
  const dashboard = createButton("ani-recap-ghost-button", "回到分析總覽");
  dashboard.addEventListener("click", options.onDashboard);
  actions.append(start, dashboard);
  copy.append(actions);
  content.append(copy);

  const posterCovers = collectIntroCovers(options.result);
  content.dataset.poster = String(posterCovers.length > 0);
  if (posterCovers.length > 0) {
    const poster = element("div", "ani-recap-intro-poster");
    poster.setAttribute("aria-hidden", "true");
    for (const cover of posterCovers) {
      poster.append(createCover(cover.url, "", "ani-recap-poster-cover"));
    }
    content.append(poster);
  }

  root.append(content);
  return root;
};

const renderChapterStage = (options: RecapSurfaceRenderOptions): HTMLElement => {
  if (options.state.kind !== "recap-chapter") return renderInvalidState(options.onDashboard);
  const chapter = findChapter(options.state.deck, options.state.chapterId);
  if (!chapter) return renderInvalidState(options.onDashboard);
  const index = options.state.deck.chapters.indexOf(chapter);
  const stage = stageShell();
  stage.dataset.chapter = chapter.kind;
  stage.dataset.transition = options.state.transition.phase === "running"
    ? options.state.transition.direction
    : "idle";
  bindStageKeys(stage, options.onPrevious, options.onNext);

  const chrome = renderPlaybackChrome(options.state.deck, index, options.state.stale);
  const content = element("div", "ani-recap-chapter-content");
  const copy = element("div", "ani-recap-chapter-copy");
  const heading = renderStoryTitle("h3", "ani-recap-chapter-title", chapter.title);
  heading.tabIndex = -1;
  heading.dataset.recapFocus = "true";
  copy.append(
    textElement("p", "ani-recap-eyebrow", chapter.eyebrow),
    heading,
    textElement("p", "ani-recap-narrative", chapter.narrative)
  );
  const visual = element("div", "ani-recap-chapter-visual");
  visual.append(renderChapterPayload(chapter));
  content.append(copy, visual);

  const actions = renderPlaybackActions({
    previousLabel: index === 0 ? "回到開場" : "上一章",
    nextLabel: index === options.state.deck.chapters.length - 1 ? "看結尾" : "下一章",
    disabled: options.state.transition.phase === "running",
    onPrevious: options.onPrevious,
    onNext: options.onNext,
    onEvidence: options.onOpenEvidence
  });
  stage.append(chrome, content, actions);
  attachAnimationCompletion(stage, options.state.transition.phase === "running", options.onAnimationFinished);
  return stage;
};

const renderEvidenceStage = (options: RecapSurfaceRenderOptions): HTMLElement => {
  if (options.state.kind !== "recap-evidence") return renderInvalidState(options.onDashboard);
  const chapter = findChapter(options.state.deck, options.state.chapterId);
  if (!chapter) return renderInvalidState(options.onDashboard);
  const index = options.state.deck.chapters.indexOf(chapter);
  const stage = stageShell();
  stage.dataset.chapter = chapter.kind;
  stage.append(renderPlaybackChrome(options.state.deck, index, options.state.stale));

  const veil = element("div", "ani-recap-evidence-veil");
  veil.addEventListener("click", (event) => {
    if (event.target === veil) options.onCloseEvidence();
  });
  const panel = element("section", "ani-recap-evidence-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", `${chapter.title}的資料依據`);
  const heading = textElement("h3", "ani-recap-evidence-title", "這個結果怎麼算？");
  heading.tabIndex = -1;
  heading.dataset.recapFocus = "true";
  const close = createButton("ani-recap-evidence-close", "×");
  close.setAttribute("aria-label", "關閉資料依據");
  close.addEventListener("click", options.onCloseEvidence);
  const header = element("header", "ani-recap-evidence-header");
  header.append(heading, close);
  const list = element("dl", "ani-recap-evidence-list");
  for (const row of chapter.evidence) list.append(renderEvidenceRow(row));
  panel.append(header, textElement("p", "ani-recap-evidence-chapter", chapter.title), list);
  veil.append(panel);
  stage.append(veil);
  return stage;
};

const renderOutro = (options: RecapSurfaceRenderOptions): HTMLElement => {
  if (options.state.kind !== "recap-outro") return renderInvalidState(options.onDashboard);
  const deck = options.state.deck;
  const stage = stageShell();
  stage.classList.add("ani-recap-outro");
  const takeaway = recapTakeaway(deck);
  stage.dataset.chapter = takeaway.kind;
  stage.dataset.transition = options.state.transition.phase === "running"
    ? options.state.transition.direction
    : "idle";
  bindStageKeys(stage, options.onPrevious, options.onRestart);
  const content = element("div", "ani-recap-outro-content");
  const heading = renderStoryTitle("h3", "ani-recap-outro-title", takeaway.title);
  heading.tabIndex = -1;
  heading.dataset.recapFocus = "true";
  content.append(
    textElement("p", "ani-recap-eyebrow", `${deck.scope.label} · 回顧結尾`),
    heading,
    textElement("p", "ani-recap-narrative", takeaway.narrative)
  );

  const facts = outroFacts(deck);
  if (facts.length > 0) {
    const summary = element("div", "ani-recap-outro-summary");
    for (const fact of facts) {
      const item = element("div", "ani-recap-outro-fact");
      const value = textElement("strong", "", fact.value);
      if (fact.countTo !== undefined) {
        value.dataset.countTo = String(fact.countTo);
        if (fact.countFormat) value.dataset.countFormat = fact.countFormat;
      }
      item.append(value, textElement("span", "", fact.label));
      summary.append(item);
    }
    content.append(summary);
  }

  if (options.state.stale) {
    content.append(textElement("p", "ani-recap-stale", "觀看資料有了新的變化；從頭播放即可查看最新回顧。"));
  }
  const actions = element("div", "ani-recap-outro-actions");
  const restart = createButton("ani-recap-primary-button", "從頭再看一次");
  restart.disabled = options.state.transition.phase === "running";
  restart.addEventListener("click", options.onRestart);
  const previous = createButton("ani-recap-ghost-button", "回上一章");
  previous.disabled = options.state.transition.phase === "running";
  previous.addEventListener("click", options.onPrevious);
  const dashboard = createButton("ani-recap-ghost-button", "查看完整分析");
  dashboard.addEventListener("click", options.onDashboard);
  actions.append(restart, previous, dashboard);
  content.append(actions);
  stage.append(content);
  attachAnimationCompletion(stage, options.state.transition.phase === "running", options.onAnimationFinished);
  return stage;
};

const renderChapterPayload = (chapter: RecapPresentationChapter): HTMLElement => {
  switch (chapter.kind) {
    case "overview": {
      const grid = element("div", "ani-recap-metric-grid");
      const activeDayLabel = chapter.payload.axis === "released-at" ? "上架日" : "觀看日";
      grid.append(
        metric("觀看", chapter.payload.watchCount, "次"),
        metric("不同單集", chapter.payload.uniqueEpisodeCount, "集"),
        metric("作品", chapter.payload.identifiableAnimeCount, "部"),
        metric(activeDayLabel, chapter.payload.activeDayCount, "天")
      );
      return grid;
    }
    case "season-breakdown": {
      const grid = element("div", "ani-recap-season-grid");
      const max = Math.max(1, ...chapter.payload.rows.map((row) => row.watchCount));
      for (const row of chapter.payload.rows) {
        const card = element("article", "ani-recap-season-card");
        card.dataset.season = row.season;
        card.dataset.leading = String(chapter.payload.leadingSeasons.includes(row.season));
        const count = textElement("strong", "ani-recap-season-count", formatInteger(row.watchCount));
        count.dataset.countTo = String(row.watchCount);
        card.append(
          textElement("span", "ani-recap-season-name", row.label),
          count,
          textElement("span", "ani-recap-season-detail", `次觀看 · ${formatInteger(row.animeCount)} 部作品`),
          meterBar(row.watchCount / max, "ani-recap-meter--season")
        );
        grid.append(card);
      }
      return grid;
    }
    case "runtime": {
      const layout = element("div", "ani-recap-payload-stack");
      layout.append(bigMetric(
        formatDuration(chapter.payload.totalContentMinutes),
        "觀看片長合計",
        chapter.payload.totalContentMinutes,
        "duration"
      ));
      const maxMinutes = Math.max(1, ...chapter.payload.rows.map((row) => row.contentMinutes));
      const rows = element("div", "ani-recap-story-ranking");
      for (const row of chapter.payload.rows.slice(0, 4)) {
        rows.append(storyRankingRow({
          rank: row.rank,
          title: row.title,
          coverUrl: row.coverUrl,
          value: formatCompactDuration(row.contentMinutes),
          level: row.contentMinutes / maxMinutes
        }));
      }
      layout.append(rows);
      if (chapter.payload.longestEpisode) {
        layout.append(textElement(
          "p",
          "ani-recap-story-note",
          `最長單集是《${chapter.payload.longestEpisode.title}》${chapter.payload.longestEpisode.episode}，${formatDuration(chapter.payload.longestEpisode.durationMinutes)}。`
        ));
      }
      return layout;
    }
    case "timeliness": {
      const layout = element("div", "ani-recap-payload-stack");
      layout.append(bigMetric(
        formatLag(chapter.payload.overallMedianLagMinutes),
        `通常會等多久 · ${formatPercent(chapter.payload.overallWithin24HoursRate)} 在 24 小時內播放`
      ));
      const fastest = chapter.payload.rows[0]?.medianLagMinutes ?? 0;
      const rows = element("div", "ani-recap-story-ranking");
      for (const row of chapter.payload.rows.slice(0, 4)) {
        rows.append(storyRankingRow({
          rank: row.rank,
          title: row.title,
          coverUrl: row.coverUrl,
          value: formatLag(row.medianLagMinutes),
          level: (fastest + 1) / (row.medianLagMinutes + 1)
        }));
      }
      layout.append(rows);
      return layout;
    }
    case "behavior-preference": {
      const layout = element("div", "ani-recap-payload-stack");
      const leader = chapter.payload.rows[0];
      if (leader) {
        const feature = element("div", "ani-recap-preference-leader");
        feature.append(
          createCover(leader.coverUrl, leader.title, "ani-recap-leader-cover"),
          textElement("span", "ani-recap-leader-label", "行為偏好排行第 1"),
          textElement("strong", "ani-recap-leader-title", leader.title),
          textElement(
            "span",
            "ani-recap-leader-value",
            `${formatInteger(leader.comparisons)} 次比較中，${formatInteger(leader.wins)} 次先看它 · ${formatPercent(leader.rawWinRate)}`
          ),
          meterBar(leader.rawWinRate, "ani-recap-meter--leader")
        );
        layout.append(feature);
      }
      const rows = element("div", "ani-recap-story-ranking");
      for (const row of chapter.payload.rows.slice(1, 5)) {
        rows.append(storyRankingRow({
          rank: row.rank,
          title: row.title,
          coverUrl: row.coverUrl,
          value: formatPercent(row.rawWinRate),
          meta: `${formatInteger(row.wins)} 次先看／${formatInteger(row.comparisons)} 次比較`,
          level: row.rawWinRate
        }));
      }
      layout.append(rows);
      return layout;
    }
    case "taste": {
      const grid = element("div", "ani-recap-taste-grid");
      const dimensions = [
        ["類型", chapter.payload.tags],
        ["動畫公司", chapter.payload.makers],
        ["導演", chapter.payload.directors],
        ["代理商", chapter.payload.publishers]
      ] as const;
      for (const [label, rows] of dimensions) {
        if (rows.length > 0) grid.append(tasteColumn(label, rows));
      }
      return grid;
    }
  }
};

const renderPlaybackChrome = (
  deck: RecapPresentationDeck,
  currentIndex: number,
  stale: boolean
): HTMLElement => {
  const chrome = element("div", "ani-recap-chrome");
  const progress = element("div", "ani-recap-progress");
  progress.setAttribute("aria-label", `回顧進度 ${currentIndex + 1} / ${deck.chapters.length}`);
  deck.chapters.forEach((chapter, index) => {
    const item = element("span");
    item.dataset.active = String(index <= currentIndex);
    item.title = chapter.title;
    progress.append(item);
  });
  const meta = element("div", "ani-recap-chrome-meta");
  const counter = textElement(
    "span",
    "ani-recap-chrome-count",
    `第 ${formatInteger(currentIndex + 1)} 章 / 共 ${formatInteger(deck.chapters.length)} 章`
  );
  counter.setAttribute("aria-hidden", "true");
  meta.append(counter);
  if (stale) {
    meta.append(textElement("span", "ani-recap-stale", "觀看資料有更新；這次回顧仍保留開場時看到的內容"));
  }
  chrome.append(progress, meta);
  return chrome;
};

const renderPlaybackActions = ({
  previousLabel,
  nextLabel,
  disabled,
  onPrevious,
  onNext,
  onEvidence
}: {
  readonly previousLabel: string;
  readonly nextLabel: string;
  readonly disabled: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onEvidence: () => void;
}): HTMLElement => {
  const actions = element("div", "ani-recap-playback-actions");
  const previous = createButton("ani-recap-ghost-button", previousLabel);
  previous.disabled = disabled;
  previous.addEventListener("click", onPrevious);
  const evidence = createButton("ani-recap-evidence-button", "怎麼計算");
  evidence.dataset.analysisFocusKey = RECAP_EVIDENCE_OPENER_FOCUS_KEY;
  evidence.disabled = disabled;
  evidence.addEventListener("click", onEvidence);
  const next = createButton("ani-recap-primary-button", nextLabel);
  next.disabled = disabled;
  next.addEventListener("click", onNext);
  actions.append(previous, evidence, next);
  return actions;
};

const stageShell = (): HTMLElement => {
  const stage = element("section", "ani-recap-stage");
  stage.tabIndex = -1;
  stage.append(renderBackdrop());
  return stage;
};

const renderBackdrop = (): HTMLElement => element("div", "ani-recap-backdrop");

/**
 * Splits a story title so quoted works (《…》「…」) and numerals carry the
 * chapter accent — the sentence stays ink, the payload words glow.
 */
const renderStoryTitle = <K extends "h3">(
  tagName: K,
  className: string,
  title: string
): HTMLElementTagNameMap[K] => {
  const heading = element(tagName, className);
  const pattern = /(《[^《》]*》|「[^「」]*」|[0-9][0-9,.]*)/g;
  let cursor = 0;
  for (const match of title.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) heading.append(title.slice(cursor, index));
    heading.append(textElement("em", "ani-recap-title-em", match[0]));
    cursor = index + match[0].length;
  }
  if (cursor < title.length) heading.append(title.slice(cursor));
  return heading;
};

type StoryRankingRowOptions = {
  readonly rank: number;
  readonly title: string;
  readonly coverUrl: string | null;
  readonly value: string;
  readonly meta?: string;
  readonly level?: number;
};

const storyRankingRow = (options: StoryRankingRowOptions): HTMLElement => {
  const row = element("article", "ani-recap-ranking-row");
  const copy = element("div", "ani-recap-ranking-copy");
  copy.append(textElement("strong", "ani-recap-ranking-title", options.title));
  if (options.meta) copy.append(textElement("span", "ani-recap-ranking-meta", options.meta));
  if (options.level !== undefined) copy.append(meterBar(options.level));
  row.append(
    textElement("span", "ani-recap-ranking-rank", String(options.rank)),
    createCover(options.coverUrl, options.title, "ani-recap-ranking-cover"),
    copy,
    textElement("span", "ani-recap-ranking-value", options.value)
  );
  return row;
};

const meterBar = (level: number, className = ""): HTMLElement => {
  const meter = element("span", className ? `ani-recap-meter ${className}` : "ani-recap-meter");
  meter.setAttribute("aria-hidden", "true");
  meter.style.setProperty("--rc-level", String(Math.min(1, Math.max(0, level))));
  return meter;
};

const tasteColumn = (
  title: string,
  rows: readonly { readonly label: string; readonly watchCount: number }[]
): HTMLElement => {
  const card = element("section", "ani-recap-taste-column");
  card.append(textElement("h4", "", title));
  const list = element("ol");
  const max = Math.max(1, ...rows.map((row) => row.watchCount));
  for (const row of rows.slice(0, 5)) {
    const item = element("li");
    const head = element("div", "ani-recap-taste-line");
    head.append(
      textElement("span", "", row.label),
      textElement("strong", "", `${formatInteger(row.watchCount)} 次`)
    );
    item.append(head, meterBar(row.watchCount / max));
    list.append(item);
  }
  card.append(list);
  return card;
};

const metric = (label: string, value: number, unit: string): HTMLElement => {
  const card = element("article", "ani-recap-metric");
  const valueEl = textElement("strong", "ani-recap-metric-value", formatInteger(value));
  valueEl.dataset.countTo = String(value);
  card.append(
    textElement("span", "ani-recap-metric-label", label),
    valueEl,
    textElement("span", "ani-recap-metric-unit", unit)
  );
  return card;
};

const bigMetric = (
  value: string,
  caption: string,
  countTo?: number,
  countFormat?: "duration" | "compact-duration"
): HTMLElement => {
  const block = element("div", "ani-recap-big-metric");
  const strong = textElement("strong", "", value);
  if (countTo !== undefined) {
    strong.dataset.countTo = String(countTo);
    if (countFormat) strong.dataset.countFormat = countFormat;
  }
  block.append(strong, textElement("span", "", caption));
  return block;
};

const introFact = (
  label: string,
  value: number,
  format: "integer" | "compact-duration" = "integer"
): HTMLElement => {
  const item = element("div", "ani-recap-intro-fact");
  const text = format === "compact-duration" ? formatCompactDuration(value) : formatInteger(value);
  const strong = textElement("strong", "", text);
  strong.dataset.countTo = String(value);
  if (format !== "integer") strong.dataset.countFormat = format;
  item.append(textElement("span", "", label), strong);
  return item;
};

type IntroCover = { readonly url: string };

const collectIntroCovers = (result: AnalyticsResult): readonly IntroCover[] => {
  const candidates: (string | null)[] = [];
  if (result.runtime.available) {
    for (const row of result.runtime.rows) candidates.push(row.coverUrl);
  }
  if (result.preference.available) {
    for (const row of result.preference.rows) candidates.push(row.coverUrl);
  }
  if (result.currentPlatformSnapshotComparison.available) {
    for (const row of result.currentPlatformSnapshotComparison.rows) candidates.push(row.coverUrl);
  }
  const unique: string[] = [];
  for (const url of candidates) {
    if (url && !unique.includes(url)) unique.push(url);
    if (unique.length === 3) break;
  }
  return unique.map((url) => ({ url }));
};

type OutroFact = {
  readonly label: string;
  readonly value: string;
  readonly countTo?: number;
  readonly countFormat?: "duration" | "compact-duration";
};

const outroFacts = (deck: RecapPresentationDeck): readonly OutroFact[] => {
  const facts: OutroFact[] = [];
  for (const chapter of deck.chapters) {
    if (chapter.kind === "overview") {
      facts.push(
        { label: "次觀看", value: formatInteger(chapter.payload.watchCount), countTo: chapter.payload.watchCount },
        { label: "部作品", value: formatInteger(chapter.payload.identifiableAnimeCount), countTo: chapter.payload.identifiableAnimeCount }
      );
    }
    if (chapter.kind === "runtime") {
      facts.push({
        label: "觀看片長",
        value: formatCompactDuration(chapter.payload.totalContentMinutes),
        countTo: chapter.payload.totalContentMinutes,
        countFormat: "compact-duration"
      });
    }
    if (chapter.kind === "timeliness") {
      facts.push({ label: "通常等待", value: formatLag(chapter.payload.overallMedianLagMinutes) });
    }
  }
  return facts.slice(0, 4);
};

const renderEvidenceRow = (row: RecapEvidenceRow): DocumentFragment => {
  const fragment = document.createDocumentFragment();
  fragment.append(textElement("dt", "", row.label), textElement("dd", "", formatEvidenceValue(row)));
  return fragment;
};

const formatEvidenceValue = (row: RecapEvidenceRow): string => {
  switch (row.kind) {
    case "count": return `${formatInteger(row.value)} ${evidenceUnit(row.unit)}`;
    case "minutes": return formatDuration(row.minutes);
    case "ratio": return row.ratio === null
      ? `${row.numerator} / ${row.denominator}`
      : `${row.numerator} / ${row.denominator}（${formatPercent(row.ratio)}）`;
    case "text": return row.value;
  }
};

const evidenceUnit = (unit: Extract<RecapEvidenceRow, { kind: "count" }>["unit"]): string => {
  switch (unit) {
    case "watch": return "次觀看";
    case "episode": return "集";
    case "anime": return "部";
    case "day": return "天";
    case "choice": return "次選擇";
    case "sample": return "個樣本";
  }
};

const findChapter = (
  deck: RecapPresentationDeck,
  chapterId: string
): RecapPresentationChapter | undefined => deck.chapters.find((chapter) => chapter.id === chapterId);

const recapTakeaway = (
  deck: RecapPresentationDeck
): Pick<RecapPresentationChapter, "title" | "narrative" | "kind"> => {
  const priority: readonly RecapPresentationChapter["kind"][] = [
    "behavior-preference",
    "timeliness",
    "runtime",
    "taste",
    "season-breakdown",
    "overview"
  ];
  for (const kind of priority) {
    const chapter = deck.chapters.find((candidate) => candidate.kind === kind);
    if (chapter) return chapter;
  }
  return {
    kind: "overview",
    title: "這段期間沒有觀看紀錄",
    narrative: "換一個期間，再看看你的觀看習慣。"
  };
};

const recapTitle = (result: AnalyticsResult): string => {
  const period = result.scope.period;
  if (period.kind === "calendar-year") return `${period.year} 年度回顧`;
  if (period.kind === "calendar-season") return `${period.year} 年${seasonName(period.season)}回顧`;
  if (period.kind === "calendar-month") return `${period.year} 年 ${period.month} 月回顧`;
  return period.days === 365 ? "過去一年回顧" : "近 30 日回顧";
};

const seasonName = (season: "winter" | "spring" | "summer" | "autumn"): string => {
  switch (season) {
    case "winter": return "冬季";
    case "spring": return "春季";
    case "summer": return "夏季";
    case "autumn": return "秋季";
  }
};

const bindStageKeys = (stage: HTMLElement, onPrevious: () => void, onNext: () => void): void => {
  stage.addEventListener("keydown", (event) => {
    handleRecapStageNavigationKey(event, onPrevious, onNext);
  });
};

export const handleRecapStageNavigationKey = (
  event: Pick<KeyboardEvent,
    "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "preventDefault" | "stopPropagation"
  >,
  onPrevious: () => void,
  onNext: () => void
): boolean => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return false;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "ArrowLeft") onPrevious();
  else onNext();
  return true;
};

const attachAnimationCompletion = (
  stage: HTMLElement,
  running: boolean,
  onAnimationFinished: () => void
): void => {
  if (!running) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    queueMicrotask(onAnimationFinished);
    return;
  }
  // Only the stage's own enter animation ends the transition; staggered child
  // content animations bubble up too, so ignore anything that isn't the stage.
  const handler = (event: AnimationEvent): void => {
    if (event.target !== stage) return;
    stage.removeEventListener("animationend", handler);
    onAnimationFinished();
  };
  stage.addEventListener("animationend", handler);
};

const renderInvalidState = (onDashboard: () => void): HTMLElement => {
  const panel = element("section", "ani-recap-invalid");
  panel.append(
    textElement("h3", "", "這份回顧暫時接不上"),
    textElement("p", "", "回到分析總覽，再重新打開一次即可。")
  );
  const action = createButton("ani-recap-primary-button", "回到分析總覽");
  action.addEventListener("click", onDashboard);
  panel.append(action);
  return panel;
};

const RECAP_GRAIN_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3CfeComponentTransfer%3E%3CfeFuncA type='linear' slope='0.055'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23g)'/%3E%3C/svg%3E";

export const recapCss = `
.ani-recap-intro, .ani-recap-stage { position: relative; isolation: isolate; display: grid; min-height: 100%; overflow: hidden; background: var(--rc-bg); color: var(--rc-ink);
  --rc-bg: #060a14;
  --rc-ink: #f4f7ff;
  --rc-ink-2: rgba(214, 224, 248, .82);
  --rc-ink-3: rgba(163, 180, 216, .62);
  --rc-line: rgba(148, 170, 220, .17);
  --rc-line-strong: rgba(148, 170, 220, .34);
  --rc-surface: rgba(146, 172, 228, .07);
  --rc-surface-strong: rgba(146, 172, 228, .13);
  --rc-accent: #7dd3fc;
  --rc-on-accent: #081020;
}
.ani-recap-intro { border-radius: 22px; box-shadow: var(--ani-shadow-2); }
.ani-recap-stage[data-chapter="overview"] { --rc-accent: #7dd3fc; }
.ani-recap-stage[data-chapter="season-breakdown"] { --rc-accent: #5eead4; }
.ani-recap-stage[data-chapter="runtime"] { --rc-accent: #c4b5fd; }
.ani-recap-stage[data-chapter="taste"] { --rc-accent: #f9a8d4; }
.ani-recap-stage[data-chapter="timeliness"] { --rc-accent: #6ee7b7; }
.ani-recap-stage[data-chapter="behavior-preference"] { --rc-accent: #fcd34d; }
.ani-recap-backdrop { position: absolute; z-index: -2; inset: 0; overflow: hidden; background:
  radial-gradient(110% 84% at 86% -18%, color-mix(in srgb, var(--rc-accent) 17%, transparent), transparent 56%),
  radial-gradient(92% 70% at -12% 112%, color-mix(in srgb, var(--rc-accent) 9%, transparent), transparent 60%),
  linear-gradient(180deg, #0a1122 0%, #060a14 56%, #04070e 100%); }
.ani-recap-backdrop::before { content: ""; position: absolute; inset: -32%; background:
  radial-gradient(34% 30% at 68% 24%, color-mix(in srgb, var(--rc-accent) 14%, transparent), transparent 70%),
  radial-gradient(28% 26% at 24% 74%, rgba(64, 98, 192, .17), transparent 72%);
  filter: blur(44px); animation: ani-recap-aurora 34s ease-in-out infinite alternate; }
.ani-recap-backdrop::after { content: ""; position: absolute; inset: 0; background:
  url("${RECAP_GRAIN_URI}") repeat,
  radial-gradient(125% 105% at 50% 38%, transparent 58%, rgba(2, 4, 10, .5) 100%); }
.ani-recap-eyebrow { display: flex; align-items: center; gap: 10px; margin: 0; color: var(--rc-accent); font-size: 11px; font-weight: 900; letter-spacing: .24em; text-transform: uppercase; }
.ani-recap-eyebrow::before { content: ""; width: 22px; height: 2px; border-radius: 999px; background: var(--rc-accent); }
.ani-recap-title-em { font-style: normal; color: var(--rc-accent); }
.ani-recap-intro-title { margin: 18px 0 0; max-inline-size: 14em; color: var(--rc-ink); font-size: clamp(38px, 5.6vw, 76px); font-weight: 900; letter-spacing: -.02em; line-height: 1.1; text-wrap: balance; }
.ani-recap-chapter-title { margin: 16px 0 0; max-inline-size: 16em; color: var(--rc-ink); font-size: clamp(30px, 4.2vw, 56px); font-weight: 900; letter-spacing: -.015em; line-height: 1.16; text-wrap: balance; }
.ani-recap-outro-title { margin: 18px 0 0; max-inline-size: 18em; color: var(--rc-ink); font-size: clamp(32px, 4.6vw, 60px); font-weight: 900; letter-spacing: -.015em; line-height: 1.16; text-wrap: balance; }
.ani-recap-intro-title:focus, .ani-recap-chapter-title:focus, .ani-recap-outro-title:focus { outline: none; }
.ani-recap-intro-lede, .ani-recap-narrative { max-inline-size: 27em; margin: 18px 0 0; color: var(--rc-ink-2); font-size: clamp(14px, 1.6vw, 17px); line-height: 1.9; text-wrap: pretty; }
.ani-recap-intro-content { align-self: center; display: grid; grid-template-columns: minmax(0, 1.12fr) minmax(0, .88fr); align-items: center; gap: clamp(26px, 5vw, 70px); width: min(100%, 1180px); margin-inline: auto; padding: clamp(34px, 7vw, 84px) clamp(22px, 6vw, 72px); }
.ani-recap-intro-content[data-poster="false"] { grid-template-columns: minmax(0, 1fr); }
.ani-recap-intro-copy { min-width: 0; }
.ani-recap-intro-facts { display: flex; flex-wrap: wrap; gap: 24px 34px; margin-top: 34px; border-block: 1px solid var(--rc-line); padding: 16px 0; }
.ani-recap-intro-fact { display: grid; gap: 4px; min-width: 92px; }
.ani-recap-intro-fact span { color: var(--rc-ink-3); font-size: 10px; font-weight: 800; letter-spacing: .1em; }
.ani-recap-intro-fact strong { color: var(--rc-ink); font-size: 24px; font-weight: 900; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.ani-recap-intro-actions, .ani-recap-outro-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 32px; }
.ani-recap-intro-poster { position: relative; height: min(48vh, 440px); min-width: 0; }
.ani-recap-poster-cover { position: absolute; overflow: hidden; width: clamp(150px, 15vw, 208px); aspect-ratio: 3 / 4; border: 1px solid rgba(255, 255, 255, .12); border-radius: 16px; background: var(--rc-surface-strong); box-shadow: 0 30px 70px rgba(0, 0, 0, .55); }
.ani-recap-poster-cover img { width: 100%; height: 100%; object-fit: cover; }
.ani-recap-poster-cover:nth-child(1) { z-index: 3; top: 6%; right: 10%; transform: rotate(5deg); animation: ani-recap-float 7s ease-in-out infinite alternate; }
.ani-recap-poster-cover:nth-child(2) { z-index: 2; top: 30%; left: 4%; transform: rotate(-7deg); animation: ani-recap-float 8s ease-in-out .6s infinite alternate-reverse; }
.ani-recap-poster-cover:nth-child(3) { z-index: 1; bottom: 0; right: 34%; opacity: .88; transform: rotate(2deg); animation: ani-recap-float 9s ease-in-out 1.1s infinite alternate; }
.ani-recap-primary-button, .ani-recap-ghost-button, .ani-recap-evidence-button { min-height: 44px; border-radius: var(--ani-r-pill); cursor: pointer; font: inherit; font-size: 12px; font-weight: 900; padding: 10px 20px; transition: transform var(--ani-dur-1) var(--ani-ease), background var(--ani-dur-1) var(--ani-ease), box-shadow var(--ani-dur-1) var(--ani-ease); }
.ani-recap-primary-button { border: 0; background: #f4f7ff; color: #0a1120; box-shadow: 0 14px 34px rgba(2, 6, 18, .5); }
.ani-recap-primary-button:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 18px 40px rgba(2, 6, 18, .6), 0 0 24px color-mix(in srgb, var(--rc-accent) 32%, transparent); }
.ani-recap-ghost-button, .ani-recap-evidence-button { border: 1px solid var(--rc-line-strong); background: rgba(148, 173, 229, .05); color: var(--rc-ink-2); }
.ani-recap-ghost-button:hover:not(:disabled), .ani-recap-evidence-button:hover:not(:disabled) { background: rgba(148, 173, 229, .14); color: var(--rc-ink); }
.ani-recap-primary-button:disabled, .ani-recap-ghost-button:disabled, .ani-recap-evidence-button:disabled { cursor: wait; opacity: .5; }
.ani-recap-stage { height: 100%; min-height: 0; grid-template-rows: auto minmax(0, 1fr) auto; }
.ani-recap-stage[data-transition="forward"] { animation: ani-recap-enter-forward 560ms var(--ani-ease-out) both; }
.ani-recap-stage[data-transition="backward"] { animation: ani-recap-enter-backward 560ms var(--ani-ease-out) both; }
.ani-recap-stage[data-transition="forward"] .ani-recap-chapter-copy > *, .ani-recap-stage[data-transition="backward"] .ani-recap-chapter-copy > * { animation: ani-recap-content-rise 460ms var(--ani-ease-out) both; }
.ani-recap-stage[data-transition] .ani-recap-chapter-copy > *:nth-child(1) { animation-delay: 50ms; }
.ani-recap-stage[data-transition] .ani-recap-chapter-copy > *:nth-child(2) { animation-delay: 110ms; }
.ani-recap-stage[data-transition] .ani-recap-chapter-copy > *:nth-child(3) { animation-delay: 180ms; }
.ani-recap-stage[data-transition="forward"] .ani-recap-chapter-visual, .ani-recap-stage[data-transition="backward"] .ani-recap-chapter-visual { animation: ani-recap-content-rise 520ms var(--ani-ease-out) 230ms both; }
.ani-recap-stage[data-transition="forward"] .ani-recap-outro-content > *, .ani-recap-stage[data-transition="backward"] .ani-recap-outro-content > * { animation: ani-recap-content-rise 460ms var(--ani-ease-out) both; }
.ani-recap-stage[data-transition] .ani-recap-outro-content > *:nth-child(1) { animation-delay: 50ms; }
.ani-recap-stage[data-transition] .ani-recap-outro-content > *:nth-child(2) { animation-delay: 110ms; }
.ani-recap-stage[data-transition] .ani-recap-outro-content > *:nth-child(3) { animation-delay: 180ms; }
.ani-recap-stage[data-transition] .ani-recap-outro-content > *:nth-child(n + 4) { animation-delay: 240ms; }
.ani-recap-chrome { position: relative; z-index: 2; display: grid; gap: 9px; width: min(100%, 1180px); margin-inline: auto; padding: 20px clamp(20px, 5vw, 58px) 0; }
.ani-recap-progress { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 6px; }
.ani-recap-progress span { height: 4px; border-radius: 999px; background: rgba(148, 170, 220, .18); transition: background var(--ani-dur-2) var(--ani-ease), box-shadow var(--ani-dur-2) var(--ani-ease); }
.ani-recap-progress span[data-active="true"] { background: var(--rc-accent); box-shadow: 0 0 12px color-mix(in srgb, var(--rc-accent) 55%, transparent); }
.ani-recap-chrome-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ani-recap-chrome-count { color: var(--rc-ink-3); font-size: 10px; font-weight: 800; letter-spacing: .14em; font-variant-numeric: tabular-nums; }
.ani-recap-stale { width: fit-content; border: 1px solid rgba(252, 211, 77, .45); border-radius: 999px; background: rgba(252, 211, 77, .12); color: #fcd34d; font-size: 9px; font-weight: 800; padding: 4px 10px; }
.ani-recap-chapter-content { align-self: stretch; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: center; align-content: safe center; gap: clamp(26px, 5vw, 72px); width: min(100%, 1180px); min-height: 0; margin-inline: auto; overflow-y: auto; overscroll-behavior: contain; padding: 30px clamp(22px, 6vw, 72px); }
.ani-recap-chapter-copy { min-width: 0; }
.ani-recap-chapter-visual { min-width: 0; }
.ani-recap-playback-actions { position: relative; z-index: 2; display: grid; grid-template-columns: max-content 1fr max-content; align-items: center; gap: 10px; width: min(100%, 1180px); margin-inline: auto; border-top: 1px solid var(--rc-line); padding: 16px clamp(20px, 5vw, 58px) max(22px, env(safe-area-inset-bottom)); }
.ani-recap-evidence-button { justify-self: center; }
.ani-recap-payload-stack { display: grid; gap: 16px; }
.ani-recap-metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ani-recap-metric { display: grid; gap: 4px; align-content: end; min-height: 128px; border: 1px solid var(--rc-line); border-radius: 18px; background: var(--rc-surface); padding: 18px 20px; }
.ani-recap-metric-label { color: var(--rc-ink-3); font-size: 10px; font-weight: 800; letter-spacing: .1em; }
.ani-recap-metric-value { color: var(--rc-ink); font-size: clamp(30px, 3.4vw, 46px); font-weight: 900; line-height: 1; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.ani-recap-metric-unit { color: var(--rc-accent); font-size: 11px; font-weight: 800; }
.ani-recap-season-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ani-recap-season-card { position: relative; isolation: isolate; display: grid; gap: 3px; align-content: end; overflow: hidden; min-height: 138px; border: 1px solid var(--rc-line); border-radius: 18px; background: var(--rc-surface); padding: 18px; }
.ani-recap-season-card::before { content: ""; position: absolute; z-index: -1; inset: 0; background: radial-gradient(130% 95% at 82% -30%, color-mix(in srgb, var(--rc-season, var(--rc-accent)) 22%, transparent), transparent 62%); }
.ani-recap-season-card[data-season="winter"] { --rc-season: #7dd3fc; }
.ani-recap-season-card[data-season="spring"] { --rc-season: #6ee7b7; }
.ani-recap-season-card[data-season="summer"] { --rc-season: #fcd34d; }
.ani-recap-season-card[data-season="autumn"] { --rc-season: #fb923c; }
.ani-recap-season-card[data-leading="true"] { border-color: color-mix(in srgb, var(--rc-season, var(--rc-accent)) 62%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--rc-season, var(--rc-accent)) 40%, transparent), 0 18px 44px color-mix(in srgb, var(--rc-season, var(--rc-accent)) 13%, transparent); }
.ani-recap-season-name { color: color-mix(in srgb, var(--rc-season, var(--rc-accent)) 80%, #ffffff); font-size: 11px; font-weight: 900; letter-spacing: .08em; }
.ani-recap-season-count { margin-top: 10px; color: var(--rc-ink); font-size: clamp(26px, 3vw, 38px); font-weight: 900; line-height: 1; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.ani-recap-season-detail { color: var(--rc-ink-3); font-size: 10px; }
.ani-recap-meter { position: relative; display: block; overflow: hidden; width: 100%; height: 4px; margin-top: 8px; border-radius: 999px; background: rgba(148, 170, 220, .16); }
.ani-recap-meter::after { content: ""; position: absolute; inset: 0; width: calc(var(--rc-level, 0) * 100%); border-radius: inherit; background: var(--rc-meter, var(--rc-accent)); box-shadow: 0 0 10px color-mix(in srgb, var(--rc-meter, var(--rc-accent)) 45%, transparent); }
.ani-recap-meter--season::after { --rc-meter: var(--rc-season, var(--rc-accent)); }
.ani-recap-stage[data-transition="forward"] .ani-recap-meter::after, .ani-recap-stage[data-transition="backward"] .ani-recap-meter::after { transform-origin: left center; animation: ani-recap-meter-grow 640ms var(--ani-ease-out) 340ms both; }
.ani-recap-big-metric { display: grid; align-content: center; min-height: 132px; border: 1px solid color-mix(in srgb, var(--rc-accent) 34%, transparent); border-radius: 20px; background: linear-gradient(140deg, color-mix(in srgb, var(--rc-accent) 15%, transparent), var(--rc-surface) 58%); padding: 22px 24px; }
.ani-recap-big-metric strong { color: var(--rc-accent); font-size: clamp(32px, 3.8vw, 50px); font-weight: 900; letter-spacing: -.03em; line-height: 1.08; font-variant-numeric: tabular-nums; }
.ani-recap-big-metric span { margin-top: 8px; color: var(--rc-ink-3); font-size: 11px; font-weight: 700; }
.ani-recap-story-ranking { display: grid; }
.ani-recap-ranking-row { display: grid; grid-template-columns: 22px 46px minmax(0, 1fr) max-content; align-items: center; gap: 14px; border-bottom: 1px solid var(--rc-line); padding: 10px 0; }
.ani-recap-ranking-rank { color: var(--rc-ink-3); font-size: 12px; font-weight: 900; text-align: center; font-variant-numeric: tabular-nums; }
.ani-recap-ranking-cover { overflow: hidden; width: 46px; aspect-ratio: 3 / 4; border-radius: 8px; background: var(--rc-surface-strong); box-shadow: 0 8px 20px rgba(0, 0, 0, .35); }
.ani-recap-ranking-cover img { width: 100%; height: 100%; object-fit: cover; }
.ani-recap-ranking-copy { display: grid; gap: 2px; min-width: 0; }
.ani-recap-ranking-copy .ani-recap-meter { margin-top: 6px; max-width: 210px; }
.ani-recap-ranking-title { overflow: hidden; color: var(--rc-ink); font-size: 13px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.ani-recap-ranking-meta { overflow: hidden; color: var(--rc-ink-3); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.ani-recap-ranking-value { color: var(--rc-ink-2); font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums; }
.ani-recap-story-note { margin: 0; color: var(--rc-ink-3); font-size: 11px; line-height: 1.6; }
.ani-recap-preference-leader { position: relative; isolation: isolate; display: grid; grid-template-columns: 104px minmax(0, 1fr); grid-template-rows: repeat(4, min-content); align-content: center; gap: 5px 18px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--rc-accent) 32%, transparent); border-radius: 20px; background: var(--rc-surface); padding: 18px; }
.ani-recap-preference-leader::before { content: ""; position: absolute; z-index: -1; inset: 0; background: radial-gradient(120% 100% at 90% -25%, color-mix(in srgb, var(--rc-accent) 18%, transparent), transparent 60%); }
.ani-recap-leader-cover { grid-row: 1 / -1; overflow: hidden; width: 104px; aspect-ratio: 3 / 4; border-radius: 14px; background: var(--rc-surface-strong); box-shadow: 0 16px 36px rgba(0, 0, 0, .45); }
.ani-recap-leader-cover img { width: 100%; height: 100%; object-fit: cover; }
.ani-recap-leader-label { align-self: end; color: var(--rc-accent); font-size: 10px; font-weight: 900; letter-spacing: .12em; }
.ani-recap-leader-title { color: var(--rc-ink); font-size: 20px; font-weight: 800; line-height: 1.3; }
.ani-recap-leader-value { color: var(--rc-ink-2); font-size: 11px; }
.ani-recap-taste-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 28px; }
.ani-recap-taste-column h4 { margin: 0 0 10px; padding-bottom: 8px; border-bottom: 1px solid var(--rc-line); color: var(--rc-accent); font-size: 11px; font-weight: 900; letter-spacing: .14em; }
.ani-recap-taste-column ol { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.ani-recap-taste-column li { min-width: 0; }
.ani-recap-taste-column li .ani-recap-meter { margin-top: 4px; height: 3px; }
.ani-recap-taste-line { display: flex; justify-content: space-between; gap: 10px; color: var(--rc-ink-2); font-size: 12px; }
.ani-recap-taste-line span { overflow: hidden; color: var(--rc-ink); font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.ani-recap-taste-line strong { color: var(--rc-ink-3); font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ani-recap-evidence-veil { position: absolute; z-index: 5; display: grid; place-items: center; inset: 0; background: rgba(4, 8, 16, .62); padding: 20px; backdrop-filter: blur(12px); animation: ani-recap-fade var(--ani-dur-2) var(--ani-ease) both; }
.ani-recap-evidence-panel { width: min(620px, 100%); max-height: min(720px, calc(100dvh - 80px)); overflow-y: auto; border: 1px solid var(--rc-line-strong); border-radius: var(--ani-r-lg); background: linear-gradient(180deg, rgba(23, 33, 60, .97), rgba(11, 17, 33, .97)); box-shadow: 0 40px 110px rgba(0, 0, 0, .6); color: var(--rc-ink); padding: 22px; animation: ani-pop-in var(--ani-dur-2) var(--ani-ease-out) both; }
.ani-recap-evidence-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.ani-recap-evidence-title { margin: 0; font-size: 20px; font-weight: 800; }
.ani-recap-evidence-close { display: grid; place-items: center; width: 38px; height: 38px; border: 1px solid var(--rc-line-strong); border-radius: 50%; background: transparent; color: var(--rc-ink); cursor: pointer; font: inherit; font-size: 23px; transition: background var(--ani-dur-1) var(--ani-ease); }
.ani-recap-evidence-close:hover { background: rgba(148, 173, 229, .14); }
.ani-recap-evidence-chapter { margin: 5px 0 18px; color: var(--rc-ink-3); font-size: 11px; }
.ani-recap-evidence-list { display: grid; grid-template-columns: minmax(0, 1fr) max-content; gap: 0; margin: 0; }
.ani-recap-evidence-list dt, .ani-recap-evidence-list dd { border-bottom: 1px solid var(--rc-line); margin: 0; padding: 10px 0; font-size: 11px; }
.ani-recap-evidence-list dt { color: var(--rc-ink-3); }
.ani-recap-evidence-list dd { color: var(--rc-ink); font-weight: 850; text-align: right; font-variant-numeric: tabular-nums; }
.ani-recap-outro { place-items: center; grid-template-rows: 1fr; }
.ani-recap-outro-content { display: grid; justify-items: center; width: min(920px, 100%); padding: 40px 24px; text-align: center; }
.ani-recap-outro-content .ani-recap-eyebrow::before { display: none; }
.ani-recap-outro-content .ani-recap-narrative { margin-inline: auto; }
.ani-recap-outro-summary { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 32px; }
.ani-recap-outro-fact { display: grid; gap: 3px; min-width: 130px; border: 1px solid var(--rc-line); border-radius: 16px; background: var(--rc-surface); padding: 16px 20px; }
.ani-recap-outro-fact strong { color: var(--rc-ink); font-size: 22px; font-weight: 900; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.ani-recap-outro-fact span { color: var(--rc-ink-3); font-size: 10px; font-weight: 800; letter-spacing: .08em; }
.ani-recap-outro-actions { justify-content: center; }
.ani-recap-invalid { display: grid; place-items: center; align-content: center; gap: 8px; min-height: 60vh; background: #060a14; color: #f4f7ff; padding: 30px; text-align: center; }
.ani-recap-invalid h3, .ani-recap-invalid p { margin: 0; }
@keyframes ani-recap-enter-forward { from { opacity: 0; transform: translateY(26px) scale(.992); filter: blur(8px); } to { opacity: 1; transform: none; filter: blur(0); } }
@keyframes ani-recap-enter-backward { from { opacity: 0; transform: translateY(-20px) scale(.992); filter: blur(8px); } to { opacity: 1; transform: none; filter: blur(0); } }
@keyframes ani-recap-content-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes ani-recap-meter-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes ani-recap-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes ani-recap-aurora { from { transform: translate3d(-2%, -1%, 0) scale(1); } to { transform: translate3d(2.5%, 3%, 0) scale(1.07); } }
@keyframes ani-recap-float { from { translate: 0 -6px; } to { translate: 0 8px; } }
@media (max-width: 960px) {
  .ani-recap-chapter-content { grid-template-columns: 1fr; align-content: safe center; gap: 26px; }
  .ani-recap-intro-content { grid-template-columns: 1fr; }
  .ani-recap-intro-poster { display: none; }
}
@media (max-width: 760px) {
  .ani-recap-metric-grid, .ani-recap-season-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ani-recap-big-metric { min-height: 110px; }
  .ani-recap-taste-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 480px) {
  .ani-recap-intro-title, .ani-recap-chapter-title, .ani-recap-outro-title { font-size: 34px; }
  .ani-recap-playback-actions { grid-template-columns: max-content minmax(0, 1fr) max-content; gap: 6px; padding-inline: 14px; }
  .ani-recap-playback-actions .ani-recap-primary-button, .ani-recap-playback-actions .ani-recap-ghost-button { width: auto; padding-inline: 12px; }
  .ani-recap-evidence-button { grid-column: auto; grid-row: auto; justify-self: stretch; padding-inline: 10px; }
  .ani-recap-primary-button, .ani-recap-ghost-button { width: 100%; }
  .ani-recap-ranking-row { grid-template-columns: 18px 38px minmax(0, 1fr) max-content; gap: 10px; }
  .ani-recap-ranking-cover { width: 38px; }
  .ani-recap-metric-grid, .ani-recap-season-grid, .ani-recap-taste-grid { grid-template-columns: 1fr; }
}
@media (forced-colors: active) {
  .ani-recap-progress span[data-active="true"], .ani-recap-meter::after { background: Highlight; }
}
`;
