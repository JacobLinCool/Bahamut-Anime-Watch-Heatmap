import type { AnalyticsResult } from "../analytics";
import { formatHourRange, formatInteger, formatPercent, truncateText } from "../analysis-format";
import type { CalendarSeason, PeriodDefinition } from "../period";
import { addTaipeiCalendarDays, toTaipeiDateKey } from "../time";
import type { RecapChapterKind, RecapPresentationChapter, TimelinessPayload } from "./recap-deck";

/** 拼貼最多放幾張封面：夠形成一疊，又不會把英雄數字擠走。 */
export const RECAP_SUMMARY_COVER_LIMIT = 7;
export const RECAP_SUMMARY_LEDGER_LIMIT = 5;

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
  /** 完食派：可核對作品中完整看完的比例與最低部數。 */
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
  /** 獨到眼光：自己前幾名的作品，平台人氣排名落後多少名。 */
  curatorMaxPersonalRank: 3,
  curatorMinGap: 20,
  curatorStrongGap: 100
});

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

export type RecapSummaryLedgerMetric =
  | "known-minutes"
  | "watch-count"
  | "win-rate"
  | "completion"
  | "median-lag";

export type RecapSummaryLedgerRow = {
  readonly rank: number;
  readonly animeSn: number;
  readonly title: string;
  readonly coverUrl: string | null;
  readonly value: number;
  readonly watchCount: number | null;
};

export type RecapSummaryLedger = {
  readonly chapterId: RecapChapterKind;
  readonly metric: RecapSummaryLedgerMetric;
  readonly label: string;
  readonly rows: readonly RecapSummaryLedgerRow[];
};

export type RecapSummaryRhythmPoint = {
  /** YYYY-MM（月）或 YYYY-MM-DD（日）。 */
  readonly key: string;
  readonly count: number;
};

