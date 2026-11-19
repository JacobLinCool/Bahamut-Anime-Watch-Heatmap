import type {
  AnalyticsResult,
  BingeRow,
  ClockSegment,
  CompletionRow,
  DimensionRow,
  DropTagRow,
  HiddenGemRow,
  PreferenceRow,
  SeasonBreakdownRow,
  SeriesRuntimeRow,
  TimelinessRow
} from "../analytics";
import { formatClockHour, formatEpisodesPerDay, formatHourRange, formatInteger, formatPercent, truncateText } from "../analysis-format";
import {
  analysisScopeKey,
  type AnalysisAxis,
  type CalendarSeason,
  type PeriodDefinition
} from "../period";

import type { RecapChapter, RecapDeck } from "./recap-state";
import { buildRecapSummary, type RecapSummaryPayload } from "./recap-summary";

/** Story titles weave work titles into sentences; clamp them so one runaway title can't take over the stage. */
const STORY_TITLE_LIMIT = 20;
const RECAP_SCHEMA_VERSION = 9;
const MAX_RANKED_ROWS = 5;
const SEASON_ORDER: readonly CalendarSeason[] = ["winter", "spring", "summer", "autumn"];

export type RecapEvidenceRow =
  | {
      readonly kind: "count";
      readonly label: string;
      readonly value: number;
      readonly unit: "watch" | "episode" | "anime" | "day" | "choice" | "sample";
    }
  | {
      readonly kind: "minutes";
      readonly label: string;
      readonly minutes: number;
    }
  | {
      readonly kind: "ratio";
      readonly label: string;
      readonly numerator: number;
      readonly denominator: number;
      readonly ratio: number | null;
    }
  | {
      readonly kind: "text";
      readonly label: string;
      readonly value: string;
    };

export type RecapChapterKind =
  | "overview"
  | "season-breakdown"
  | "habit-clock"
  | "marathon"
  | "runtime"
  | "timeliness"
  | "behavior-preference"
  | "taste"
  | "completion"
  | "binge"
  | "platform-taste";

type RecapChapterBase<Kind extends RecapChapterKind, Payload> = RecapChapter & {
  readonly kind: Kind;
  readonly eyebrow: string;
  readonly narrative: string;
  readonly evidence: readonly RecapEvidenceRow[];
  readonly payload: Payload;
};

export type OverviewPayload = {
  readonly scopeLabel: string;
  readonly periodStatus: AnalyticsResult["period"]["periodStatus"];
  readonly axis: AnalysisAxis;
  readonly watchCount: number;
  readonly uniqueEpisodeCount: number;
  readonly identifiableAnimeCount: number;
  readonly activeDayCount: number;
};

export type OverviewChapter = RecapChapterBase<"overview", OverviewPayload>;

export type SeasonBreakdownPayloadRow = {
  readonly year: number;
  readonly season: CalendarSeason;
  readonly label: string;
  readonly watchCount: number;
  readonly animeCount: number;
  readonly contentMinutes: number | null;
};

export type SeasonBreakdownPayload = {
  readonly year: number;
  readonly rows: readonly SeasonBreakdownPayloadRow[];
  readonly leadingSeasons: readonly CalendarSeason[];
};

export type SeasonBreakdownChapter = RecapChapterBase<"season-breakdown", SeasonBreakdownPayload>;

export type RuntimeSeriesPayload = Pick<
  SeriesRuntimeRow,
  "rank" | "animeSn" | "title" | "coverUrl" | "watchCount" | "contentMinutes"
>;

export type LongestEpisodePayload = {
  readonly videoSn: number;
  readonly animeSn: number;
  readonly title: string;
  readonly episode: string;
  readonly coverUrl: string | null;
  readonly durationMinutes: number;
  readonly watchedAtIso: string;
};

export type RuntimePayload = {
  readonly totalContentMinutes: number;
  readonly rows: readonly RuntimeSeriesPayload[];
  readonly longestEpisode: LongestEpisodePayload | null;
};

export type RuntimeChapter = RecapChapterBase<"runtime", RuntimePayload>;

export type TimelinessAnimePayload = Pick<
  TimelinessRow,
  | "rank"
  | "animeSn"
  | "title"
  | "coverUrl"
  | "sampleCount"
  | "medianLagMinutes"
  | "within24HoursCount"
  | "within24HoursRate"
>;

export type TimelinessPayload = {
  readonly overallMedianLagMinutes: number;
  readonly overallWithin24HoursCount: number;
  readonly overallWithin24HoursRate: number;
  readonly rows: readonly TimelinessAnimePayload[];
};

export type TimelinessChapter = RecapChapterBase<"timeliness", TimelinessPayload>;

export type PreferenceAnimePayload = Pick<
  PreferenceRow,
  | "rank"
  | "animeSn"
  | "title"
  | "coverUrl"
  | "wins"
  | "losses"
  | "comparisons"
  | "rawWinRate"
  | "wilsonLower95"
  | "distinctOpponentCount"
  | "decisionBucketCount"
>;

export type SeasonFavoritesPayload = {
  readonly year: number;
  readonly season: CalendarSeason;
  /** 「冬季」這類短名，年份由期間本身交代。 */
  readonly label: string;
  /** 前幾名；這季時刻太少、看不出偏心誰時為空。 */
  readonly rows: readonly PreferenceAnimePayload[];
};

export type BehaviorPreferencePayload = {
  readonly choiceEventCount: number;
  readonly rows: readonly PreferenceAnimePayload[];
  /** 年度回顧逐季的最愛（已開始的季）；其他期間為空。 */
  readonly seasons: readonly SeasonFavoritesPayload[];
};

export type BehaviorPreferenceChapter = RecapChapterBase<
  "behavior-preference",
  BehaviorPreferencePayload
>;

export type TasteDimensionPayload = Pick<
  DimensionRow,
  "rank" | "label" | "animeCount" | "watchCount"
