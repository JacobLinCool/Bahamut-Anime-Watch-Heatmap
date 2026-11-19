import type { AnalyticsResult } from "../analytics";
import {
  formatClockHour,
  formatCompactDuration,
  formatDuration,
  formatEpisodesPerDay,
  formatHourRange,
  formatInteger,
  formatLag,
  formatPercent,
  truncateText
} from "../analysis-format";
import { createButton, createCover, element, textElement } from "../view-dom";
import type {
  CompletionPayload,
  RecapEvidenceRow,
  RecapPresentationChapter,
  RecapPresentationDeck,
  SeasonFavoritesPayload
} from "./recap-deck";
import type { RecapTone } from "./recap-palette";
import { recapTitleFor } from "./recap-summary";
import { appendStoryTitle, phrasedText } from "./recap-text";

/** 劇場裡的一個前景畫面：換場時整個 root 進出，背景與 chrome 不跟著換。 */
export type RecapSceneHandle = {
  /** "intro" | 章節 id | "summary"；同一個 key 的重複 render 只更新、不重播。 */
  readonly key: string;
  readonly root: HTMLElement;
  readonly tone: RecapTone;
  /** 背景 imprint 用的主角封面。 */
  readonly imprintUrl: string | null;
  readonly update?: (context: RecapSceneContext) => void;
};

export type RecapSceneContext = {
  readonly result: AnalyticsResult;
  readonly liveDeck: RecapPresentationDeck;
  readonly stale: boolean;
  readonly onStart: () => void;
  readonly onDashboard: () => void;
};

// ───────────────────────────── 共用零件 ─────────────────────────────

/** 建一個可編排的零件；order 決定進場先後（省略時依 DOM 順序）。 */
export const part = <K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  kind = "rise",
  order?: number
): HTMLElementTagNameMap[K] => {
  const node = element(tagName, className);
  node.dataset.rcPart = kind;
  if (order !== undefined) node.dataset.rcOrder = String(order);
  return node;
};

/** 依序發放零件順序；左右兩欄各用一條，從不同起點出發就能交錯進場。 */
export const sequence = (start = 0): (() => number) => {
  let next = start;
  return () => next++;
};

/**
 * 故事標題：被引用的作品（《…》「…」）與數字帶章節色，句子本身維持墨色。
 * 斷行只落在詞與詞之間（見 recap-text），行數過多時由 fitHeadlines 縮小字級。
 */
export const renderStoryTitle = (
  className: string,
  title: string,
  order?: number
): HTMLHeadingElement => {
  const heading = part("h3", className, "title", order);
  appendStoryTitle(heading, title);
  heading.tabIndex = -1;
  heading.dataset.recapFocus = "true";
  heading.dataset.rcFit = "true";
  return heading;
};

export type QuantitySegment = {
  readonly value: string;
  readonly unit?: string;
  readonly countTo?: number;
  readonly countFormat?: "integer" | "decimal";
  readonly countKey?: string;
  /** 次要單位（「9 小時 12 分」的「12 分」）：主數字跳動時先藏起來，跳完才出現。 */
  readonly minor?: boolean;
};

/** 大數字：數值大、單位小，數值可以各自 count up。 */
export const quantity = (segments: readonly QuantitySegment[], className = "ani-rc-quantity"): HTMLElement => {
  const node = element("strong", className);
  for (const segment of segments) {
    const value = textElement("span", "ani-rc-num", segment.value);
    if (segment.countTo !== undefined && Number.isFinite(segment.countTo)) {
      value.dataset.countTo = String(segment.countTo);
      if (segment.countFormat && segment.countFormat !== "integer") value.dataset.countFormat = segment.countFormat;
      if (segment.countKey) value.dataset.countKey = segment.countKey;
    }
    const target = segment.minor ? element("span", "ani-rc-minor") : node;
    if (segment.minor) {
      target.dataset.countMinor = "true";
      node.append(target);
    }
    target.append(value);
    if (segment.unit) target.append(textElement("span", "ani-rc-unit", segment.unit));
  }
  return node;
};

export const durationSegments = (minutes: number, countKey?: string): QuantitySegment[] => {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (hours === 0) return [{ value: formatInteger(remainder), unit: "分鐘", countTo: remainder, countKey }];
  const segments: QuantitySegment[] = [{ value: formatInteger(hours), unit: "小時", countTo: hours, countKey }];
  if (remainder > 0) segments.push({ value: String(remainder), unit: "分", minor: true });
  return segments;
};

export const lagSegments = (minutes: number): QuantitySegment[] => {
  if (minutes < 60) {
    const value = Math.round(minutes);
    return [{ value: formatInteger(value), unit: "分鐘", countTo: value }];
  }
  if (minutes < 24 * 60) {
    const value = Math.round(minutes / 6) / 10;
    return [{ value: decimal.format(value), unit: "小時", countTo: value, countFormat: "decimal" }];
  }
  const value = Math.round(minutes / 144) / 10;
  return [{ value: decimal.format(value), unit: "天", countTo: value, countFormat: "decimal" }];
};

export const percentSegments = (ratio: number): QuantitySegment[] => {
  const value = Math.round(ratio * 100);
  return [{ value: formatInteger(value), unit: "%", countTo: value }];
};

const decimal = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 });