export type RecapSummaryRhythm = {
  /** week：季度這類一到四個月的期間，月份太少、日又太多，改用七天一格。 */
  readonly granularity: "month" | "week" | "day";
  readonly points: readonly RecapSummaryRhythmPoint[];
  readonly peak: RecapSummaryRhythmPoint;
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
  readonly ledger: RecapSummaryLedger | null;
  readonly persona: RecapPersona | null;
  readonly rhythm: RecapSummaryRhythm | null;
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
    ledger: summaryLedger(chapters),
    persona: evaluateRecapPersona(chapters),
    rhythm: summaryRhythm(result.weeklyRhythm ?? result.rhythm, result.weeklyRhythm !== undefined),
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
      case "timeliness":
      case "behavior-preference":
        chapter.payload.rows.forEach((row, index) =>
          (index === 0 ? leads : fillers).push(cover(row.animeSn, row.title, row.coverUrl)));
        break;
      case "platform-taste": {
        const lead = chapter.payload.hiddenGem ?? chapter.payload.rows[0] ?? null;
        if (lead) leads.push(cover(lead.animeSn, lead.title, lead.coverUrl));
        for (const row of chapter.payload.rows) fillers.push(cover(row.animeSn, row.title, row.coverUrl));
        break;
      }
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

/** 片長排行優先；沒有片長時改用其他「依作品排名」的清單，並如實標示排名依據。 */
const summaryLedger = (chapters: readonly RecapPresentationChapter[]): RecapSummaryLedger | null => {
  const runtime = findChapter(chapters, "runtime");
  if (runtime && runtime.payload.rows.length > 0) {
    return {
      chapterId: "runtime",
      metric: "known-minutes",
      label: "片長排行",
      rows: runtime.payload.rows.slice(0, RECAP_SUMMARY_LEDGER_LIMIT).map((row) => ({
        rank: row.rank,
        animeSn: row.animeSn,
        title: row.title,
        coverUrl: row.coverUrl,
        value: row.contentMinutes,
        watchCount: row.watchCount
      }))
    };
  }
  const platform = findChapter(chapters, "platform-taste");
  if (platform && platform.payload.rows.length > 0) {
    return {
      chapterId: "platform-taste",
      metric: "watch-count",
      label: "最常看的作品",
      rows: platform.payload.rows
        .slice()
        .sort((left, right) => left.personalWatchRank - right.personalWatchRank)
        .slice(0, RECAP_SUMMARY_LEDGER_LIMIT)
        .map((row) => ({
          rank: row.personalWatchRank,
          animeSn: row.animeSn,
          title: row.title,
          coverUrl: row.coverUrl,
          value: row.personalWatchCount,
          watchCount: row.personalWatchCount
        }))
    };
  }
  const preference = findChapter(chapters, "behavior-preference");
  if (preference && preference.payload.rows.length > 0) {
    return {
      chapterId: "behavior-preference",
      metric: "win-rate",
      label: "有得選時最先看",
      rows: preference.payload.rows.slice(0, RECAP_SUMMARY_LEDGER_LIMIT).map((row) => ({
        rank: row.rank,
        animeSn: row.animeSn,
        title: row.title,
        coverUrl: row.coverUrl,
        value: row.rawWinRate,
        watchCount: null
      }))
    };
  }
  const completion = findChapter(chapters, "completion");
  if (completion && completion.payload.rows.length > 0) {
    return {
      chapterId: "completion",
      metric: "completion",
      label: "追得最完整",
      rows: completion.payload.rows.slice(0, RECAP_SUMMARY_LEDGER_LIMIT).map((row, index) => ({
        rank: index + 1,
        animeSn: row.animeSn,
        title: row.title,
        coverUrl: row.coverUrl,
        value: row.ratio,
        watchCount: null
      }))
    };
  }
  const timeliness = findChapter(chapters, "timeliness");
  if (timeliness && timeliness.payload.rows.length > 0) {
    return {
      chapterId: "timeliness",
      metric: "median-lag",
      label: "追得最快",
      rows: timeliness.payload.rows.slice(0, RECAP_SUMMARY_LEDGER_LIMIT).map((row) => ({
        rank: row.rank,
        animeSn: row.animeSn,
        title: row.title,
        coverUrl: row.coverUrl,
        value: row.medianLagMinutes,
        watchCount: null
      }))
    };
  }
  return null;
};

const summaryRhythm = (rhythm: AnalyticsResult["rhythm"], weekly: boolean): RecapSummaryRhythm | null => {
  if (rhythm.length === 0) return null;
  const points = rhythm.map((point) => ({ key: point.label, count: point.count }));
  const peak = points.reduce((best, point) => point.count > best.count ? point : best, points[0]!);
  if (peak.count <= 0) return null;
  return {
    granularity: weekly ? "week" : points.every((point) => point.key.length === 10) ? "day" : "month",
    points,
    peak: { ...peak }
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
  if (completion && completion.payload.sampledCount > 0) {
    const { sampledCount, completedCount, tastedCount } = completion.payload;
    const completedShare = completedCount / sampledCount;
    if (completedCount >= t.completistMinCount && completedShare >= t.completistShare) {
      traits.push({
        key: "completist",
        label: "完食派",
        reason: `可核對集數的 ${formatInteger(sampledCount)} 部裡，${formatInteger(completedCount)} 部一集不漏`,
        chapterId: "completion",
        strength: strength(completedShare, t.completistShare, t.completistStrongShare)
      });
    }
    const tastedShare = tastedCount / sampledCount;
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

  const platform = findChapter(chapters, "platform-taste");
  const gem = platform?.payload.hiddenGem ?? null;
  if (gem && gem.personalWatchRank <= t.curatorMaxPersonalRank && gem.gap >= t.curatorMinGap) {
    traits.push({
      key: "curator",
      label: "獨到眼光",
      reason: `你排第 ${formatInteger(gem.personalWatchRank)} 的《${truncateText(gem.title, 14)}》，平台人氣只排第 ${formatInteger(gem.platformRank)}`,
      chapterId: "platform-taste",
      strength: strength(gem.gap, t.curatorMinGap, t.curatorStrongGap)
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
