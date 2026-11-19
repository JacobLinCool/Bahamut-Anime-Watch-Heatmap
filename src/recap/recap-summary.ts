import type { AnalyticsResult, WatchMoment } from "../analytics";
import { formatHourRange, formatInteger, formatPercent, truncateText } from "../analysis-format";
import type { CalendarSeason, PeriodDefinition } from "../period";
import { addTaipeiCalendarDays, toTaipeiDateKey } from "../time";
import type { RecapChapterKind, RecapPresentationChapter, TimelinessPayload } from "./recap-deck";

/** 拼貼最多放幾張封面：夠形成一疊，又不會把英雄數字擠走。 */
export const RECAP_SUMMARY_COVER_LIMIT = 7;

/**
 * 「你的觀看型態」規則門檻。每條規則都只讀章節 payload，沒觸發就不出現；
 * strong 值是強度換算的上限，用來在多條規則同時成立時挑出最鮮明的一條。
 */
export const RECAP_PERSONA_THRESHOLDS = Object.freeze({
  /** 追新番派：24 小時內觀看比例，以及至少要有幾次能對上上架時間的觀看。 */
  freshWithin24HoursRate: 0.5,
  freshStrongRate: 0.9,
  freshMinSamples: 10,
  /** 一口氣派：同一天同一部作品連看的集數。 */
  bingeSingleDayEpisodes: 6,
  bingeStrongEpisodes: 15,
  /** 完食派：從頭開始看、已完結的作品中完整看完的比例與最低部數。 */
  completistShare: 0.4,
  completistStrongShare: 0.8,
  completistMinCount: 3,
  /** 試吃家：只看了一集的作品比例與最低部數。 */
  samplerShare: 0.35,
  samplerStrongShare: 0.7,
  samplerMinCount: 3,
  /** 深夜場常客：深夜時段（跨午夜）的播放比例與最低播放次數。 */
  nightOwlShare: 0.4,
  nightOwlStrongShare: 0.85,
  nightOwlMinWatches: 10,
  /**
   * 獨到眼光：有私藏就成立（私藏本身已經要求偏心、又在同季人氣後段）。
   * 強度看它的人氣比同季最熱門的作品少多少：少一半起算，只剩一成算最鮮明。
   */
  curatorShortfall: 0.5,
  curatorStrongShortfall: 0.9
});

/** 亮點的門檻：沒過就不出現，海報上最多放幾則。 */
export const RECAP_HIGHLIGHT_THRESHOLDS = Object.freeze({
  /** 補舊作：舊作至少這麼多部，或舊作集數至少占這個比例，擇一成立。 */
  oldWorkMinCount: 5,
  oldWorkMinShare: 0.25,
  maxCount: 2
});

export type RecapHighlightMoment = {
  readonly animeSn: number | null;
  readonly title: string;
  readonly episode: string;
  readonly coverUrl: string | null;
  /** 台北時間 M/D。 */
  readonly dateLabel: string;
  /** 台北時間 HH:MM。 */
  readonly time: string;
};

export type RecapHighlight =
  | {
      readonly kind: "new-year";
      readonly year: number;
      readonly before: RecapHighlightMoment | null;
      readonly after: RecapHighlightMoment | null;
    }
  | {
      readonly kind: "dawn";
      readonly startTime: string;
      readonly episodeCount: number;
      readonly last: RecapHighlightMoment;
    }
  | {
      readonly kind: "old-works";
      readonly workCount: number;
      readonly episodeShare: number;
      readonly oldest: {
        readonly animeSn: number;
        readonly title: string;
        readonly coverUrl: string | null;
        readonly premiereYear: number;
      };
    };

export type RecapPersonaKey = "fresh" | "binge" | "completist" | "sampler" | "night-owl" | "curator";

export type RecapPersonaTrait = {
  readonly key: RecapPersonaKey;
  readonly label: string;
  readonly reason: string;
  readonly chapterId: RecapChapterKind;
  /** 0–1：門檻到 strong 之間的位置。 */
  readonly strength: number;
};