> & {
  /** Exact sum of known durations only; never presented as total runtime. */
  readonly knownContentMinutes: number;
};

export type TastePayload = {
  readonly tags: readonly TasteDimensionPayload[];
  readonly makers: readonly TasteDimensionPayload[];
  readonly directors: readonly TasteDimensionPayload[];
  readonly publishers: readonly TasteDimensionPayload[];
};

export type TasteChapter = RecapChapterBase<"taste", TastePayload>;

export type HabitClockPayload = {
  readonly hourCounts: readonly number[];
  readonly peakHour: number;
  readonly peakHourCount: number;
  readonly segments: readonly ClockSegment[];
  readonly topSegment: ClockSegment;
  readonly topWeekday: { readonly weekday: number; readonly label: string; readonly watchCount: number };
};

export type HabitClockChapter = RecapChapterBase<"habit-clock", HabitClockPayload>;

export type MarathonPayload = {
  readonly peakDay: {
    readonly dateKey: string;
    readonly watchCount: number;
    readonly knownContentMinutes: number;
  };
  readonly longestStreak: {
    readonly days: number;
    readonly fromDateKey: string;
    readonly toDateKey: string;
  } | null;
  readonly topSingleDayRun: {
    readonly animeSn: number;
    readonly title: string;
    readonly coverUrl: string | null;
    readonly dateKey: string;
    readonly watchCount: number;
  } | null;
};

export type MarathonChapter = RecapChapterBase<"marathon", MarathonPayload>;

export type CompletionPayloadRow = Pick<
  CompletionRow,
  "animeSn" | "title" | "coverUrl" | "watchedEpisodeCount" | "totalEpisode" | "ratio" | "isOngoing"
>;

export type DropTagPayload = Pick<DropTagRow, "label" | "startedCount" | "droppedCount" | "dropRate">;

/** 追番成績單：只算從第 1 集開始看、已完結的作品，還在播的另外算。 */
export type CompletionPayload = {
  /** 看完＋差一點看完＋半途停下＋放棄。 */
  readonly startedCount: number;
  readonly finishedCount: number;
  readonly nearlyCount: number;
  readonly midwayCount: number;
  readonly droppedCount: number;
  /** 放棄的作品裡只看了第 1 集的。 */
  readonly tastedCount: number;
  /** Still-airing anime with a verifiable structure; their episode total is only what has aired. */
  readonly airingCount: number;
  /** Still-airing anime watched up to the latest aired episode. */
  readonly caughtUpCount: number;
  /** 差一點看完的作品，差得最少的在前，最多三部。 */
  readonly nearlyRows: readonly CompletionPayloadRow[];
  /** 放棄比例明顯高於整體的類型；不明顯時為 null。 */
  readonly mostDroppedTag: DropTagPayload | null;
  /** 放棄比例明顯低於整體的類型；不明顯時為 null。 */
  readonly leastDroppedTag: DropTagPayload | null;
  /** 開始看的作品夠多的類型，放棄比例高的在前；全部列出，最能看完的一端才不會被截掉。 */
  readonly tagDrops: readonly DropTagPayload[];
};

export type CompletionChapter = RecapChapterBase<"completion", CompletionPayload>;

export type BingePayloadRow = Pick<
  BingeRow,
  "rank" | "animeSn" | "title" | "coverUrl" | "episodesPerDay"
>;

export type BingePayload = {
  readonly completedCount: number;
  readonly rows: readonly BingePayloadRow[];
};

export type BingeChapter = RecapChapterBase<"binge", BingePayload>;

export type HiddenGemPayload = HiddenGemRow & {
  /** 開播季，例如「2026 夏季」。 */
  readonly cohortLabel: string;
};

export type PlatformTastePayload = {
  /** 一到兩部，最冷門的在前。 */
  readonly gems: readonly HiddenGemPayload[];
};

export type PlatformTasteChapter = RecapChapterBase<"platform-taste", PlatformTastePayload>;

export type RecapPresentationChapter =
  | OverviewChapter
  | SeasonBreakdownChapter
  | HabitClockChapter
  | MarathonChapter
  | RuntimeChapter
  | TimelinessChapter
  | BehaviorPreferenceChapter
  | TasteChapter
  | CompletionChapter
  | BingeChapter
  | PlatformTasteChapter;

export type RecapOmissionReason =
  | "no-watches"
  | "not-release-calendar-year"
  | "inconsistent-season-breakdown"
  | "insufficient-duration-coverage"
  | "insufficient-timeliness"
  | "insufficient-preference"
  | "no-taste-dimensions"
  | "no-habit-clock"
  | "no-marathon"
  | "no-completion-structure"
  | "no-binge-completions"
  | "no-hidden-gem";

export type RecapChapterOmission = {
  readonly chapter: RecapChapterKind;
  readonly reason: RecapOmissionReason;
  readonly message: string;
};

export type RecapScopePresentation = {
  readonly key: string;
  readonly label: string;
  readonly axis: AnalysisAxis;
  readonly period: PeriodDefinition;
  readonly periodStatus: AnalyticsResult["period"]["periodStatus"];
  readonly startInclusiveIso: string;
  readonly endExclusiveIso: string;
};

export type RecapPresentationDeck = RecapDeck<RecapPresentationChapter> & {
  readonly schemaVersion: typeof RECAP_SCHEMA_VERSION;
  readonly scope: RecapScopePresentation;
  readonly omissions: readonly RecapChapterOmission[];
  /** 結尾海報：與章節同時凍結，fingerprint 一併涵蓋。 */
  readonly summary: RecapSummaryPayload;
};

/**
 * Converts one verified analytics result into the presentation deck used by
 * both seasonal and annual recaps. The builder never fills an unavailable
 * metric with zero and never derives a release season outside analytics.
 */