/** 平均次數（小數一位）也跟著旁邊的整數一起跳，不會先停在最終值等別人。 */
export const densitySegment = (count: number, per: number): QuantitySegment => {
  if (!(per > 0)) return { value: "—", unit: "集" };
  const value = Math.round((count / per) * 10) / 10;
  return { value: decimal.format(value), unit: "集", countTo: value, countFormat: "decimal" };
};

export const meterBar = (level: number, className = "ani-rc-meter"): HTMLElement => {
  const meter = element("span", className);
  meter.setAttribute("aria-hidden", "true");
  const fill = element("span", "ani-rc-meter-fill");
  fill.dataset.rcMeter = "true";
  fill.style.setProperty("--rc-level", String(Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0))));
  meter.append(fill);
  return meter;
};

/** 封面一律立即載入（回顧會預先解碼下一章的封面），失敗時沿用字元 fallback。 */
export const recapCover = (url: string | null, alt: string, className: string): HTMLElement =>
  createCover(url, alt, className, { eager: true, readableGlyph: true });

export const formatDateKey = (dateKey: string): string => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return `${year} 年 ${month} 月 ${day} 日`;
};

export const formatShortDateKey = (dateKey: string): string => {
  const [, month, day] = dateKey.split("-").map(Number);
  return `${month}/${day}`;
};

const sharedAnimeKey = (animeSn: number): string => `anime-${animeSn}`;

/** 節點本身是否持有焦點；在 shadow root 裡看的是那個 root 的 activeElement。 */
const hasFocus = (node: HTMLElement): boolean => typeof node.getRootNode === "function"
  && (node.getRootNode() as Partial<DocumentOrShadowRoot>).activeElement === node;

// ───────────────────────────── 開場 ─────────────────────────────

/**
 * 開場畫面取自「即時」的分析結果：使用者還在這裡挑期間，資料也可能仍在補齊。
 * 之後的 render 只就地更新文字與封面，不重播進場。
 */
export const buildIntroScene = (context: RecapSceneContext): RecapSceneHandle => {
  const root = element("section", "ani-rc-scene ani-rc-intro");
  root.dataset.tone = "intro";
  root.dataset.scene = "intro";
  // 開場的字與封面很密：離開時整張一起淡掉，不逐件退場。
  root.dataset.rcExit = "layer";
  const next = sequence();
  let latest = context;
  const grid = element("div", "ani-rc-intro-grid");
  const copy = element("div", "ani-rc-intro-copy");
  const eyebrow = part("p", "ani-recap-eyebrow", "fade", next());
  let title = renderStoryTitle("ani-rc-intro-title", "", next());
  const lede = part("p", "ani-rc-lede", "rise", next());
  const facts = part("div", "ani-rc-intro-facts", "rise", next());
  const actions = part("div", "ani-rc-intro-actions", "rise", next());
  const start = createButton("ani-recap-primary-button", "開始回顧");
  start.addEventListener("click", () => latest.onStart());
  const dashboard = createButton("ani-recap-ghost-button", "回到分析總覽");
  dashboard.addEventListener("click", () => latest.onDashboard());
  actions.append(start, dashboard);
  copy.append(eyebrow, title, lede, facts, actions);
  const poster = element("div", "ani-rc-intro-poster");
  poster.setAttribute("aria-hidden", "true");
  grid.append(copy, poster);
  root.append(grid);

  let factsSignature = "";
  let posterSignature = "";
  let imprintUrl: string | null = null;
  const apply = (input: RecapSceneContext, initial: boolean): void => {
    latest = input;
    const result = input.result;
    eyebrow.textContent = result.scope.axis === "released-at"
      ? "沿著作品實際上架的日子展開"
      : "沿著你的觀看時間展開";
    const titleText = recapTitleFor(result.scope.period);
    if (title.textContent !== titleText) {
      const replacement = renderStoryTitle("ani-rc-intro-title", titleText, Number(title.dataset.rcOrder));
      // 期間在背景被換掉時標題可能正有焦點（換章後自動聚焦）：移除它會讓焦點掉到 <body>。
      const hadFocus = hasFocus(title);
      title.replaceWith(replacement);
      title = replacement;
      if (hadFocus) replacement.focus({ preventScroll: true });
    }
    const ledeText = input.liveDeck.chapters.length === 0
      ? "這段期間沒有觀看紀錄。"
      : result.summary.animeCount === 0
        ? `${formatInteger(result.summary.watchCount)} 集。作品資料補齊後，還會看到你最常看什麼、又先選了誰。`
        : result.scope.axis === "released-at"
          ? `${formatInteger(result.summary.watchCount)} 集，來自這段期間上架的 ${formatInteger(result.summary.animeCount)} 部作品。看看你最常看哪一季，又先選了誰。`
          : `${formatInteger(result.summary.watchCount)} 集，來自 ${formatInteger(result.summary.animeCount)} 部作品。看看你最常看什麼，又先選了誰。`;
    if (lede.dataset.text !== ledeText) {
      lede.dataset.text = ledeText;
      lede.replaceChildren();
      appendStoryTitle(lede, ledeText, false);
    }
    // 背景資料每秒會 tick 好幾次：數字沒變就不重建，進場中的 count-up 才不會被換掉。
    const { uniqueEpisodeCount, animeCount, knownContentMinutes } = result.summary;
    const signature = `${uniqueEpisodeCount}|${animeCount}|${knownContentMinutes}`;
    if (signature !== factsSignature) {
      factsSignature = signature;
      facts.replaceChildren(
        introFact("不同單集", uniqueEpisodeCount, "episode-count"),
        ...(animeCount > 0 ? [introFact("作品", animeCount, "anime-count")] : []),
        ...(knownContentMinutes > 0 ? [introDurationFact(knownContentMinutes)] : [])
      );
    }
    start.disabled = input.liveDeck.chapters.length === 0;

    const covers = collectIntroCovers(result);
    const coverSignature = covers.join("|");
    if (coverSignature !== posterSignature) {
      posterSignature = coverSignature;
      poster.replaceChildren(...covers.map((url, index) => {
        const wrap = part("span", "ani-rc-intro-cover", "cover", 2 + index);
        wrap.append(recapCover(url, "", "ani-rc-intro-cover-art"));
        return wrap;
      }));
      if (!initial && typeof poster.animate === "function") {
        poster.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: "ease-out" });
      }
    }
    grid.dataset.poster = String(covers.length > 0);
    imprintUrl = covers[0] ?? null;
  };
  apply(context, true);

  return {
    key: "intro",
    root,
    tone: "intro",
    get imprintUrl() { return imprintUrl; },
    update: (input) => apply(input, false)
  };
};