export type RecapPersona = {
  readonly primary: RecapPersonaTrait;
  readonly others: readonly RecapPersonaTrait[];
};

export type RecapSummaryHero =
  | { readonly kind: "known-runtime"; readonly minutes: number }
  | { readonly kind: "watch-count"; readonly count: number };

export type RecapSummaryCover = {
  readonly animeSn: number;
  readonly title: string;
  readonly coverUrl: string;
};

export type RecapSummaryCalendarDay = {
  readonly dateKey: string;
  readonly count: number;
};

/** 結尾海報的熱度圖：整段期間一天一格，連同有看的天數、最多的一天與最長連續。 */
export type RecapSummaryCalendar = {
  /** 期間內每一天（含沒看的日子），依日期排序。 */
  readonly days: readonly RecapSummaryCalendarDay[];
  readonly activeDayCount: number;
  /** 最多的一天；同數時取較早的日期，和馬拉松章的規則一致。 */
  readonly peak: RecapSummaryCalendarDay;
  /** 最長的連續有看天數；只有依觀看時間才有意義，上架軸或不到兩天時為 null。 */
  readonly longestStreak: {
    readonly fromDateKey: string;
    readonly toDateKey: string;
    readonly days: number;
  } | null;
};

/** 期間本身（含頭含尾的日期與天數）：觀看日占比與馬拉松的時間軸都以它為分母。 */
export type RecapSummaryPeriod = {
  readonly startDateKey: string;
  readonly endDateKey: string;
  readonly dayCount: number;
};

export type RecapSummaryPayload = {
  readonly title: string;
  readonly rangeLabel: string;
  readonly period: RecapSummaryPeriod;
  readonly hero: RecapSummaryHero;
  readonly covers: readonly RecapSummaryCover[];
  readonly persona: RecapPersona | null;
  readonly calendar: RecapSummaryCalendar | null;
  /** 只對這個人成立的亮點（跨年夜、天亮了還在看、補舊作），依序最多兩則。 */
  readonly highlights: readonly RecapHighlight[];
  /** 週日到週六的播放次數；只有觀看時鐘成立時才有。 */
  readonly weekdayCounts: readonly number[] | null;
};

/**
 * 回顧結尾的「海報」資料：從已組好的章節與同一份 analytics 推導，和章節一起凍結、
 * 一起進 fingerprint。缺的指標就是缺，不補零、不從別處猜。
 */
export const buildRecapSummary = (
  result: AnalyticsResult,
  chapters: readonly RecapPresentationChapter[]
): RecapSummaryPayload => {
  // 標題列的日期、英雄磚的「共 N 天」、觀看日比例與馬拉松時間軸都讀同一份期間，
  // 30 小時制下才不會出現「6/1–7/1」配「30 天」這種自相矛盾。
  const period = summaryPeriod(result);
  return {
    title: recapTitleFor(result.scope.period),
    rangeLabel: formatDateKeyRange(period.startDateKey, period.endDateKey),
    period,
    hero: summaryHero(result, chapters),
    covers: collectSummaryCovers(chapters),
    persona: evaluateRecapPersona(chapters),
    calendar: summaryCalendar(result),
    highlights: summaryHighlights(result),
    weekdayCounts: result.habitClock.available && result.habitClock.weekdayCounts.length === 7
      ? [...result.habitClock.weekdayCounts]
      : null
  };
};

/** 日期鍵（YYYY-MM-DD）組成含頭含尾的 YYYY/MM/DD–YYYY/MM/DD。 */
export const formatDateKeyRange = (startDateKey: string, endDateKey: string): string =>
  `${startDateKey.replaceAll("-", "/")}–${endDateKey.replaceAll("-", "/")}`;

export const recapTitleFor = (period: PeriodDefinition): string => {
  if (period.kind === "calendar-year") return `${period.year} 年度回顧`;
  if (period.kind === "calendar-season") return `${period.year} 年${seasonName(period.season)}回顧`;
  if (period.kind === "calendar-month") return `${period.year} 年 ${period.month} 月回顧`;
  return period.days === 365 ? "過去一年回顧" : "近 30 日回顧";
};