export const buildRecapDeck = (result: AnalyticsResult): RecapPresentationDeck => {
  assertConsistentResult(result);
  const chapters: RecapPresentationChapter[] = [];
  const omissions: RecapChapterOmission[] = [];
  appendOverview(result, chapters, omissions);
  appendSeasonBreakdown(result, chapters, omissions);
  appendHabitClock(result, chapters, omissions);
  appendMarathon(result, chapters, omissions);
  appendRuntime(result, chapters, omissions);
  appendTaste(result, chapters, omissions);
  appendCompletion(result, chapters, omissions);
  appendBinge(result, chapters, omissions);
  appendTimeliness(result, chapters, omissions);
  appendPreference(result, chapters, omissions);
  appendPlatformTaste(result, chapters, omissions);

  const scope: RecapScopePresentation = {
    key: result.period.key,
    label: result.period.label,
    axis: result.scope.axis,
    period: copyPeriod(result.scope.period),
    periodStatus: result.period.periodStatus,
    startInclusiveIso: result.period.effectiveRange.startInclusive.toISOString(),
    endExclusiveIso: result.period.effectiveRange.endExclusive.toISOString()
  };
  const summary = buildRecapSummary(result, chapters);
  // 指紋只涵蓋畫面上看得到的內容。滾動期間的結束時間跟著資料時間逐分鐘前進（例如保存的紀錄
  // 換成剛讀到的頁面），但只要標籤、範圍文字與各章內容沒變，播放中的回顧就不算過時。
  const { startInclusiveIso: _start, endExclusiveIso: _end, ...visibleScope } = scope;
  const fingerprint = `recap-v${RECAP_SCHEMA_VERSION}:${sha256(stableStringify({
    schemaVersion: RECAP_SCHEMA_VERSION,
    scope: visibleScope,
    chapters,
    omissions,
    summary
  }))}`;
  return deepFreeze({
    schemaVersion: RECAP_SCHEMA_VERSION,
    fingerprint,
    scopeKey: result.period.key,
    scope,
    chapters,
    omissions,
    summary
  });
};

const appendOverview = (
  result: AnalyticsResult,
  chapters: RecapPresentationChapter[],
  omissions: RecapChapterOmission[]
): void => {
  if (result.summary.watchCount === 0) {
    omit(omissions, "overview", "no-watches", "所選期間沒有可用的觀看紀錄。");
    return;
  }
  const activeDayLabel = result.scope.axis === "released-at" ? "個上架日" : "天";
  chapters.push({
    id: "overview",
    kind: "overview",
    title: `${formatInteger(result.summary.watchCount)} 次播放，分布在 ${formatInteger(result.summary.activeDayCount)} ${activeDayLabel}`,
    eyebrow: result.period.label,
    // 作品資料還沒到時無法辨識作品，不說「來自 0 部作品」。
    narrative: result.summary.animeCount > 0
      ? `你看了 ${formatInteger(result.summary.uniqueEpisodeCount)} 個不同單集，來自 ${formatInteger(result.summary.animeCount)} 部作品。`
      : `你看了 ${formatInteger(result.summary.uniqueEpisodeCount)} 個不同單集。`,
    evidence: [
      textEvidence(
        "期間歸類",
        result.scope.axis === "released-at" ? "依每一集的實際上架時間" : "依每一次觀看發生的時間"
      ),
      countEvidence("觀看次數", result.summary.watchCount, "watch"),
      countEvidence("不同單集", result.summary.uniqueEpisodeCount, "episode"),
      countEvidence("作品數", result.summary.animeCount, "anime"),
      countEvidence(
        result.scope.axis === "released-at" ? "上架日數" : "觀看日數",
        result.summary.activeDayCount,
        "day"
      )
    ],
    payload: {
      scopeLabel: result.period.label,
      periodStatus: result.period.periodStatus,
      axis: result.scope.axis,
      watchCount: result.summary.watchCount,
      uniqueEpisodeCount: result.summary.uniqueEpisodeCount,
      identifiableAnimeCount: result.summary.animeCount,
      activeDayCount: result.summary.activeDayCount
    }
  });
};

const appendSeasonBreakdown = (
  result: AnalyticsResult,
  chapters: RecapPresentationChapter[],
  omissions: RecapChapterOmission[]
): void => {
  const period = result.scope.period;
  if (result.scope.axis !== "released-at" || period.kind !== "calendar-year") {
    omit(
      omissions,
      "season-breakdown",
      "not-release-calendar-year",
      "選擇「內容何時上架」的完整年度後，回顧會加入四季分布。"
    );
    return;
  }
  const rows = normalizedAnnualSeasonRows(result.seasonBreakdown, period.year);
  if (rows === null) {
    omit(
      omissions,
      "season-breakdown",
      "inconsistent-season-breakdown",
      "四季資料目前未完整對應這個年度。"
    );
    return;
  }
  const leader = rows.slice().sort((left, right) => right.watchCount - left.watchCount
    || seasonIndex(left.season) - seasonIndex(right.season))[0];
  if (!leader || leader.watchCount === 0) {
    omit(omissions, "season-breakdown", "no-watches", "這個年度沒有可歸入季度的觀看紀錄。");
    return;
  }
  const leadingRows = rows.filter((row) => row.watchCount === leader.watchCount);
  const leadingLabels = formatChineseList(leadingRows.map((row) => row.label));
  const title = leadingRows.length === 1
    ? joinWithSpacing("你最常看", leadingLabels, "上架的動畫")
    : joinWithSpacing(leadingLabels, "並列你最常看的上架季");
  chapters.push({
    id: "season-breakdown",
    kind: "season-breakdown",
    title,
    eyebrow: `${period.year} 年四季`,
    narrative: leadingRows.length === 1
      ? `${formatInteger(leader.watchCount)} 集，來自 ${formatInteger(leader.animeCount)} 部作品。`
      : `各看了 ${formatInteger(leader.watchCount)} 集。`,
    evidence: [
      ...rows.map((row) => countEvidence(row.label, row.watchCount, "watch"))
    ],
    payload: {
      year: period.year,
      rows,
      leadingSeasons: leadingRows.map((row) => row.season)
    }
  });
};

