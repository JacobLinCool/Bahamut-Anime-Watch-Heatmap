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
  const axis = options.result.scope.axis === "released-at"
    ? "沿著作品實際上架的日子展開"
    : "沿著你的觀看時間展開";
  const title = textElement("h3", "ani-recap-intro-title", recapTitle(options.result));
  title.tabIndex = -1;
  title.dataset.recapFocus = "true";
  const introCopy = deck.chapters.length === 0
    ? "這段期間沒有觀看紀錄。"
    : options.result.scope.axis === "released-at"
      ? `${formatInteger(options.result.summary.watchCount)} 次觀看，來自這段期間上架的 ${formatInteger(options.result.summary.animeCount)} 部作品。看看你最常看哪一季，又先選了誰。`
      : `${formatInteger(options.result.summary.watchCount)} 次觀看，來自 ${formatInteger(options.result.summary.animeCount)} 部作品。看看你最常看什麼，又先選了誰。`;
  content.append(
    textElement("p", "ani-recap-eyebrow", axis),
    title,
    textElement(
      "p",
      "ani-recap-intro-copy",
      introCopy
    )
  );

  const facts = element("div", "ani-recap-intro-facts");
  facts.append(
    introFact("不同單集", formatInteger(options.result.summary.uniqueEpisodeCount)),
    introFact("作品", formatInteger(options.result.summary.animeCount))
  );
  if (options.result.summary.knownContentMinutes > 0) {
    facts.append(introFact("觀看片長", formatCompactDuration(options.result.summary.knownContentMinutes)));
  }
  content.append(facts);

  const actions = element("div", "ani-recap-intro-actions");
  const start = createButton("ani-recap-primary-button", "開始回顧");
  start.disabled = deck.chapters.length === 0;
  start.addEventListener("click", options.onStart);
  const dashboard = createButton("ani-recap-ghost-button", "回到分析總覽");
  dashboard.addEventListener("click", options.onDashboard);
  actions.append(start, dashboard);
  content.append(actions);

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
  const heading = textElement("h3", "ani-recap-chapter-title", chapter.title);
  heading.tabIndex = -1;
  heading.dataset.recapFocus = "true";
  content.append(
    textElement("p", "ani-recap-eyebrow", chapter.eyebrow),
    heading,
    textElement("p", "ani-recap-narrative", chapter.narrative),
    renderChapterPayload(chapter)
  );

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
  stage.dataset.transition = options.state.transition.phase === "running"
    ? options.state.transition.direction
    : "idle";
  bindStageKeys(stage, options.onPrevious, options.onRestart);
  const content = element("div", "ani-recap-outro-content");
  const takeaway = recapTakeaway(deck);
  const heading = textElement("h3", "ani-recap-outro-title", takeaway.title);
  heading.tabIndex = -1;
  heading.dataset.recapFocus = "true";
  content.append(
    textElement("p", "ani-recap-eyebrow", deck.scope.label),
    heading,
    textElement(
      "p",
      "ani-recap-narrative",
      takeaway.narrative
    )
  );
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
        metric("觀看", formatInteger(chapter.payload.watchCount), "次"),
        metric("不同單集", formatInteger(chapter.payload.uniqueEpisodeCount), "集"),
        metric("作品", formatInteger(chapter.payload.identifiableAnimeCount), "部"),
        metric(activeDayLabel, formatInteger(chapter.payload.activeDayCount), "天")
      );
      return grid;
    }
    case "season-breakdown": {
      const grid = element("div", "ani-recap-season-grid");
      for (const row of chapter.payload.rows) {
        const card = element("article", "ani-recap-season-card");
        card.dataset.season = row.season;
        card.dataset.leading = String(chapter.payload.leadingSeasons.includes(row.season));
        card.append(
          textElement("span", "ani-recap-season-name", row.label),
          textElement("strong", "ani-recap-season-count", `${formatInteger(row.watchCount)} 次觀看`),
          textElement("span", "ani-recap-season-detail", `${formatInteger(row.animeCount)} 部作品`)
        );
        grid.append(card);
      }
      return grid;
    }
    case "runtime": {
      const layout = element("div", "ani-recap-runtime");
      const total = element("div", "ani-recap-big-metric");
      total.append(
        textElement("strong", "", formatDuration(chapter.payload.totalContentMinutes)),
        textElement("span", "", "觀看片長合計")
      );
      const rows = element("div", "ani-recap-story-ranking");
      for (const row of chapter.payload.rows.slice(0, 4)) {
        rows.append(storyRankingRow(row.rank, row.title, row.coverUrl, formatCompactDuration(row.contentMinutes)));
      }
      layout.append(total, rows);
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
      const layout = element("div", "ani-recap-runtime");
      const total = element("div", "ani-recap-big-metric");
      total.append(
        textElement("strong", "", formatLag(chapter.payload.overallMedianLagMinutes)),
        textElement(
          "span",
          "",
          `通常會等多久 · ${formatPercent(chapter.payload.overallWithin24HoursRate)} 在 24 小時內播放`
        )
      );
      const rows = element("div", "ani-recap-story-ranking");
      for (const row of chapter.payload.rows.slice(0, 4)) {
        rows.append(storyRankingRow(row.rank, row.title, row.coverUrl, formatLag(row.medianLagMinutes)));
      }
      layout.append(total, rows);
      return layout;
    }
    case "behavior-preference": {
      const layout = element("div", "ani-recap-runtime");
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
          )
        );
        layout.append(feature);
      }
      const rows = element("div", "ani-recap-story-ranking");
      for (const row of chapter.payload.rows.slice(1, 5)) {
        rows.append(storyRankingRow(
          row.rank,
          row.title,
          row.coverUrl,
          `${formatInteger(row.wins)} 次先看／${formatInteger(row.comparisons)} 次比較`
        ));
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
  chrome.append(progress);
  if (stale) {
    chrome.append(textElement("span", "ani-recap-stale", "觀看資料有更新；這次回顧仍保留開場時看到的內容"));
  }
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

const storyRankingRow = (
  rank: number,
  title: string,
  coverUrl: string | null,
  value: string
): HTMLElement => {
  const row = element("article", "ani-recap-ranking-row");
  row.append(
    textElement("span", "ani-recap-ranking-rank", String(rank)),
    createCover(coverUrl, title, "ani-recap-ranking-cover"),
    textElement("strong", "ani-recap-ranking-title", title),
    textElement("span", "ani-recap-ranking-value", value)
  );
  return row;
};

const tasteColumn = (
  title: string,
  rows: readonly { readonly label: string; readonly watchCount: number }[]
): HTMLElement => {
  const card = element("section", "ani-recap-taste-column");
  card.append(textElement("h4", "", title));
  const list = element("ol");
  for (const row of rows.slice(0, 5)) {
    const item = element("li");
    item.append(textElement("span", "", row.label), textElement("strong", "", `${row.watchCount} 次觀看`));
    list.append(item);
  }
  card.append(list);
  return card;
};

const metric = (label: string, value: string, unit: string): HTMLElement => {
  const card = element("article", "ani-recap-metric");
  card.append(
    textElement("span", "ani-recap-metric-label", label),
    textElement("strong", "ani-recap-metric-value", value),
    textElement("span", "ani-recap-metric-unit", unit)
  );
  return card;
};

const introFact = (label: string, value: string): HTMLElement => {
  const item = element("div", "ani-recap-intro-fact");
  item.append(textElement("span", "", label), textElement("strong", "", value));
  return item;
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
): Pick<RecapPresentationChapter, "title" | "narrative"> => {
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
  return { title: "這段期間沒有觀看紀錄", narrative: "換一個期間，再看看你的觀看習慣。" };
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
  stage.addEventListener("animationend", onAnimationFinished, { once: true });
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) queueMicrotask(onAnimationFinished);
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

export const recapCss = `
.ani-recap-intro, .ani-recap-stage { position: relative; isolation: isolate; display: grid; min-height: 100%; overflow: hidden; background: #070b18; color: #fff; }
.ani-recap-backdrop { position: absolute; z-index: -2; inset: 0; overflow: hidden; background: radial-gradient(circle at 78% 18%, rgba(45,212,191,.28), transparent 32%), radial-gradient(circle at 18% 86%, rgba(56,189,248,.2), transparent 38%), linear-gradient(145deg, #07111f, #102a43 52%, #123b45); }
.ani-recap-backdrop::before { content: ""; position: absolute; inset: -20%; background: repeating-linear-gradient(118deg, transparent 0 68px, rgba(255,255,255,.035) 69px 70px), repeating-radial-gradient(circle at 72% 34%, transparent 0 86px, rgba(125,211,252,.06) 87px 88px); transform: rotate(-4deg); }
.ani-recap-backdrop::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(2,6,23,.92), rgba(2,6,23,.66) 55%, rgba(2,6,23,.32)), linear-gradient(0deg, rgba(2,6,23,.7), transparent 58%); }
.ani-recap-stage[data-chapter="season-breakdown"] .ani-recap-backdrop { background: radial-gradient(circle at 76% 20%, rgba(251,191,36,.22), transparent 32%), radial-gradient(circle at 20% 86%, rgba(52,211,153,.18), transparent 38%), linear-gradient(145deg, #101827, #23334d 52%, #314430); }
.ani-recap-stage[data-chapter="runtime"] .ani-recap-backdrop { background: radial-gradient(circle at 76% 18%, rgba(99,102,241,.3), transparent 32%), radial-gradient(circle at 22% 82%, rgba(56,189,248,.18), transparent 38%), linear-gradient(145deg, #070d20, #172554 52%, #12334b); }
.ani-recap-stage[data-chapter="taste"] .ani-recap-backdrop { background: radial-gradient(circle at 76% 18%, rgba(244,114,182,.22), transparent 32%), radial-gradient(circle at 18% 84%, rgba(167,139,250,.22), transparent 38%), linear-gradient(145deg, #150d22, #31204c 52%, #17334b); }
.ani-recap-stage[data-chapter="timeliness"] .ani-recap-backdrop { background: radial-gradient(circle at 78% 18%, rgba(34,211,238,.28), transparent 32%), radial-gradient(circle at 20% 84%, rgba(96,165,250,.2), transparent 38%), linear-gradient(145deg, #07131e, #0e3a4a 52%, #16344f); }
.ani-recap-stage[data-chapter="behavior-preference"] .ani-recap-backdrop { background: radial-gradient(circle at 78% 18%, rgba(52,211,153,.26), transparent 32%), radial-gradient(circle at 18% 84%, rgba(45,212,191,.2), transparent 38%), linear-gradient(145deg, #071713, #123b36 52%, #162f48); }
.ani-recap-intro-content { align-self: center; width: min(100%, 1120px); margin-inline: auto; padding: clamp(36px, 8vw, 96px) clamp(22px, 7vw, 76px); }
.ani-recap-eyebrow { margin: 0 0 12px; color: #7dd3fc; font-size: 12px; font-weight: 900; letter-spacing: .16em; text-transform: uppercase; }
.ani-recap-intro-title, .ani-recap-chapter-title, .ani-recap-outro-title { margin: 0; max-width: 900px; color: #fff; font-size: clamp(42px, 8vw, 92px); font-weight: 950; letter-spacing: -.055em; line-height: .98; text-wrap: balance; }
.ani-recap-intro-copy, .ani-recap-narrative { max-width: 720px; margin: 20px 0 0; color: #cbd5e1; font-size: clamp(14px, 1.8vw, 19px); line-height: 1.65; }
.ani-recap-intro-facts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 30px; }
.ani-recap-intro-fact { display: grid; min-width: 120px; border: 1px solid rgba(255, 255, 255, .18); border-radius: 14px; background: rgba(15, 23, 42, .48); padding: 11px 15px; backdrop-filter: blur(12px); }
.ani-recap-intro-fact span { color: #94a3b8; font-size: 10px; }
.ani-recap-intro-fact strong { color: #fff; font-size: 17px; }
.ani-recap-intro-actions, .ani-recap-outro-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 32px; }
.ani-recap-primary-button, .ani-recap-ghost-button, .ani-recap-evidence-button { min-height: 44px; border-radius: 999px; cursor: pointer; font: inherit; font-size: 12px; font-weight: 900; padding: 10px 18px; }
.ani-recap-primary-button { border: 1px solid #fff; background: #fff; color: #0f172a; }
.ani-recap-ghost-button, .ani-recap-evidence-button { border: 1px solid rgba(255, 255, 255, .28); background: rgba(15, 23, 42, .34); color: #e2e8f0; backdrop-filter: blur(10px); }
.ani-recap-primary-button:disabled, .ani-recap-ghost-button:disabled, .ani-recap-evidence-button:disabled { cursor: wait; opacity: .52; }
.ani-recap-stage { height: 100%; min-height: 0; grid-template-rows: auto minmax(0, 1fr) auto; }
.ani-recap-stage[data-transition="forward"] { animation: ani-recap-enter-forward 360ms cubic-bezier(.2,.8,.2,1) both; }
.ani-recap-stage[data-transition="backward"] { animation: ani-recap-enter-backward 360ms cubic-bezier(.2,.8,.2,1) both; }
.ani-recap-chrome { position: relative; z-index: 2; display: grid; gap: 8px; width: min(100%, 1120px); margin-inline: auto; padding: 20px clamp(20px, 5vw, 58px) 0; }
.ani-recap-progress { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 5px; }
.ani-recap-progress span { height: 3px; border-radius: 999px; background: rgba(255, 255, 255, .18); }
.ani-recap-progress span[data-active="true"] { background: #7dd3fc; }
.ani-recap-stale { width: fit-content; border: 1px solid rgba(253, 224, 71, .35); border-radius: 999px; background: rgba(113, 63, 18, .42); color: #fef08a; font-size: 9px; padding: 4px 9px; }
.ani-recap-chapter-content { align-self: stretch; display: grid; align-content: safe center; width: min(100%, 1120px); min-height: 0; margin-inline: auto; overflow-y: auto; overscroll-behavior: contain; padding: 30px clamp(22px, 7vw, 76px); }
.ani-recap-chapter-title { font-size: clamp(38px, 6vw, 72px); }
.ani-recap-chapter-title:focus, .ani-recap-outro-title:focus { outline: none; }
.ani-recap-playback-actions { position: relative; z-index: 2; display: grid; grid-template-columns: max-content 1fr max-content; align-items: center; gap: 10px; width: min(100%, 1120px); margin-inline: auto; padding: 0 clamp(20px, 5vw, 58px) max(22px, env(safe-area-inset-bottom)); }
.ani-recap-evidence-button { justify-self: center; }
.ani-recap-metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; max-width: 850px; margin-top: 34px; }
.ani-recap-metric { display: grid; gap: 2px; border: 1px solid rgba(255, 255, 255, .16); border-radius: 16px; background: rgba(15, 23, 42, .48); padding: 16px; backdrop-filter: blur(10px); }
.ani-recap-metric-label { color: #94a3b8; font-size: 10px; }
.ani-recap-metric-value { color: #fff; font-size: clamp(27px, 4vw, 44px); line-height: 1; }
.ani-recap-metric-unit { color: #7dd3fc; font-size: 10px; }
.ani-recap-season-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; max-width: 930px; margin-top: 32px; }
.ani-recap-season-card { display: grid; gap: 5px; min-height: 150px; border: 1px solid rgba(255,255,255,.16); border-radius: 18px; background: rgba(15,23,42,.55); padding: 18px; backdrop-filter: blur(10px); }
.ani-recap-season-card[data-leading="true"] { border-color: #7dd3fc; background: rgba(8, 47, 73, .72); box-shadow: 0 0 0 1px rgba(125, 211, 252, .22), 0 18px 45px rgba(2, 132, 199, .2); }
.ani-recap-season-name { color: #bae6fd; font-size: 11px; font-weight: 900; }
.ani-recap-season-count { align-self: end; color: #fff; font-size: 29px; }
.ani-recap-season-detail { color: #94a3b8; font-size: 10px; }
.ani-recap-runtime { display: grid; grid-template-columns: minmax(220px, .7fr) minmax(320px, 1.3fr); gap: 20px; max-width: 960px; margin-top: 30px; align-items: start; }
.ani-recap-big-metric { display: grid; align-content: center; min-height: 190px; border: 1px solid rgba(125, 211, 252, .25); border-radius: 20px; background: rgba(8, 47, 73, .55); padding: 24px; }
.ani-recap-big-metric strong { color: #fff; font-size: clamp(32px, 5vw, 57px); letter-spacing: -.04em; line-height: 1.05; }
.ani-recap-big-metric span { margin-top: 8px; color: #bae6fd; font-size: 10px; }
.ani-recap-story-ranking { display: grid; }
.ani-recap-ranking-row { display: grid; grid-template-columns: 24px 44px minmax(0, 1fr) max-content; align-items: center; gap: 10px; border-bottom: 1px solid rgba(255,255,255,.13); padding: 9px 0; }
.ani-recap-ranking-rank { color: #7dd3fc; font-size: 12px; font-weight: 900; }
.ani-recap-ranking-cover { overflow: hidden; width: 44px; aspect-ratio: 3 / 4; border-radius: 7px; background: rgba(255,255,255,.13); }
.ani-recap-ranking-cover img { width: 100%; height: 100%; object-fit: cover; }
.ani-recap-ranking-title { overflow: hidden; color: #fff; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.ani-recap-ranking-value { color: #cbd5e1; font-size: 11px; }
.ani-recap-story-note { grid-column: 1 / -1; margin: 0; color: #94a3b8; font-size: 11px; }
.ani-recap-preference-leader { display: grid; grid-template-columns: 100px 1fr; grid-template-rows: repeat(3, min-content); gap: 5px 16px; }
.ani-recap-leader-cover { grid-row: 1 / -1; overflow: hidden; width: 100px; aspect-ratio: 3 / 4; border-radius: 13px; background: rgba(255,255,255,.13); }
.ani-recap-leader-cover img { width: 100%; height: 100%; object-fit: cover; }
.ani-recap-leader-label { align-self: end; color: #7dd3fc; font-size: 10px; font-weight: 900; }
.ani-recap-leader-title { color: #fff; font-size: 20px; line-height: 1.25; }
.ani-recap-leader-value { color: #cbd5e1; font-size: 11px; }
.ani-recap-taste-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; max-width: 980px; margin-top: 30px; }
.ani-recap-taste-column { border: 1px solid rgba(255,255,255,.15); border-radius: 16px; background: rgba(15,23,42,.52); padding: 15px; }
.ani-recap-taste-column h4 { margin: 0 0 10px; color: #7dd3fc; font-size: 11px; }
.ani-recap-taste-column p { color: #94a3b8; font-size: 10px; }
.ani-recap-taste-column ol { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.ani-recap-taste-column li { display: flex; justify-content: space-between; gap: 8px; color: #e2e8f0; font-size: 10px; }
.ani-recap-taste-column li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ani-recap-evidence-veil { position: absolute; z-index: 5; display: grid; place-items: center; inset: 0; background: rgba(2,6,23,.74); padding: 20px; backdrop-filter: blur(10px); }
.ani-recap-evidence-panel { width: min(620px, 100%); max-height: min(720px, calc(100dvh - 80px)); overflow-y: auto; border: 1px solid rgba(255,255,255,.2); border-radius: 22px; background: #f8fafc; box-shadow: 0 30px 90px rgba(0,0,0,.45); color: #0f172a; padding: 22px; }
.ani-recap-evidence-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.ani-recap-evidence-title { margin: 0; font-size: 20px; }
.ani-recap-evidence-close { display: grid; place-items: center; width: 38px; height: 38px; border: 1px solid #cbd5e1; border-radius: 50%; background: #fff; color: #0f172a; cursor: pointer; font: inherit; font-size: 23px; }
.ani-recap-evidence-chapter { margin: 5px 0 18px; color: #64748b; font-size: 11px; }
.ani-recap-evidence-list { display: grid; grid-template-columns: minmax(0, 1fr) max-content; gap: 0; margin: 0; }
.ani-recap-evidence-list dt, .ani-recap-evidence-list dd { border-bottom: 1px solid #e2e8f0; margin: 0; padding: 10px 0; font-size: 11px; }
.ani-recap-evidence-list dt { color: #64748b; }
.ani-recap-evidence-list dd { color: #0f172a; font-weight: 850; text-align: right; }
.ani-recap-outro { place-items: center; grid-template-rows: 1fr; }
.ani-recap-outro-content { width: min(900px, 100%); padding: 40px 24px; text-align: center; }
.ani-recap-outro-content .ani-recap-eyebrow, .ani-recap-outro-content .ani-recap-narrative, .ani-recap-outro-actions { margin-inline: auto; justify-content: center; }
.ani-recap-invalid { display: grid; place-items: center; align-content: center; gap: 8px; min-height: 60vh; background: #0f172a; color: #fff; padding: 30px; text-align: center; }
.ani-recap-invalid h3, .ani-recap-invalid p { margin: 0; }
@keyframes ani-recap-enter-forward { from { opacity: 0; transform: translateX(34px) scale(.99); } to { opacity: 1; transform: none; } }
@keyframes ani-recap-enter-backward { from { opacity: 0; transform: translateX(-34px) scale(.99); } to { opacity: 1; transform: none; } }
@media (max-width: 760px) {
  .ani-recap-metric-grid, .ani-recap-season-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ani-recap-runtime { grid-template-columns: 1fr; }
  .ani-recap-big-metric { min-height: 130px; }
  .ani-recap-taste-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 480px) {
  .ani-recap-intro-title, .ani-recap-chapter-title, .ani-recap-outro-title { font-size: 38px; }
  .ani-recap-playback-actions { grid-template-columns: max-content minmax(0, 1fr) max-content; gap: 6px; padding-inline: 14px; }
  .ani-recap-playback-actions .ani-recap-primary-button, .ani-recap-playback-actions .ani-recap-ghost-button { width: auto; padding-inline: 12px; }
  .ani-recap-evidence-button { grid-column: auto; grid-row: auto; justify-self: stretch; padding-inline: 10px; }
  .ani-recap-primary-button, .ani-recap-ghost-button { width: 100%; }
  .ani-recap-ranking-row { grid-template-columns: 20px 36px minmax(0, 1fr); }
  .ani-recap-ranking-cover { width: 36px; }
  .ani-recap-ranking-value { grid-column: 3; }
  .ani-recap-taste-grid { grid-template-columns: 1fr; }
}
`;