export const seasonName = (season: CalendarSeason): string => {
  switch (season) {
    case "winter": return "冬季";
    case "spring": return "春季";
    case "summer": return "夏季";
    case "autumn": return "秋季";
  }
};

const summaryPeriod = (result: AnalyticsResult): RecapSummaryPeriod => {
  const mode = result.scope.axis === "watched-at" ? result.scope.dayBoundaryMode : "calendar";
  const startDateKey = toTaipeiDateKey(result.period.effectiveRange.startInclusive, mode);
  const endDateKey = toTaipeiDateKey(new Date(result.period.effectiveRange.endExclusive.getTime() - 1), mode);
  let dayCount = 1;
  for (let cursor = startDateKey; cursor < endDateKey && dayCount <= 400; cursor = addTaipeiCalendarDays(cursor, 1)) {
    dayCount += 1;
  }
  return { startDateKey, endDateKey, dayCount };
};

const summaryHero = (
  result: AnalyticsResult,
  chapters: readonly RecapPresentationChapter[]
): RecapSummaryHero => {
  const runtime = findChapter(chapters, "runtime");
  if (runtime && runtime.payload.totalContentMinutes > 0) {
    return { kind: "known-runtime", minutes: runtime.payload.totalContentMinutes };
  }
  const overview = findChapter(chapters, "overview");
  return { kind: "watch-count", count: overview?.payload.watchCount ?? result.summary.watchCount };
};

/**
 * 拼貼先收每章的主角封面（依故事順序），再用片長排行補滿；同一部作品只出現一次。
 * 讓最後一章的主角大多也在拼貼裡，結尾換場時才接得上那張封面。
 */
export const collectSummaryCovers = (
  chapters: readonly RecapPresentationChapter[]
): readonly RecapSummaryCover[] => {
  const leads: (RecapSummaryCover | null)[] = [];
  const fillers: (RecapSummaryCover | null)[] = [];
  const cover = (animeSn: number, title: string, coverUrl: string | null): RecapSummaryCover | null =>
    coverUrl ? { animeSn, title, coverUrl } : null;
  for (const chapter of chapters) {
    switch (chapter.kind) {
      case "marathon": {
        const run = chapter.payload.topSingleDayRun;
        if (run) leads.push(cover(run.animeSn, run.title, run.coverUrl));
        break;
      }
      case "runtime":
        chapter.payload.rows.forEach((row, index) =>
          (index === 0 ? leads : fillers).push(cover(row.animeSn, row.title, row.coverUrl)));
        break;
      case "completion":
        chapter.payload.nearlyRows.forEach((row, index) =>
          (index === 0 ? leads : fillers).push(cover(row.animeSn, row.title, row.coverUrl)));
        break;
      case "binge":
      case "timeliness":
      case "behavior-preference":
        chapter.payload.rows.forEach((row, index) =>
          (index === 0 ? leads : fillers).push(cover(row.animeSn, row.title, row.coverUrl)));
        break;
      case "platform-taste":
        chapter.payload.gems.forEach((gem, index) =>
          (index === 0 ? leads : fillers).push(cover(gem.animeSn, gem.title, gem.coverUrl)));
        break;
      default:
        break;
    }
  }
  const seen = new Set<number>();
  const covers: RecapSummaryCover[] = [];
  for (const candidate of [...leads, ...fillers]) {
    if (!candidate || seen.has(candidate.animeSn)) continue;
    seen.add(candidate.animeSn);
    covers.push(candidate);
    if (covers.length === RECAP_SUMMARY_COVER_LIMIT) break;
  }
  return covers;
};