const SEGMENT_TITLES: Record<ClockSegment["key"], string> = {
  "late-night": "你是深夜黨",
  evening: "晚間是你的黃金檔",
  daytime: "白天的你看得最勤",
  morning: "你的一天從動畫開始"
};

const appendHabitClock = (
  result: AnalyticsResult,
  chapters: RecapPresentationChapter[],
  omissions: RecapChapterOmission[]
): void => {
  const clock = result.habitClock;
  if (!clock.available || !clock.topSegment || !clock.topWeekday || clock.peakHour === null) {
    omit(omissions, "habit-clock", "no-habit-clock", "這段期間沒有可統計的觀看時間。");
    return;
  }
  const top = clock.topSegment;
  chapters.push({
    id: "habit-clock",
    kind: "habit-clock",
    title: SEGMENT_TITLES[top.key],
    eyebrow: "觀看時鐘",
    narrative: `${formatPercent(top.share)} 的播放落在${top.label}（${formatHourRange(top.startHour, top.endHour)}），最常按下播放的是${clock.topWeekday.label}。`,
    evidence: [
      textEvidence("統計方式", "以每一次播放的台北時間統計，深夜段跨越午夜。"),
      ...clock.segments.map((segment) =>
        countEvidence(`${segment.label}（${formatHourRange(segment.startHour, segment.endHour)}）`, segment.watchCount, "watch")),
      countEvidence(`高峰時刻 ${formatClockHour(clock.peakHour)}`, clock.peakHourCount, "watch"),
      countEvidence(`最常觀看的 ${clock.topWeekday.label}`, clock.topWeekday.watchCount, "watch")
    ],
    payload: {
      hourCounts: [...clock.hourCounts],
      peakHour: clock.peakHour,
      peakHourCount: clock.peakHourCount,
      segments: clock.segments.map((segment) => ({ ...segment })),
      topSegment: { ...top },
      topWeekday: { ...clock.topWeekday }
    }
  });
};

const dateKeyLabel = (dateKey: string): string => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return `${year} 年 ${month} 月 ${day} 日`;
};

const appendMarathon = (
  result: AnalyticsResult,
  chapters: RecapPresentationChapter[],
  omissions: RecapChapterOmission[]
): void => {
  const marathon = result.marathon;
  if (!marathon.available || !marathon.peakDay || marathon.peakDay.watchCount < 2) {
    omit(omissions, "marathon", "no-marathon", "這段期間沒有值得一提的觀看衝刺。");
    return;
  }
  const peakDay = marathon.peakDay;
  const streak = marathon.longestStreak;
  const run = marathon.topSingleDayRun;
  const narrativeParts = [`${dateKeyLabel(peakDay.dateKey)}${peakDay.knownContentMinutes > 0 ? `，一共 ${formatMinutes(peakDay.knownContentMinutes)}` : ""}。`];
  if (streak && streak.days >= 2) narrativeParts.push(`最長連續 ${formatInteger(streak.days)} 天，天天都有動畫。`);
  chapters.push({
    id: "marathon",
    kind: "marathon",
    title: `最猛的一天，你按了 ${formatInteger(peakDay.watchCount)} 次播放`,
    eyebrow: "觀看馬拉松",
    narrative: narrativeParts.join(""),
    evidence: [
      countEvidence(`單日最高（${dateKeyLabel(peakDay.dateKey)}）`, peakDay.watchCount, "watch"),
      ...(peakDay.knownContentMinutes > 0 ? [minutesEvidence("當天觀看時間", peakDay.knownContentMinutes)] : []),
      ...(streak ? [countEvidence(`最長連續（${dateKeyLabel(streak.fromDateKey)} 起）`, streak.days, "day")] : []),
      ...(run ? [countEvidence(`單日單作品最多：${run.title}`, run.watchCount, "episode")] : [])
    ],
    payload: {
      peakDay: { ...peakDay },
      longestStreak: streak ? { ...streak } : null,
      topSingleDayRun: run ? { ...run } : null
    }
  });
};

/** 類型的放棄比例要比整體高（低）這麼多倍，才值得說「最常放棄」「最能看完」。 */
const DROP_TAG_HIGH_FACTOR = 1.3;
const DROP_TAG_LOW_FACTOR = 0.7;
const DROP_TAG_MIN_DROPPED = 3;
const MAX_NEARLY_ROWS = 3;