const introFact = (label: string, value: number, countKey: string): HTMLElement => {
  const item = element("div", "ani-rc-intro-fact");
  item.append(
    textElement("span", "ani-rc-fact-label", label),
    quantity([{ value: formatInteger(value), countTo: value, countKey }], "ani-rc-fact-value")
  );
  return item;
};

const introDurationFact = (minutes: number): HTMLElement => {
  const item = element("div", "ani-rc-intro-fact");
  item.append(
    textElement("span", "ani-rc-fact-label", "觀看片長"),
    quantity(durationSegments(minutes), "ani-rc-fact-value")
  );
  return item;
};

const collectIntroCovers = (result: AnalyticsResult): readonly string[] => {
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
  return unique;
};

// ───────────────────────────── 章節 ─────────────────────────────

type LeadOptions = {
  readonly animeSn: number;
  readonly title: string;
  readonly coverUrl: string | null;
  readonly label: string;
  readonly value: string;
  readonly level?: number;
};

type ChapterLayout = {
  /** 左欄文案下方的主角作品。 */
  readonly lead: LeadOptions | null;
  /** 右欄零件（已帶 data-rc-part）。 */
  readonly visual: readonly HTMLElement[];
  readonly variant?: "wide-visual";
};

export const buildChapterScene = (chapter: RecapPresentationChapter): RecapSceneHandle => {
  const root = element("section", "ani-rc-scene ani-rc-chapter");
  root.dataset.tone = chapter.kind;
  root.dataset.scene = chapter.kind;
  // 左欄（眉標 → 標題 → 敘述 → 主角）與右欄（大數字 → 排行）各自編號，右欄晚半拍起步。
  const left = sequence();
  const right = sequence(1.5);
  const grid = element("div", "ani-rc-chapter-grid");
  const copy = element("div", "ani-rc-copy");
  const visual = element("div", "ani-rc-visual");
  const eyebrow = part("p", "ani-recap-eyebrow", "fade", left());
  eyebrow.textContent = chapter.eyebrow;
  // 標題緊跟著眉標進場：舊畫面還在淡出時新句子就開始擦出，畫面不會先空一拍。
  const heading = renderStoryTitle("ani-rc-title", chapter.title, 0.2);
  const narrative = part("p", "ani-rc-narrative", "rise", left());
  appendStoryTitle(narrative, chapter.narrative, false);
  copy.append(eyebrow, heading, narrative);
  const layout = chapterLayout(chapter, right);
  if (layout.lead) copy.append(...leadBlock(layout.lead, left));
  visual.append(...layout.visual);
  if (layout.variant) grid.dataset.variant = layout.variant;
  grid.append(copy, visual);
  root.append(grid);

  return {
    key: chapter.id,
    root,
    tone: chapter.kind,
    imprintUrl: layout.lead?.coverUrl ?? null
  };
};

/** 不建 DOM，只列出某章會用到的封面，供劇場提前解碼。 */
export const chapterCoverUrls = (chapter: RecapPresentationChapter): readonly string[] => {
  const urls: (string | null)[] = [];
  switch (chapter.kind) {
    case "marathon": urls.push(chapter.payload.topSingleDayRun?.coverUrl ?? null); break;
    case "runtime":
    case "timeliness":
    case "behavior-preference":
    case "binge":
      for (const row of chapter.payload.rows) urls.push(row.coverUrl);
      break;
    case "completion":
      for (const row of chapter.payload.nearlyRows) urls.push(row.coverUrl);
      break;
    case "platform-taste":
      for (const gem of chapter.payload.gems) urls.push(gem.coverUrl);
      break;
    default: break;
  }
  return urls.filter((url): url is string => typeof url === "string");
};