const summaryHighlights = (result: AnalyticsResult): readonly RecapHighlight[] => {
  const t = RECAP_HIGHLIGHT_THRESHOLDS;
  const { newYearsEve, dawn, oldWorks } = result.highlights;
  const highlights: RecapHighlight[] = [];
  if (newYearsEve) {
    highlights.push({
      kind: "new-year",
      year: newYearsEve.year,
      before: newYearsEve.before ? highlightMoment(newYearsEve.before) : null,
      after: newYearsEve.after ? highlightMoment(newYearsEve.after) : null
    });
  }
  if (dawn) {
    highlights.push({
      kind: "dawn",
      startTime: taipeiTime(dawn.startedAt),
      episodeCount: dawn.episodeCount,
      last: highlightMoment(dawn.last)
    });
  }
  if (oldWorks) {
    const episodeShare = oldWorks.datedEpisodeCount > 0 ? oldWorks.episodeCount / oldWorks.datedEpisodeCount : 0;
    if (oldWorks.workCount >= t.oldWorkMinCount || episodeShare >= t.oldWorkMinShare) {
      highlights.push({ kind: "old-works", workCount: oldWorks.workCount, episodeShare, oldest: { ...oldWorks.oldest } });
    }
  }
  return highlights.slice(0, t.maxCount);
};

const highlightMoment = (moment: WatchMoment): RecapHighlightMoment => {
  const [, month, day] = toTaipeiDateKey(moment.watchedAt).split("-").map(Number);
  return {
    animeSn: moment.animeSn,
    title: moment.title,
    episode: moment.episode,
    coverUrl: moment.coverUrl,
    dateLabel: `${month}/${day}`,
    time: taipeiTime(moment.watchedAt)
  };
};

const taipeiTime = (date: Date): string => {
  const minute = ((Math.floor(date.getTime() / 60_000) + 8 * 60) % 1440 + 1440) % 1440;
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
};

const summaryCalendar = (result: AnalyticsResult): RecapSummaryCalendar | null => {
  const days = result.dailyCounts.map((day) => ({ dateKey: day.dateKey, count: day.count }));
  const first = days[0];
  if (!first) return null;
  const peak = days.reduce((best, day) => day.count > best.count ? day : best, first);
  if (peak.count <= 0) return null;
  let longestStreak: RecapSummaryCalendar["longestStreak"] = null;
  if (result.scope.axis === "watched-at") {
    let runStart = -1;
    days.forEach((day, index) => {
      if (day.count <= 0) {
        runStart = -1;
        return;
      }
      if (runStart < 0) runStart = index;
      const length = index - runStart + 1;
      if (length >= 2 && length > (longestStreak?.days ?? 0)) {
        longestStreak = { fromDateKey: days[runStart]!.dateKey, toDateKey: day.dateKey, days: length };
      }
    });
  }
  return {
    days,
    activeDayCount: days.filter((day) => day.count > 0).length,
    peak: { ...peak },
    longestStreak
  };
};

/**
 * 依章節 payload 判斷觀看型態；所有成立的規則依強度排序，最強者為主標籤。
 * 沒有任何規則成立時回傳 null，海報就不放標籤。
 */