const appendCompletion = (
  result: AnalyticsResult,
  chapters: RecapPresentationChapter[],
  omissions: RecapChapterOmission[]
): void => {
  const rows = result.completion.rows;
  const count = (outcome: CompletionRow["outcome"]): number => rows.filter((row) => row.outcome === outcome).length;
  const finishedCount = count("finished");
  const nearlyCount = count("nearly");
  const midwayCount = count("midway");
  const droppedCount = count("dropped");
  const startedCount = finishedCount + nearlyCount + midwayCount + droppedCount;
  const caughtUpCount = count("caught-up");
  const airingCount = caughtUpCount + count("behind");
  if (!result.completion.available || startedCount + airingCount === 0) {
    omit(omissions, "completion", "no-completion-structure", "這段期間沒有從第 1 集開始看、集數能一一對上的作品。");
    return;
  }
  const tastedCount = rows.filter((row) => row.outcome === "dropped" && row.watchedEpisodeCount === 1).length;
  const nearlyRows = rows
    .filter((row) => row.outcome === "nearly")
    .sort((left, right) => (left.totalEpisode - left.watchedEpisodeCount) - (right.totalEpisode - right.watchedEpisodeCount)
      || right.ratio - left.ratio
      || left.animeSn - right.animeSn)
    .slice(0, MAX_NEARLY_ROWS)
    .map(copyCompletionRow);
  // 類型的放棄比例只有和整體差得夠多才說：每個類型都差不多時，硬挑一個只是雜訊。
  const overallDropRate = startedCount > 0 ? droppedCount / startedCount : 0;
  const tags = result.completion.dropTags;
  const most = tags[0];
  const least = tags.at(-1);
  const mostDroppedTag = most && most.droppedCount >= DROP_TAG_MIN_DROPPED && most.dropRate >= overallDropRate * DROP_TAG_HIGH_FACTOR
    ? copyDropTag(most)
    : null;
  const leastDroppedTag = least && least !== most && least.dropRate <= overallDropRate * DROP_TAG_LOW_FACTOR
    ? copyDropTag(least)
    : null;

  const title = finishedCount > 0
    ? `你把 ${formatInteger(finishedCount)} 部作品從頭看到尾`
    : startedCount > 0
      ? `從頭開始看的 ${formatInteger(startedCount)} 部作品，還沒有一部看完`
      : caughtUpCount > 0
        ? `還在播的作品裡，你有 ${formatInteger(caughtUpCount)} 部追到最新一集`
        : `還在播的 ${formatInteger(airingCount)} 部作品，你都還在追`;
  const narrative = startedCount === 0
    ? "這段期間看的作品都還在播，要等完結才算得出看完了沒。"
    : `從第 1 集開始看、已完結的 ${formatInteger(startedCount)} 部作品裡，有 ${formatPercent(finishedCount / startedCount)} 一集不漏。`;
  chapters.push({
    id: "completion",
    kind: "completion",
    title,
    eyebrow: "追番成績單",
    narrative,
    evidence: [
      textEvidence("怎麼分類", "只算從第 1 集開始看、已經播完的作品：每一集都看了算「看完」；只差最後一兩集算「差一點看完」；看了一半以上、但還差三集以上算「半途停下」；看不到一半算「放棄」。第 1 集不在紀錄裡的作品分不出是哪一種，不列入。"),
      textEvidence("還在播的作品", "只算到目前已播的集數，看到最新一集算「追到最新」，不算進看完。"),
      textEvidence("統計範圍", result.scope.axis === "watched-at"
        ? "統計期間內出現、集數能一一對上的作品；看過的集數累計到本期結束。"
        : "統計上架期間內出現、集數能一一對上的作品；看過的集數依觀看紀錄累計。"),
      countEvidence("看完", finishedCount, "anime"),
      countEvidence("差一點看完", nearlyCount, "anime"),
      countEvidence("半途停下", midwayCount, "anime"),
      countEvidence("放棄", droppedCount, "anime"),
      ...(airingCount > 0 ? [countEvidence("還在播、追到最新", caughtUpCount, "anime")] : []),
      ...tags.slice(0, 3).map((tag) => textEvidence(
        `類型：${tag.label}`,
        `${formatInteger(tag.startedCount)} 部裡放棄 ${formatInteger(tag.droppedCount)} 部`
      ))
    ],
    payload: {
      startedCount,
      finishedCount,
      nearlyCount,
      midwayCount,
      droppedCount,
      tastedCount,
      airingCount,
      caughtUpCount,
      nearlyRows,
      mostDroppedTag,
      leastDroppedTag,
      tagDrops: tags.map(copyDropTag)
    }
  });
};

const copyDropTag = (tag: DropTagRow): DropTagPayload => ({
  label: tag.label,
  startedCount: tag.startedCount,
  droppedCount: tag.droppedCount,
  dropRate: tag.dropRate
});

const appendBinge = (
  result: AnalyticsResult,
  chapters: RecapPresentationChapter[],
  omissions: RecapChapterOmission[]
): void => {
  const { available, rows } = result.binge;
  const leader = rows[0];
  if (result.scope.axis !== "watched-at" || !available || !leader) {
    omit(omissions, "binge", "no-binge-completions", "這段期間沒有可呈現的單季補番紀錄。");
    return;
  }
  chapters.push({
    id: "binge",
    kind: "binge",
    title: `補番速度最快的是《${truncateText(leader.title, STORY_TITLE_LIMIT)}》`,
    eyebrow: "補番紀錄",
    narrative: `這段期間補完了 ${formatInteger(rows.length)} 部。`,
    evidence: [
      textEvidence("統計方式", `依每部作品的平均每天集數排序，以補完日期歸入本期。日均集數＝該部集數 ÷ 含首尾的日期跨度，包含中間未觀看的日子，採${result.scope.dayBoundaryMode === "thirty-hour" ? "早上 06:00" : "午夜 00:00"}換日。`),
      countEvidence("本期補完", rows.length, "anime"),
      ...rows.slice(0, MAX_RANKED_ROWS).map((row) => textEvidence(
        row.title,
        `平均 ${formatEpisodesPerDay(row.episodesPerDay)}`
      ))
    ],
    payload: {
      completedCount: rows.length,
      rows: rows.slice(0, MAX_RANKED_ROWS).map((row) => ({
        rank: row.rank,
        animeSn: row.animeSn,
        title: row.title,
        coverUrl: row.coverUrl,
        episodesPerDay: row.episodesPerDay
      }))
    }
  });
};