const leadBlock = (lead: LeadOptions, next: () => number): HTMLElement[] => {
  const coverWrap = part("div", "ani-rc-lead-cover", "cover", next());
  coverWrap.dataset.rcShared = sharedAnimeKey(lead.animeSn);
  // 接力棒：相鄰兩章都有主角封面但不是同一部時，封面框從上一章的位置接過來、只換掉圖。
  coverWrap.dataset.rcBaton = "lead";
  coverWrap.append(recapCover(lead.coverUrl, lead.title, "ani-rc-lead-art"));
  const body = part("div", "ani-rc-lead-copy", "rise", next());
  body.append(
    textElement("span", "ani-rc-lead-label", lead.label),
    phrasedText("strong", "ani-rc-lead-title", lead.title),
    textElement("span", "ani-rc-lead-value", lead.value)
  );
  if (lead.level !== undefined) body.append(meterBar(lead.level, "ani-rc-meter ani-rc-meter--lead"));
  const wrap = element("div", "ani-rc-lead");
  wrap.append(coverWrap, body);
  return [wrap];
};

const heroStat = (
  segments: readonly QuantitySegment[],
  caption: string,
  order: number,
  shared?: string
): HTMLElement => {
  const block = part("div", "ani-rc-hero-stat", "rise", order);
  if (shared) block.dataset.rcShared = shared;
  const value = quantity(segments, "ani-rc-hero-value");
  const length = segments.reduce((sum, segment) => sum + [...segment.value].length + [...(segment.unit ?? "")].length, 0);
  if (length > 9) value.dataset.long = "true";
  block.append(value, textElement("span", "ani-rc-hero-caption", caption));
  return block;
};

type RankingRowOptions = {
  readonly rank: number;
  readonly animeSn: number;
  readonly title: string;
  readonly coverUrl: string | null;
  readonly value: string;
  readonly meta?: string;
  readonly level?: number;
  /** 左欄主角也在排行裡：這一列標亮，封面不再當共享元素（主角封面已經是）。 */
  readonly highlight?: boolean;
};

/**
 * 排行列本身不是零件，裡面的名次、封面、文字、數值才是（同一個進場順序）：
 * 封面因此能當共享元素，同一部作品出現在下一章時直接飛到新位置。
 */
const rankingList = (rows: readonly RankingRowOptions[], next: () => number): HTMLElement[] => rows.map((row) => {
  const order = next();
  const node = element("article", "ani-rc-row");
  if (row.highlight) node.dataset.lead = "true";
  const rank = part("span", "ani-rc-row-rank", "rise", order);
  rank.textContent = String(row.rank);
  const cover = recapCover(row.coverUrl, row.title, "ani-rc-row-cover");
  cover.dataset.rcPart = "cover";
  cover.dataset.rcOrder = String(order);
  if (!row.highlight) cover.dataset.rcShared = sharedAnimeKey(row.animeSn);
  const copy = part("div", "ani-rc-row-copy", "rise", order);
  copy.append(textElement("strong", "ani-rc-row-title", row.title));
  if (row.meta) copy.append(textElement("span", "ani-rc-row-meta", row.meta));
  if (row.level !== undefined) copy.append(meterBar(row.level));
  const value = part("span", "ani-rc-row-value", "rise", order);
  value.textContent = row.value;
  const rule = part("span", "ani-rc-row-rule", "fade", order);
  rule.setAttribute("aria-hidden", "true");
  node.append(rank, cover, copy, value, rule);
  return node;
});

const note = (text: string, order: number): HTMLElement => {
  const node = part("p", "ani-rc-note", "fade", order);
  // 跟敘述段落同一套斷行：數字黏著單位，「69 小時 43 分鐘。」不會被拆成兩行。
  appendStoryTitle(node, text, false);
  return node;
};