export const evaluateRecapPersona = (
  chapters: readonly RecapPresentationChapter[]
): RecapPersona | null => {
  const t = RECAP_PERSONA_THRESHOLDS;
  const traits: RecapPersonaTrait[] = [];

  const timeliness = findChapter(chapters, "timeliness");
  if (
    timeliness
    && releaseLagSampleCount(timeliness.payload) >= t.freshMinSamples
    && timeliness.payload.overallWithin24HoursRate >= t.freshWithin24HoursRate
  ) {
    traits.push({
      key: "fresh",
      label: "追新番派",
      reason: `${formatPercent(timeliness.payload.overallWithin24HoursRate)} 的觀看，在上架 24 小時內就按下播放`,
      chapterId: "timeliness",
      strength: strength(timeliness.payload.overallWithin24HoursRate, t.freshWithin24HoursRate, t.freshStrongRate)
    });
  }

  const marathon = findChapter(chapters, "marathon");
  const run = marathon?.payload.topSingleDayRun ?? null;
  if (run && run.watchCount >= t.bingeSingleDayEpisodes) {
    traits.push({
      key: "binge",
      label: "一口氣派",
      reason: `${shortDateLabel(run.dateKey)}一天連看《${truncateText(run.title, 14)}》${formatInteger(run.watchCount)} 集`,
      chapterId: "marathon",
      strength: strength(run.watchCount, t.bingeSingleDayEpisodes, t.bingeStrongEpisodes)
    });
  }

  const completion = findChapter(chapters, "completion");
  if (completion && completion.payload.startedCount > 0) {
    const { startedCount, finishedCount, tastedCount } = completion.payload;
    const completedShare = finishedCount / startedCount;
    if (finishedCount >= t.completistMinCount && completedShare >= t.completistShare) {
      traits.push({
        key: "completist",
        label: "完食派",
        reason: `從頭開始看的 ${formatInteger(startedCount)} 部裡，${formatInteger(finishedCount)} 部一集不漏`,
        chapterId: "completion",
        strength: strength(completedShare, t.completistShare, t.completistStrongShare)
      });
    }
    const tastedShare = tastedCount / startedCount;
    if (tastedCount >= t.samplerMinCount && tastedShare >= t.samplerShare) {
      traits.push({
        key: "sampler",
        label: "試吃家",
        reason: `${formatInteger(tastedCount)} 部作品只看了一集，就換下一部`,
        chapterId: "completion",
        strength: strength(tastedShare, t.samplerShare, t.samplerStrongShare)
      });
    }
  }

  const clock = findChapter(chapters, "habit-clock");
  const lateNight = clock?.payload.segments.find((segment) => segment.key === "late-night");
  const clockWatches = clock?.payload.hourCounts.reduce((sum, count) => sum + count, 0) ?? 0;
  if (lateNight && clockWatches >= t.nightOwlMinWatches && lateNight.share >= t.nightOwlShare) {
    traits.push({
      key: "night-owl",
      label: "深夜場常客",
      reason: `${formatPercent(lateNight.share)} 的播放落在深夜 ${formatHourRange(lateNight.startHour, lateNight.endHour)}`,
      chapterId: "habit-clock",
      strength: strength(lateNight.share, t.nightOwlShare, t.nightOwlStrongShare)
    });
  }

  const gem = findChapter(chapters, "platform-taste")?.payload.gems[0] ?? null;
  if (gem) {
    traits.push({
      key: "curator",
      label: "獨到眼光",
      reason: `你最先點開的《${truncateText(gem.title, 14)}》，同季你看的 ${formatInteger(gem.cohortSize)} 部裡人氣只排第 ${formatInteger(gem.popularityRank)}`,
      chapterId: "platform-taste",
      strength: strength(1 - gem.popularityRatio, t.curatorShortfall, t.curatorStrongShortfall)
    });
  }

  // 同強度時維持規則宣告順序（sort 為穩定排序）。
  const ranked = traits.slice().sort((left, right) => right.strength - left.strength);
  const primary = ranked[0];
  if (!primary) return null;
  return { primary, others: ranked.slice(1, 3) };
};

/** payload 只帶 24 小時內的次數與比例；樣本數就是兩者相除（比例為 0 時規則本來就不成立）。 */
const releaseLagSampleCount = (payload: TimelinessPayload): number =>
  payload.overallWithin24HoursRate > 0
    ? Math.round(payload.overallWithin24HoursCount / payload.overallWithin24HoursRate)
    : 0;

const strength = (value: number, threshold: number, strong: number): number => {
  if (strong <= threshold) return 1;
  const ratio = (value - threshold) / (strong - threshold);
  return Math.round(Math.min(1, Math.max(0, ratio)) * 1000) / 1000;
};

const shortDateLabel = (dateKey: string): string => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return `${year} 年 ${month} 月 ${day} 日`;
};

const findChapter = <Kind extends RecapChapterKind>(
  chapters: readonly RecapPresentationChapter[],
  kind: Kind
): Extract<RecapPresentationChapter, { readonly kind: Kind }> | undefined =>
  chapters.find((chapter): chapter is Extract<RecapPresentationChapter, { readonly kind: Kind }> =>
    chapter.kind === kind);