const appendPlatformTaste = (
  result: AnalyticsResult,
  chapters: RecapPresentationChapter[],
  omissions: RecapChapterOmission[]
): void => {
  const gems = result.favorites.hiddenGems.map((gem): HiddenGemPayload => ({
    ...gem,
    cohortLabel: `${gem.cohortYear} ${SEASON_LABEL[gem.cohortSeason]}`
  }));
  const gem = gems[0];
  if (!gem) {
    omit(omissions, "platform-taste", "no-hidden-gem", "這段期間沒有你特別偏心、同季又比較少人看的作品。");
    return;
  }
  chapters.push({
    id: "platform-taste",
    kind: "platform-taste",
    title: `《${truncateText(gem.title, STORY_TITLE_LIMIT)}》是你的私藏`,
    eyebrow: "你的私藏",
    narrative: `有得選時你常常先點開它；但 ${gem.cohortLabel}開播、你也看過的 ${formatInteger(gem.cohortSize)} 部作品裡，它的人氣只排第 ${formatInteger(gem.popularityRank)}。`,
    evidence: [
      textEvidence("怎麼選出來", "從有得選時最先看的作品裡，挑出已經播完、人氣排在同季開播作品後三分之一的作品。人氣是動畫瘋目前的累積人氣，只和同一季開播、你在這段期間也看過的作品比。"),
      ...gems.map((row) => textEvidence(
        row.title,
        `${row.cohortLabel}的 ${formatInteger(row.cohortSize)} 部裡人氣第 ${formatInteger(row.popularityRank)}・約《${truncateText(row.cohortLeaderTitle, STORY_TITLE_LIMIT)}》的 ${formatPercent(row.popularityRatio)}`
      ))
    ],
    payload: { gems }
  });
};

const SEASON_LABEL: Readonly<Record<CalendarSeason, string>> = Object.freeze({
  winter: "冬季",
  spring: "春季",
  summer: "夏季",
  autumn: "秋季"
});

const copyCompletionRow = (row: CompletionRow): CompletionPayloadRow => ({
  animeSn: row.animeSn,
  title: row.title,
  coverUrl: row.coverUrl,
  watchedEpisodeCount: row.watchedEpisodeCount,
  totalEpisode: row.totalEpisode,
  ratio: row.ratio,
  isOngoing: row.isOngoing
});

const appendRuntime = (
  result: AnalyticsResult,
  chapters: RecapPresentationChapter[],
  omissions: RecapChapterOmission[]
): void => {
  if (
    !result.runtime.available
    || result.summary.knownContentMinutes <= 0
    || result.runtime.rows.length === 0
  ) {
    omit(
      omissions,
      "runtime",
      "insufficient-duration-coverage",
      "目前沒有可用的片長資料。"
    );
    return;
  }
  const rows = result.runtime.rows.slice(0, MAX_RANKED_ROWS).map(copyRuntimeRow);
  const longest = result.runtime.longestEpisode;
  const longestPayload = longest
    ? {
        videoSn: longest.videoSn,
        animeSn: longest.animeSn,
        title: longest.title,
        episode: longest.episode,
        coverUrl: longest.coverUrl,
        durationMinutes: longest.durationMinutes,
        watchedAtIso: longest.watchedAt.toISOString()
      }
    : null;
  const leader = rows[0];
  if (!leader) return;
  chapters.push({
    id: "runtime",
    kind: "runtime",
    title: `陪你最久的是《${truncateText(leader.title, STORY_TITLE_LIMIT)}》`,
    eyebrow: "陪你最久的作品",
    narrative: `${formatMinutes(leader.contentMinutes)}；這段期間的觀看時間合計 ${formatMinutes(result.summary.knownContentMinutes)}。`,
    evidence: [
      ratioEvidence(
        "片長資料涵蓋",
        result.summary.durationCoverage.numerator,
        result.summary.durationCoverage.denominator,
        result.summary.durationCoverage.ratio
      ),
      minutesEvidence("觀看時間合計", result.summary.knownContentMinutes),
      ...rows.slice(0, 3).map((row) => minutesEvidence(row.title, row.contentMinutes)),
      ...(longestPayload
        ? [minutesEvidence(`最長單集：${longestPayload.title} ${longestPayload.episode}`, longestPayload.durationMinutes)]
        : [])
    ],
    payload: {
      totalContentMinutes: result.summary.knownContentMinutes,
      rows,
      longestEpisode: longestPayload
    }
  });
};

const appendTimeliness = (
  result: AnalyticsResult,
  chapters: RecapPresentationChapter[],
  omissions: RecapChapterOmission[]
): void => {
  if (
    !result.timeliness.available
    || result.timeliness.rows.length === 0
    || result.summary.medianLagMinutes === null
    || result.summary.within24HoursCount === null
    || result.summary.within24HoursRate === null
  ) {
    omit(omissions, "timeliness", "insufficient-timeliness", "目前可比較的上架至觀看紀錄還不足以整理追番速度。");
    return;
  }
  const rows = result.timeliness.rows.slice(0, MAX_RANKED_ROWS).map(copyTimelinessRow);
  const leader = rows[0];
  if (!leader) return;
  chapters.push({
    id: "timeliness",
    kind: "timeliness",
    title: `你追得最快的是《${truncateText(leader.title, STORY_TITLE_LIMIT)}》`,
    eyebrow: "上架後多久會看",
    narrative: `通常等 ${formatMinutes(leader.medianLagMinutes)}。`,
    evidence: [
      ratioEvidence(
        "可計算上架時間",
        result.summary.releaseCoverage.numerator,
        result.summary.releaseCoverage.denominator,
        result.summary.releaseCoverage.ratio
      ),
      minutesEvidence("整體典型等待", result.summary.medianLagMinutes),
      ratioEvidence(
        "24 小時內觀看",
        result.summary.within24HoursCount,
        result.summary.releaseCoverage.numerator,
        result.summary.within24HoursRate
      ),
      ...rows.slice(0, 3).map((row) => minutesEvidence(row.title, row.medianLagMinutes))
    ],
    payload: {
      overallMedianLagMinutes: result.summary.medianLagMinutes,
      overallWithin24HoursCount: result.summary.within24HoursCount,
      overallWithin24HoursRate: result.summary.within24HoursRate,
      rows
    }
  });
};