const chapterLayout = (chapter: RecapPresentationChapter, next: () => number): ChapterLayout => {
  switch (chapter.kind) {
    case "overview": {
      const payload = chapter.payload;
      const activeDayLabel = payload.axis === "released-at" ? "上架日" : "觀看日";
      // 沒有重看時「觀看」和「不同單集」是同一個數字，重複的卡片換成日均密度。
      const rewatchCount = payload.watchCount - payload.uniqueEpisodeCount;
      const grid = element("div", "ani-rc-stat-grid");
      const watchStat = statCell("看了", [{ value: formatInteger(payload.watchCount), unit: "集", countTo: payload.watchCount, countKey: "watch-count" }], next(), "metric-watch");
      const secondStat = rewatchCount > 0
        ? statCell("重看", [{ value: formatInteger(rewatchCount), unit: "次", countTo: rewatchCount }], next())
        : statCell(payload.axis === "released-at" ? "有上架的日子平均" : "有看的日子平均", [densitySegment(payload.watchCount, payload.activeDayCount)], next());
      // 作品資料還沒到時辨識不出作品：改放不同單集，而不是顯示「0 部」。
      const workStat = payload.identifiableAnimeCount > 0
        ? statCell("作品", [{ value: formatInteger(payload.identifiableAnimeCount), unit: "部", countTo: payload.identifiableAnimeCount, countKey: "anime-count" }], next(), "metric-anime")
        : statCell("不同單集", [{ value: formatInteger(payload.uniqueEpisodeCount), unit: "集", countTo: payload.uniqueEpisodeCount, countKey: "episode-count" }], next());
      const stats: HTMLElement[] = [
        watchStat,
        secondStat,
        workStat,
        statCell(activeDayLabel, [{ value: formatInteger(payload.activeDayCount), unit: "天", countTo: payload.activeDayCount, countKey: "active-days" }], next(), "metric-days")
      ];
      grid.append(...stats);
      return { lead: null, visual: [grid] };
    }
    case "season-breakdown": {
      const payload = chapter.payload;
      const max = Math.max(1, ...payload.rows.map((row) => row.watchCount));
      const chart = element("div", "ani-rc-season-chart");
      for (const row of payload.rows) {
        const column = part("div", "ani-rc-season-column", "rise", next());
        column.dataset.season = row.season;
        column.dataset.leading = String(payload.leadingSeasons.includes(row.season));
        const track = element("span", "ani-rc-season-track");
        track.setAttribute("aria-hidden", "true");
        const bar = element("span", "ani-rc-season-bar");
        bar.dataset.rcBar = "true";
        bar.style.setProperty("--rc-level", String(row.watchCount / max));
        track.append(bar);
        column.append(
          track,
          textElement("span", "ani-rc-season-name", row.label),
          quantity([{ value: formatInteger(row.watchCount), unit: "集", countTo: row.watchCount }], "ani-rc-season-count"),
          textElement("span", "ani-rc-season-detail", `${formatInteger(row.animeCount)} 部作品`)
        );
        chart.append(column);
      }
      return { lead: null, visual: [chart], variant: "wide-visual" };
    }
    case "habit-clock": {
      const payload = chapter.payload;
      const top = payload.topSegment;
      const hero = heroStat(
        percentSegments(top.share),
        `${top.label}（${formatHourRange(top.startHour, top.endHour)}）佔你所有播放的比例`,
        next()
      );
      const clock = part("div", "ani-rc-clock", "rise", next());
      const bars = element("div", "ani-rc-clock-bars");
      bars.setAttribute("aria-hidden", "true");
      const max = Math.max(1, ...payload.hourCounts);
      payload.hourCounts.forEach((count, hour) => {
        const bar = element("span", "ani-rc-clock-bar");
        bar.dataset.rcBar = "true";
        bar.style.setProperty("--rc-level", String(count / max));
        bar.dataset.peak = String(hour === payload.peakHour);
        bar.title = `${hour}:00 · ${formatInteger(count)} 集`;
        bars.append(bar);
      });
      const labels = element("div", "ani-rc-clock-labels");
      labels.setAttribute("aria-hidden", "true");
      for (const hour of [0, 6, 12, 18, 24]) labels.append(textElement("span", "", String(hour % 24).padStart(2, "0")));
      clock.append(bars, labels);
      const segments = part("div", "ani-rc-segments", "rise", next());
      for (const segment of payload.segments) {
        const item = element("div", "ani-rc-segment-item");
        item.dataset.top = String(segment.key === top.key);
        item.append(
          textElement("span", "ani-rc-segment-name", segment.label),
          textElement("strong", "ani-rc-segment-share", formatPercent(segment.share))
        );
        segments.append(item);
      }
      return {
        lead: null,
        visual: [
          hero,
          clock,
          segments,
          note(`高峰在 ${formatClockHour(payload.peakHour)}（${formatInteger(payload.peakHourCount)} 次）；一週之中，${payload.topWeekday.label}最常按下播放（${formatInteger(payload.topWeekday.watchCount)} 次）。`, next())
        ]
      };
    }
    case "marathon": {
      const payload = chapter.payload;
      const peakDay = payload.peakDay;
      const run = payload.topSingleDayRun;
      const visual: HTMLElement[] = [heroStat(
        [{ value: formatInteger(peakDay.watchCount), unit: "次播放", countTo: peakDay.watchCount }],
        `${formatDateKey(peakDay.dateKey)} · 單日最高紀錄`,
        next()
      )];
      const facts: HTMLElement[] = [];
      if (payload.longestStreak) {
        const streak = payload.longestStreak;
        facts.push(factCell(
          "最長連續觀看",
          [{ value: formatInteger(streak.days), unit: "天", countTo: streak.days }],
          streak.days > 1 ? `${formatDateKey(streak.fromDateKey)}–${formatShortDateKey(streak.toDateKey)}` : formatDateKey(streak.fromDateKey)
        ));
      }
      if (peakDay.knownContentMinutes > 0) {
        facts.push(factCell("當天觀看時間", durationSegments(peakDay.knownContentMinutes)));
      }
      if (facts.length > 0) {
        const row = part("div", "ani-rc-marathon-facts", "rise", next());
        row.append(...facts);
        visual.push(row);
      }
      return {
        lead: run
          ? {
              animeSn: run.animeSn,
              title: run.title,
              coverUrl: run.coverUrl,
              label: "單日連看最多",
              value: `一天連看 ${formatInteger(run.watchCount)} 集 · ${formatDateKey(run.dateKey)}`
            }
          : null,
        visual
      };
    }
    case "runtime": {
      const payload = chapter.payload;
      const leader = payload.rows[0];
      const maxMinutes = Math.max(1, ...payload.rows.map((row) => row.contentMinutes));
      const visual: HTMLElement[] = [heroStat(
        durationSegments(payload.totalContentMinutes, "runtime-total"),
        "觀看時間合計",
        next(),
        "metric-runtime"
      )];
      visual.push(...rankingList(payload.rows.slice(1, 5).map((row) => ({
        rank: row.rank,
        animeSn: row.animeSn,
        title: row.title,
        coverUrl: row.coverUrl,
        value: formatCompactDuration(row.contentMinutes),
        meta: `${formatInteger(row.watchCount)} 集`,
        level: row.contentMinutes / maxMinutes
      })), next));
      if (payload.longestEpisode) {
        visual.push(note(
          `最長單集是《${truncateText(payload.longestEpisode.title, 28)}》${payload.longestEpisode.episode}，${formatDuration(payload.longestEpisode.durationMinutes)}。`,
          next()
        ));
      }
      return {
        lead: leader
          ? {
              animeSn: leader.animeSn,
              title: leader.title,
              coverUrl: leader.coverUrl,
              label: "片長第 1",
              value: `${formatCompactDuration(leader.contentMinutes)} · ${formatInteger(leader.watchCount)} 集`,
              level: leader.contentMinutes / maxMinutes
            }
          : null,
        visual
      };
    }
    case "timeliness": {
      const payload = chapter.payload;
      const leader = payload.rows[0];
      const fastest = leader?.medianLagMinutes ?? 0;
      const visual: HTMLElement[] = [heroStat(
        lagSegments(payload.overallMedianLagMinutes),
        `通常會等多久 · ${formatPercent(payload.overallWithin24HoursRate)} 在 24 小時內播放`,
        next()
      )];
      visual.push(...rankingList(payload.rows.slice(1, 5).map((row) => ({
        rank: row.rank,
        animeSn: row.animeSn,
        title: row.title,
        coverUrl: row.coverUrl,
        value: formatLag(row.medianLagMinutes),
        meta: `${formatPercent(row.within24HoursRate)} 在 24 小時內`,
        level: (fastest + 1) / (row.medianLagMinutes + 1)
      })), next));
      return {
        lead: leader
          ? {
              animeSn: leader.animeSn,
              title: leader.title,
              coverUrl: leader.coverUrl,
              label: "追得最快",
              value: `通常等 ${formatLag(leader.medianLagMinutes)} · ${formatPercent(leader.within24HoursRate)} 在 24 小時內`
            }
          : null,
        visual
      };
    }
    case "behavior-preference": {
      const payload = chapter.payload;
      const leader = payload.rows[0];
      if (payload.seasons.filter((season) => season.rows.length > 0).length >= 2) {
        return { lead: null, visual: [seasonPicks(payload.seasons, next)], variant: "wide-visual" };
      }
      const visual: HTMLElement[] = [heroStat(
        [{ value: formatInteger(payload.choiceEventCount), unit: "次", countTo: payload.choiceEventCount }],
        "好幾部作品同時有新集數在等你",
        next()
      )];
      visual.push(...rankingList(payload.rows.slice(1, 5).map((row) => ({
        rank: row.rank,
        animeSn: row.animeSn,
        title: row.title,
        coverUrl: row.coverUrl,
        value: formatPercent(row.rawWinRate),
        meta: `${formatInteger(row.decisionBucketCount)} 次有得選`,
        level: row.rawWinRate
      })), next));
      return {
        lead: leader
          ? {
              animeSn: leader.animeSn,
              title: leader.title,
              coverUrl: leader.coverUrl,
              label: "有得選時最先看",
              value: `${formatPercent(leader.rawWinRate)} 的時候先看它 · ${formatInteger(leader.decisionBucketCount)} 次有得選`,
              level: leader.rawWinRate
            }
          : null,
        visual
      };
    }
    case "completion": {
      const payload = chapter.payload;
      // 只有還在播的作品時，主數字改說「追到最新」：已播集數看完不等於看完。
      const onlyAiring = payload.startedCount === 0;
      const visual: HTMLElement[] = [onlyAiring
        ? heroStat(
            [{ value: formatInteger(payload.caughtUpCount), unit: "部追到最新", countTo: payload.caughtUpCount }],
            `還在播的 ${formatInteger(payload.airingCount)} 部作品中`,
            next()
          )
        : heroStat(
            [{ value: formatInteger(payload.finishedCount), unit: "部看完", countTo: payload.finishedCount }],
            `從第 1 集開始看、已完結的 ${formatInteger(payload.startedCount)} 部作品中`,
            next()
          )];
      if (!onlyAiring) visual.push(outcomeBreakdown(payload, next()));
      const [nearest, ...otherNearly] = payload.nearlyRows;
      visual.push(...rankingList(otherNearly.map((row, index) => ({
        rank: index + 2,
        animeSn: row.animeSn,
        title: row.title,
        coverUrl: row.coverUrl,
        value: `差 ${formatInteger(row.totalEpisode - row.watchedEpisodeCount)} 集`,
        meta: `${formatInteger(row.watchedEpisodeCount)} / ${formatInteger(row.totalEpisode)} 集`,
        level: row.ratio
      })), next));
      const tagNote = dropTagSentence(payload);
      if (tagNote) visual.push(note(tagNote, next()));
      if (!onlyAiring && payload.caughtUpCount > 0) {
        visual.push(note(`還在播的作品裡，有 ${formatInteger(payload.caughtUpCount)} 部追到了最新一集。`, next()));
      }
      return {
        lead: nearest
          ? {
              animeSn: nearest.animeSn,
              title: nearest.title,
              coverUrl: nearest.coverUrl,
              label: "差一點就看完",
              value: `${formatInteger(nearest.watchedEpisodeCount)} / ${formatInteger(nearest.totalEpisode)} 集 · 差 ${formatInteger(nearest.totalEpisode - nearest.watchedEpisodeCount)} 集`,
              level: nearest.ratio
            }
          : null,
        visual,
        ...(nearest ? {} : { variant: "wide-visual" as const })
      };
    }
    case "binge": {
      const payload = chapter.payload;
      const leader = payload.rows[0];
      const visual: HTMLElement[] = leader ? [heroStat(
        [{
          value: leader.episodesPerDay < 0.1 ? "不到 0.1" : decimal.format(leader.episodesPerDay),
          unit: "集／日",
          countTo: leader.episodesPerDay < 0.1 ? undefined : Math.round(leader.episodesPerDay * 10) / 10,
          countFormat: "decimal"
        }],
        "這部平均每天觀看",
        next()
      )] : [];
      visual.push(...rankingList(payload.rows.slice(1).map((row) => ({
        rank: row.rank,
        animeSn: row.animeSn,
        title: row.title,
        coverUrl: row.coverUrl,
        value: formatEpisodesPerDay(row.episodesPerDay),
        level: leader ? row.episodesPerDay / leader.episodesPerDay : undefined
      })), next));
      return {
        lead: leader ? {
          animeSn: leader.animeSn,
          title: leader.title,
          coverUrl: leader.coverUrl,
          label: "補番速度第 1 名",
          value: `平均 ${formatEpisodesPerDay(leader.episodesPerDay)}`
        } : null,
        visual
      };
    }
    case "platform-taste": {
      const [gem, second] = chapter.payload.gems;
      if (!gem) return { lead: null, visual: [] };
      const visual: HTMLElement[] = [heroStat(
        [{ value: `第 ${formatInteger(gem.popularityRank)}`, unit: "名" }],
        `${gem.cohortLabel}開播、你也看過的 ${formatInteger(gem.cohortSize)} 部作品裡，它的人氣名次`,
        next()
      )];
      visual.push(note(`人氣大約只有同季最熱門的《${gem.cohortLeaderTitle}》的 ${formatPercent(gem.popularityRatio)}。`, next()));
      if (second) {
        visual.push(...rankingList([{
          rank: 2,
          animeSn: second.animeSn,
          title: second.title,
          coverUrl: second.coverUrl,
          value: `${formatInteger(second.popularityRank)} / ${formatInteger(second.cohortSize)}`,
          meta: `${second.cohortLabel}開播 · 同季人氣名次`
        }], next));
      }
      return {
        lead: {
          animeSn: gem.animeSn,
          title: gem.title,
          coverUrl: gem.coverUrl,
          label: "你的私藏",
          value: `有得選時常先看它 · 同季人氣第 ${formatInteger(gem.popularityRank)} / ${formatInteger(gem.cohortSize)}`
        },
        visual
      };
    }
    case "taste": {
      const payload = chapter.payload;
      const grid = element("div", "ani-rc-taste-grid");
      const dimensions = [
        ["類型", payload.tags],
        ["動畫公司", payload.makers],
        ["導演", payload.directors],
        ["代理商", payload.publishers]
      ] as const;
      for (const [label, rows] of dimensions) {
        if (rows.length > 0) grid.append(tasteColumn(label, rows, next()));
      }
      return { lead: null, visual: [grid], variant: "wide-visual" };
    }
  }
};