const appendPreference = (
  result: AnalyticsResult,
  chapters: RecapPresentationChapter[],
  omissions: RecapChapterOmission[]
): void => {
  if (
    !result.preference.available
    || result.preference.choiceEventCount <= 0
    || result.preference.rows.length < 2
  ) {
    omit(
      omissions,
      "behavior-preference",
      "insufficient-preference",
      "好幾部作品同時有新集數在等你的時候還不夠多，看不出你偏心哪一部。"
    );
    return;
  }
  const rows = result.preference.rows.slice(0, MAX_RANKED_ROWS).map(copyPreferenceRow);
  const leader = rows[0];
  if (!leader) return;
  const seasons = result.favorites.seasons.map((season): SeasonFavoritesPayload => ({
    year: season.year,
    season: season.season,
    label: SEASON_LABEL[season.season],
    rows: season.rows.map(copyPreferenceRow)
  }));
  const pickedSeasons = seasons.filter((season) => season.rows.length > 0);
  chapters.push({
    id: "behavior-preference",
    kind: "behavior-preference",
    title: pickedSeasons.length >= 2
      ? "每一季，你最先點開的作品"
      : `有得選時，你最常先看《${truncateText(leader.title, STORY_TITLE_LIMIT)}》`,
    eyebrow: "你的選擇",
    narrative: pickedSeasons.length >= 2
      ? `好幾部作品同時有新集數在等你時，你常常先點開這幾部；整段期間最偏心的是《${truncateText(leader.title, STORY_TITLE_LIMIT)}》。`
      : `好幾部作品同時有新集數在等你時，${formatPercent(leader.rawWinRate)} 的時候你先點開它。`,
    evidence: [
      textEvidence("比較方式", "只比較你已經開始追、當時都有新集數可看的作品。"),
      ratioEvidence(
        "看得出有得選的觀看",
        result.preference.coverage.numerator,
        result.preference.coverage.denominator,
        result.preference.coverage.ratio
      ),
      countEvidence("有得選的時刻", result.preference.choiceEventCount, "choice"),
      ...rows.slice(0, 3).map((row) => ratioEvidence(
        row.title,
        row.wins,
        row.comparisons,
        row.rawWinRate
      )),
      ...pickedSeasons.map((season) => textEvidence(
        `${season.year} ${season.label}`,
        season.rows.map((row) => `《${truncateText(row.title, STORY_TITLE_LIMIT)}》`).join("、")
      ))
    ],
    payload: {
      choiceEventCount: result.preference.choiceEventCount,
      rows,
      seasons
    }
  });
};

const appendTaste = (
  result: AnalyticsResult,
  chapters: RecapPresentationChapter[],
  omissions: RecapChapterOmission[]
): void => {
  const tags = result.catalog.tags.slice(0, MAX_RANKED_ROWS).map(copyDimensionRow);
  const makers = result.catalog.makers.slice(0, MAX_RANKED_ROWS).map(copyDimensionRow);
  const directors = result.catalog.directors.slice(0, MAX_RANKED_ROWS).map(copyDimensionRow);
  const publishers = result.catalog.publishers.slice(0, MAX_RANKED_ROWS).map(copyDimensionRow);
  const leader = tags[0] ?? makers[0] ?? directors[0] ?? publishers[0];
  if (!leader) {
    omit(omissions, "taste", "no-taste-dimensions", "目前作品資料尚未提供可用的類型或製作資訊。");
    return;
  }
  const leaderKind = tags[0]
    ? "類型"
    : makers[0]
      ? "製作方"
      : directors[0]
        ? "導演"
        : "代理商";
  chapters.push({
    id: "taste",
    kind: "taste",
    title: `「${truncateText(leader.label, 16)}」最常出現在你的片單`,
    eyebrow: `最常看的${leaderKind}`,
    narrative: `你看的 ${formatInteger(result.catalog.animeCoverage.numerator)} 部作品裡，有 ${formatInteger(leader.animeCount)} 部。`,
    evidence: [
      ratioEvidence(
        "作品資料涵蓋",
        result.catalog.animeCoverage.numerator,
        result.catalog.animeCoverage.denominator,
        result.catalog.animeCoverage.ratio
      ),
      textEvidence("排名方式", "依作品數排名，同數時再比看過的集數；一部作品可以同時屬於好幾個類型。"),
      ...tags.slice(0, 3).map((row) => countEvidence(`類型：${row.label}`, row.animeCount, "anime")),
      ...makers.slice(0, 3).map((row) => countEvidence(`動畫公司：${row.label}`, row.animeCount, "anime")),
      ...directors.slice(0, 3).map((row) => countEvidence(`導演：${row.label}`, row.animeCount, "anime")),
      ...publishers.slice(0, 3).map((row) => countEvidence(`代理商：${row.label}`, row.animeCount, "anime"))
    ],
    payload: {
      tags,
      makers,
      directors,
      publishers
    }
  });
};

const normalizedAnnualSeasonRows = (
  source: readonly SeasonBreakdownRow[],
  year: number
): readonly SeasonBreakdownPayloadRow[] | null => {
  const rows = source.filter((row) => row.year === year);
  if (rows.length !== SEASON_ORDER.length) return null;
  const bySeason = new Map(rows.map((row) => [row.season, row]));
  if (bySeason.size !== SEASON_ORDER.length) return null;
  return SEASON_ORDER.map((season) => {
    const row = bySeason.get(season);
    if (!row) throw new Error("季度正規化遺失已驗證季度");
    return {
      year: row.year,
      season: row.season,
      label: row.label,
      watchCount: row.watchCount,
      animeCount: row.animeCount,
      contentMinutes: row.contentMinutes
    };
  });
};

const copyRuntimeRow = (row: SeriesRuntimeRow): RuntimeSeriesPayload => ({
  rank: row.rank,
  animeSn: row.animeSn,
  title: row.title,
  coverUrl: row.coverUrl,
  watchCount: row.watchCount,
  contentMinutes: row.contentMinutes
});

const copyTimelinessRow = (row: TimelinessRow): TimelinessAnimePayload => ({ ...row });
const copyPreferenceRow = (row: PreferenceRow): PreferenceAnimePayload => ({ ...row });
const copyDimensionRow = (row: DimensionRow): TasteDimensionPayload => ({
  rank: row.rank,
  label: row.label,
  animeCount: row.animeCount,
  watchCount: row.watchCount,
  knownContentMinutes: row.contentMinutes
});