const statCell = (
  label: string,
  segments: readonly QuantitySegment[],
  order: number,
  shared?: string
): HTMLElement => {
  const cell = part("div", "ani-rc-stat", "rise", order);
  if (shared) cell.dataset.rcShared = shared;
  cell.append(textElement("span", "ani-rc-stat-label", label), quantity(segments, "ani-rc-stat-value"));
  return cell;
};

const factCell = (label: string, segments: readonly QuantitySegment[], detail?: string): HTMLElement => {
  const cell = element("div", "ani-rc-fact");
  cell.append(quantity(segments, "ani-rc-fact-value"), textElement("span", "ani-rc-fact-label", label));
  if (detail) cell.append(textElement("span", "ani-rc-fact-detail", detail));
  return cell;
};

const OUTCOME_LABELS = [
  ["finished", "看完"],
  ["nearly", "差一點看完"],
  ["midway", "半途停下"],
  ["dropped", "放棄"]
] as const;

/** 看完、差一點、半途停下、放棄排成一條比例條，下面列出每一類的部數。章節與海報共用。 */
export const outcomeBreakdown = (payload: CompletionPayload, order: number): HTMLElement => {
  const block = part("div", "ani-rc-outcomes", "rise", order);
  const bar = element("div", "ani-rc-outcome-bar");
  bar.setAttribute("aria-hidden", "true");
  const legend = element("ul", "ani-rc-outcome-legend");
  const counts: Record<(typeof OUTCOME_LABELS)[number][0], number> = {
    finished: payload.finishedCount,
    nearly: payload.nearlyCount,
    midway: payload.midwayCount,
    dropped: payload.droppedCount
  };
  for (const [key, label] of OUTCOME_LABELS) {
    const value = counts[key];
    if (value > 0) {
      const segment = element("span", "ani-rc-outcome-segment");
      segment.dataset.outcome = key;
      segment.style.flexGrow = String(value);
      bar.append(segment);
    }
    const item = element("li", "ani-rc-outcome");
    item.dataset.outcome = key;
    const swatch = element("span", "ani-rc-outcome-swatch");
    swatch.setAttribute("aria-hidden", "true");
    item.append(swatch, textElement("span", "ani-rc-outcome-label", label), textElement("strong", "ani-rc-outcome-count", `${formatInteger(value)} 部`));
    legend.append(item);
  }
  block.append(bar, legend);
  return block;
};