const countEvidence = (
  label: string,
  value: number,
  unit: Extract<RecapEvidenceRow, { readonly kind: "count" }>["unit"]
): RecapEvidenceRow => ({ kind: "count", label, value, unit });

const minutesEvidence = (label: string, minutes: number): RecapEvidenceRow => ({
  kind: "minutes",
  label,
  minutes
});

const ratioEvidence = (
  label: string,
  numerator: number,
  denominator: number,
  ratio: number | null
): RecapEvidenceRow => ({ kind: "ratio", label, numerator, denominator, ratio });

const textEvidence = (label: string, value: string): RecapEvidenceRow => ({
  kind: "text",
  label,
  value
});

const copyPeriod = (period: PeriodDefinition): PeriodDefinition => ({ ...period });

const omit = (
  omissions: RecapChapterOmission[],
  chapter: RecapChapterKind,
  reason: RecapOmissionReason,
  message: string
): void => {
  omissions.push({ chapter, reason, message });
};

const formatMinutes = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${formatInteger(minutes)} 分鐘`;
  if (remainder === 0) return `${formatInteger(hours)} 小時`;
  return `${formatInteger(hours)} 小時 ${formatInteger(remainder)} 分鐘`;
};

const formatChineseList = (items: readonly string[]): string => {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  if (items.length === 2) return joinWithSpacing(items[0] ?? "", "與", items[1] ?? "");
  return joinWithSpacing(items.slice(0, -1).join("、"), "與", items.at(-1) ?? "");
};

const ASCII_WORD_EDGE = /[0-9A-Za-z]/;
const CJK_EDGE = /[\u3400-\u9fff\uf900-\ufaff]/;

/**
 * 串接文案片段；只在「中文字」與「英數」相鄰的接縫補一個半形空白，
 * 例如「你最常看」+「2025 夏季」→「你最常看 2025 夏季」。標點旁不補。
 */
export const joinWithSpacing = (...segments: readonly string[]): string => segments
  .filter((segment) => segment.length > 0)
  .reduce((joined, segment) => {
    if (joined.length === 0) return segment;
    const left = joined.at(-1) ?? "";
    const right = segment[0] ?? "";
    const needsSpace = (ASCII_WORD_EDGE.test(left) && CJK_EDGE.test(right))
      || (CJK_EDGE.test(left) && ASCII_WORD_EDGE.test(right));
    return needsSpace ? `${joined} ${segment}` : `${joined}${segment}`;
  }, "");

const seasonIndex = (season: CalendarSeason): number => SEASON_ORDER.indexOf(season);

const assertConsistentResult = (result: AnalyticsResult): void => {
  if (result.period.key.trim() === "") {
    throw new TypeError("recap analytics period key 不可為空");
  }
  if (
    result.period.key !== analysisScopeKey(result.scope)
    || result.period.key !== analysisScopeKey(result.period.scope)
  ) {
    throw new TypeError("recap analytics scope 與 resolved period 不一致");
  }
  for (const date of [
    result.period.effectiveRange.startInclusive,
    result.period.effectiveRange.endExclusive
  ]) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
      throw new TypeError("recap analytics period 必須包含有效日期");
    }
  }
};

const stableStringify = (value: unknown): string => {
  const seen = new Set<object>();
  const encode = (candidate: unknown): string => {
    if (candidate === null) return "null";
    if (typeof candidate === "string" || typeof candidate === "boolean") return JSON.stringify(candidate);
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) throw new TypeError("recap fingerprint 不接受非有限數字");
      return Object.is(candidate, -0) ? "-0" : String(candidate);
    }
    if (candidate instanceof Date) {
      if (!Number.isFinite(candidate.getTime())) throw new TypeError("recap fingerprint 不接受無效日期");
      return `{"$date":${JSON.stringify(candidate.toISOString())}}`;
    }
    if (Array.isArray(candidate)) {
      return `[${candidate.map(encode).join(",")}]`;
    }
    if (typeof candidate !== "object") {
      throw new TypeError(`recap fingerprint 不接受 ${typeof candidate}`);
    }
    if (seen.has(candidate)) throw new TypeError("recap fingerprint 不接受循環資料");
    seen.add(candidate);
    const record = candidate as Record<string, unknown>;
    const encoded = Object.keys(record).sort().map((key) => {
      const item = record[key];
      if (item === undefined) throw new TypeError(`recap fingerprint 欄位 ${key} 不可為 undefined`);
      return `${JSON.stringify(key)}:${encode(item)}`;
    }).join(",");
    seen.delete(candidate);
    return `{${encoded}}`;
  };
  return encode(value);
};

const sha256 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15] ?? 0;
      const right = words[index - 2] ?? 0;
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0;
    }

    let a = hash[0] ?? 0;
    let b = hash[1] ?? 0;
    let c = hash[2] ?? 0;
    let d = hash[3] ?? 0;
    let e = hash[4] ?? 0;
    let f = hash[5] ?? 0;
    let g = hash[6] ?? 0;
    let h = hash[7] ?? 0;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choose + (SHA256_CONSTANTS[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = ((hash[0] ?? 0) + a) >>> 0;
    hash[1] = ((hash[1] ?? 0) + b) >>> 0;
    hash[2] = ((hash[2] ?? 0) + c) >>> 0;
    hash[3] = ((hash[3] ?? 0) + d) >>> 0;
    hash[4] = ((hash[4] ?? 0) + e) >>> 0;
    hash[5] = ((hash[5] ?? 0) + f) >>> 0;
    hash[6] = ((hash[6] ?? 0) + g) >>> 0;
    hash[7] = ((hash[7] ?? 0) + h) >>> 0;
  }
  return [...hash].map((word) => word.toString(16).padStart(8, "0")).join("");
};

const rotateRight = (value: number, amount: number): number =>
  (value >>> amount) | (value << (32 - amount));

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};