/** 類型放棄比例的一句話；兩端都不明顯時不說。 */
export const dropTagSentence = (payload: CompletionPayload): string | null => {
  const most = payload.mostDroppedTag;
  const least = payload.leastDroppedTag;
  const mostText = most
    ? `最常放棄的是「${most.label}」：${formatInteger(most.startedCount)} 部裡放棄了 ${formatInteger(most.droppedCount)} 部`
    : null;
  const leastText = least
    ? `「${least.label}」${formatInteger(least.startedCount)} 部只放棄 ${formatInteger(least.droppedCount)} 部`
    : null;
  if (mostText && leastText) return `${mostText}；${leastText}。`;
  if (mostText) return `${mostText}。`;
  return leastText ? `${leastText}，幾乎都會看完。` : null;
};

/** 年度回顧逐季的最愛：每季一欄，封面加作品名，時刻太少的季照實寫「還看不出來」。 */
const seasonPicks = (
  seasons: readonly SeasonFavoritesPayload[],
  next: () => number
): HTMLElement => {
  const grid = element("div", "ani-rc-season-picks");
  for (const season of seasons) {
    const column = part("section", "ani-rc-season-pick", "rise", next());
    column.append(textElement("h4", "ani-rc-season-pick-name", season.label));
    if (season.rows.length === 0) {
      column.append(textElement("p", "ani-rc-season-pick-empty", "這季還看不出來"));
    } else {
      const list = element("ol", "ani-rc-season-pick-list");
      for (const row of season.rows) {
        const item = element("li", "ani-rc-season-pick-item");
        item.append(
          recapCover(row.coverUrl, row.title, "ani-rc-season-pick-cover"),
          phrasedText("span", "ani-rc-season-pick-title", row.title)
        );
        list.append(item);
      }
      column.append(list);
    }
    grid.append(column);
  }
  return grid;
};

const tasteColumn = (
  title: string,
  rows: readonly { readonly label: string; readonly animeCount: number }[],
  order: number
): HTMLElement => {
  const card = part("section", "ani-recap-taste-column", "rise", order);
  card.append(textElement("h4", "", title));
  const list = element("ol");
  const shown = rows.slice(0, 5);
  const max = Math.max(1, ...shown.map((row) => row.animeCount));
  // 每列部數都一樣時（常見於導演），等長的 bar 沒有資訊，省下來。
  const meaningfulBars = new Set(shown.map((row) => row.animeCount)).size > 1;
  for (const row of shown) {
    const item = element("li");
    const head = element("div", "ani-recap-taste-line");
    head.append(
      textElement("span", "", row.label),
      textElement("strong", "", `${formatInteger(row.animeCount)} 部`)
    );
    item.append(head);
    if (meaningfulBars) item.append(meterBar(row.animeCount / max, "ani-rc-meter ani-recap-meter"));
    list.append(item);
  }
  card.append(list);
  return card;
};

// ───────────────────────────── 資料依據 ─────────────────────────────

export const buildEvidenceVeil = (
  chapter: RecapPresentationChapter,
  onClose: () => void
): HTMLElement => {
  const veil = element("div", "ani-recap-evidence-veil");
  veil.addEventListener("click", (event) => {
    if (event.target === veil) onClose();
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
  close.addEventListener("click", onClose);
  const header = element("header", "ani-recap-evidence-header");
  header.append(heading, close);
  const list = element("dl", "ani-recap-evidence-list");
  for (const row of chapter.evidence) {
    list.append(textElement("dt", "", row.label), textElement("dd", "", formatEvidenceValue(row)));
  }
  panel.append(header, textElement("p", "ani-recap-evidence-chapter", chapter.title), list);
  veil.append(panel);
  return veil;
};

const formatEvidenceValue = (row: RecapEvidenceRow): string => {
  switch (row.kind) {
    case "count": return `${formatInteger(row.value)} ${evidenceUnit(row.unit)}`;
    case "minutes": return formatDuration(row.minutes);
    case "ratio": return row.ratio === null
      ? `${formatInteger(row.numerator)} / ${formatInteger(row.denominator)}`
      : `${formatInteger(row.numerator)} / ${formatInteger(row.denominator)}（${formatPercent(row.ratio)}）`;
    case "text": return row.value;
  }
};

const evidenceUnit = (unit: Extract<RecapEvidenceRow, { kind: "count" }>["unit"]): string => {
  switch (unit) {
    case "watch": return "集";
    case "episode": return "集";
    case "anime": return "部";
    case "day": return "天";
    case "choice": return "次選擇";
    case "sample": return "個樣本";
  }
};
