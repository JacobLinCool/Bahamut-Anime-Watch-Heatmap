import {
  buildAnalysisDataset,
  factInScope,
  type AnalysisDataset,
  type WatchFact
} from "./analysis-dataset";
import type {
  AnimeMetadata,
  EpisodeMetadata,
  WatchEntry
} from "./model";
import {
  CALENDAR_SEASONS,
  classifyReleaseAtTaipei,
  resolvePeriod,
  type AnalysisScope,
  type CalendarSeason,
  type ResolvedPeriod
} from "./period";
import { addTaipeiCalendarDays, taipeiStartOfDate, taipeiWeekday, toTaipeiDateKey } from "./time";
import { buildBingeRows, singleSeasonReferences, type BingeRow } from "./binge";
export type { BingeRow } from "./binge";

const MIN_METADATA_COVERAGE = 0.9;
const MIN_EXACT_COVERAGE = 1;
const MIN_SUMMARY_RELEASE_SAMPLES = 1;
const MIN_TIMELINESS_SAMPLES = 1;
const MIN_PREFERENCE_COMPARISONS = 1;
const MIN_PREFERENCE_OPPONENTS = 1;
const MIN_PREFERENCE_DECISIONS = 1;
const SHORT_BINGE_GAP_MINUTES = 60;
const MINUTES_PER_DAY = 24 * 60;
const Z_95 = 1.959963984540054;
const SCORE_TIE_EPSILON = 1e-12;

export type HistoryCoverage = {
  readonly coveredFrom: Date;
  readonly coveredThrough: Date;
  readonly complete: boolean;
};

export type CoverageResult = {
  readonly numerator: number;
  readonly denominator: number;
  readonly ratio: number | null;
  readonly passed: boolean;
};

export type RhythmPoint = {
  readonly label: string;
  readonly count: number;
  readonly contentMinutes: number | null;
};

/** 期間內的一天：日期依分析軸與換日方式，沒看的日子 count 為 0。 */
export type DailyCount = {
  readonly dateKey: string;
  readonly count: number;
};

export type WatchSummary = {
  readonly watchCount: number;
  readonly uniqueEpisodeCount: number;
  readonly animeCount: number;
  readonly activeDayCount: number;
  readonly knownContentMinutes: number;
  readonly contentMinutes: number | null;
  readonly durationCoverage: CoverageResult;
  readonly releaseCoverage: CoverageResult;
  readonly medianLagMinutes: number | null;
  readonly within24HoursCount: number | null;
  readonly within24HoursRate: number | null;
  readonly negativeLagCount: number;
  readonly unclassifiedCount: number;
  readonly scheduleBoundaryIssueCount: number;
};

export type TimelinessRow = {
  readonly rank: number;
  readonly animeSn: number;
  readonly title: string;
  readonly coverUrl: string | null;
  readonly sampleCount: number;
  readonly medianLagMinutes: number;
  readonly within24HoursCount: number;
  readonly within24HoursRate: number;
};

export type PreferenceRow = {
  readonly rank: number;
  readonly animeSn: number;
  readonly title: string;
  readonly coverUrl: string | null;
  readonly wins: number;
  readonly losses: number;
  readonly comparisons: number;
  readonly rawWinRate: number;
  readonly wilsonLower95: number;
  readonly distinctOpponentCount: number;
  readonly decisionBucketCount: number;
};

/** 一季裡有得選時最先看的幾部作品（依偏好排序）；這季還看不出來時 rows 為空。 */
export type SeasonalFavorites = {
  readonly year: number;
  readonly season: CalendarSeason;
  readonly choiceEventCount: number;
  readonly rows: readonly PreferenceRow[];
};

/**
 * 你特別偏心、但同季開播的作品裡人氣落在後段的作品。人氣是動畫瘋目前的累積人氣，
 * 新番天生偏低、老番偏高，所以只和同一季開播、你在這段期間也看過的作品比。
 */
export type HiddenGemRow = {
  readonly animeSn: number;
  readonly title: string;
  readonly coverUrl: string | null;
  readonly cohortYear: number;
  readonly cohortSeason: CalendarSeason;
  /** 同季開播、你在這段期間也看過的作品數（含它自己）。 */
  readonly cohortSize: number;
  /** 在同季作品裡的人氣名次，1 為最熱門。 */
  readonly popularityRank: number;
  readonly cohortLeaderTitle: string;
  /** 它的人氣 ÷ 同季最熱門作品的人氣。 */
  readonly popularityRatio: number;
};

/** 一個觀看瞬間：哪部作品的哪一集，在什麼時候。 */
export type WatchMoment = {
  readonly animeSn: number | null;
  readonly title: string;
  readonly episode: string;
  readonly coverUrl: string | null;
  readonly watchedAt: Date;
};

/**
 * 只對某些人成立的亮點：每一則都有自己的條件，不成立就是 null，不硬湊。
 * 只在依觀看時間分析時計算；依上架時間時全部為 null。
 */
export type Highlights = {
  /** 年度期間：跨進這一年的那一晚（前一年 12/31 22:00 到 1/1 03:00）有在看動畫。 */
  readonly newYearsEve: {
    readonly year: number;
    /** 午夜前最後一集。 */
    readonly before: WatchMoment | null;
    /** 午夜後第一集。 */
    readonly after: WatchMoment | null;
  } | null;
  /** 從凌晨三點前一路看到早上六點以後的一晚（每集間隔不超過一小時）；有好幾晚時取結束得最晚的。 */
  readonly dawn: {
    readonly startedAt: Date;
    readonly endedAt: Date;
    readonly episodeCount: number;
    readonly last: WatchMoment;
  } | null;
  /** 開播兩年以上才看的作品；一部也沒有時為 null。 */
  readonly oldWorks: {
    readonly workCount: number;
    readonly episodeCount: number;
    /** 能判斷開播日的觀看集數，舊作比例的分母。 */
    readonly datedEpisodeCount: number;
    readonly oldest: {
      readonly animeSn: number;
      readonly title: string;
      readonly coverUrl: string | null;
      readonly premiereYear: number;
    };
  } | null;
};

export type SeriesRuntimeRow = {
  readonly rank: number;
  readonly animeSn: number;
  readonly title: string;
  readonly coverUrl: string | null;
  readonly watchCount: number;
  readonly contentMinutes: number;
};

export type LongestEpisode = {
  readonly videoSn: number;
  readonly animeSn: number;
  readonly title: string;
  readonly episode: string;
  readonly coverUrl: string | null;
  readonly durationMinutes: number;
  readonly watchedAt: Date;
};

export type DimensionRow = {
  readonly rank: number;
  readonly label: string;
  readonly animeCount: number;
  readonly watchCount: number;
  readonly contentMinutes: number;
};

export type CurrentPlatformSnapshotComparisonRow = {
  readonly animeSn: number;
  readonly title: string;
  readonly coverUrl: string | null;
  readonly personalWatchRank: number;
  readonly personalWatchCount: number;
  /** Rank among the covered anime in this comparison, not a platform-wide rank. */
  readonly platformPopularityRankWithinCoveredAnime: number;
  readonly platformPopular: number;
  readonly platformSnapshotObservedAt: Date;
};

export type ObservedWatchedEpisodeReleaseSeason = {
  readonly year: number;
  readonly season: CalendarSeason;
  readonly label: string;
  readonly knownReleaseEpisodeCount: number;
};

export type ObservedWatchedEpisodeReleaseFootprintRow = {
  readonly animeSn: number;
  readonly title: string;
  readonly coverUrl: string | null;
  readonly observationBasis: "selected-watched-episodes-only";
  readonly representsCompleteAiringStructure: false;
  readonly identifiedWatchedEpisodeCount: number;
  readonly knownReleaseEpisodeCount: number;
  readonly releaseCoverage: CoverageResult;
  readonly observedReleaseSeasons: readonly ObservedWatchedEpisodeReleaseSeason[];
};

export type CompletionRow = {
  readonly animeSn: number;
  readonly title: string;
  readonly coverUrl: string | null;
  /** Unique indexed episodes observed inside the available one-year history. */
  readonly watchedEpisodeCount: number;
  readonly totalEpisode: number;
  /** History-window coverage, not proof of the user's lifetime completion state. */
  readonly ratio: number;
  /** Still airing when fetched: totalEpisode counts aired episodes only, so a full ratio means caught up. */
  readonly isOngoing: boolean;
  /**
   * 追番結果。已完結的作品只有在紀錄裡看得到第 1 集時才分看完以外的類別：
   * 開頭不在紀錄裡（例如在紀錄保留期之前就開始看）的作品，說不出是放棄還是早就看過。
   */
  readonly outcome: CompletionOutcome;
};

export type CompletionOutcome =
  /** 已完結，每一集都看了。 */
  | "finished"
  /** 已完結，只差最後一兩集，而且看了一半以上。 */
  | "nearly"
  /** 已完結，看了一半以上，但還差三集以上。 */
  | "midway"
  /** 已完結，看不到一半就停了。 */
  | "dropped"
  /** 已完結，但第 1 集不在紀錄裡。 */
  | "unknown-start"
  /** 還在播，看到最新一集。 */
  | "caught-up"
  /** 還在播，還沒追到最新一集。 */
  | "behind";

/** 某個類型裡，從第 1 集開始看、已完結的作品有幾部被放棄。 */
export type DropTagRow = {
  readonly label: string;
  readonly startedCount: number;
  readonly droppedCount: number;
  readonly dropRate: number;
};

export type SeasonBreakdownRow = {
  readonly year: number;
  readonly season: CalendarSeason;
  readonly label: string;
  readonly watchCount: number;
  readonly animeCount: number;
  readonly knownContentMinutes: number;
  readonly contentMinutes: number | null;
  readonly durationCoverage: CoverageResult;
};

export type ClockSegment = {
  readonly key: "morning" | "daytime" | "evening" | "late-night";
  readonly label: string;
  /** Taipei-local hour range [startHour, endHour); late-night wraps midnight. */
  readonly startHour: number;
  readonly endHour: number;
  readonly watchCount: number;
  readonly share: number;
};

/** When the user actually presses play: Taipei-local hour and weekday distributions. */
export type HabitClock = {
  readonly available: boolean;
  readonly hourCounts: readonly number[];
  readonly peakHour: number | null;
  readonly peakHourCount: number;
  readonly segments: readonly ClockSegment[];
  readonly topSegment: ClockSegment | null;
  readonly weekdayCounts: readonly number[];
  readonly topWeekday: { readonly weekday: number; readonly label: string; readonly watchCount: number } | null;
};

/** Sprint behavior along the user's own watch days (independent of the analysis axis). */
export type Marathon = {
  readonly available: boolean;
  readonly peakDay: {
    readonly dateKey: string;
    readonly watchCount: number;
    readonly knownContentMinutes: number;
  } | null;
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

export type AnalyticsResult = {
  readonly scope: AnalysisScope;
  readonly period: ResolvedPeriod;
  readonly historyComplete: boolean;
  readonly summary: WatchSummary;
  readonly rhythm: readonly RhythmPoint[];
  /** 期間內每一天（含沒看的日子）：結尾海報的熱度圖逐日畫出整段期間。 */
  readonly dailyCounts: readonly DailyCount[];
  readonly seasonBreakdown: readonly SeasonBreakdownRow[];
  readonly runtime: {
    readonly available: boolean;
    readonly coverage: CoverageResult;
    readonly rows: readonly SeriesRuntimeRow[];
    readonly longestEpisode: LongestEpisode | null;
  };
  readonly catalog: {
    readonly animeCoverage: CoverageResult;
    readonly tags: readonly DimensionRow[];
    readonly makers: readonly DimensionRow[];
    readonly directors: readonly DimensionRow[];
    readonly publishers: readonly DimensionRow[];
  };
  readonly currentPlatformSnapshotComparison: {
    readonly label: "目前平台快照";
    readonly temporalBasis: "current-platform-snapshot";
    readonly available: boolean;
    readonly animeMetadataCoverage: CoverageResult;
    readonly rows: readonly CurrentPlatformSnapshotComparisonRow[];
  };
  readonly observedWatchedEpisodeReleaseFootprints: {
    readonly observationBasis: "selected-watched-episodes-only";
    readonly representsCompleteAiringStructure: false;
    readonly rows: readonly ObservedWatchedEpisodeReleaseFootprintRow[];
  };
  readonly completion: {
    readonly available: boolean;
    readonly rows: readonly CompletionRow[];
    /** 開始看的作品夠多的類型，放棄比例高的在前。 */
    readonly dropTags: readonly DropTagRow[];
  };
  readonly binge: {
    readonly available: boolean;
    readonly rows: readonly BingeRow[];
  };
  readonly habitClock: HabitClock;
  readonly marathon: Marathon;
  readonly timeliness: {
    readonly available: boolean;
    readonly coverage: CoverageResult;
    readonly rows: readonly TimelinessRow[];
  };
  readonly preference: {
    readonly available: boolean;
    readonly coverage: CoverageResult;
    readonly choiceEventCount: number;
    readonly rows: readonly PreferenceRow[];
  };
  readonly highlights: Highlights;
  readonly favorites: {
    /** 年度期間：每一季（已開始的）各自的最愛；其他期間為空。 */
    readonly seasons: readonly SeasonalFavorites[];
    /** 最多兩部，最冷門的在前；沒有符合的作品時為空。 */
    readonly hiddenGems: readonly HiddenGemRow[];
  };
};

type ChoiceBucket = {
  readonly minute: number;
  readonly watches: readonly WatchFact[];
};

type StreamIdentity = {
  readonly key: string;
  readonly animeSn: number;
  readonly groupKey: string;
};

type CatalogEpisode = {
  readonly metadata: EpisodeMetadata;
  readonly availableMinute: number;
  readonly unavailableMinute: number | null;
  readonly firstWatchedMinute: number | null;
};

type StartedStreamTimeline = StreamIdentity & {
  readonly firstObservedMinute: number;
  readonly episodes: readonly CatalogEpisode[];
};

type PreferenceCatalog = {
  readonly coverage: CoverageResult;
  readonly timelines: readonly StartedStreamTimeline[];
};

type PreferenceCandidate = {
  readonly animeSn: number;
  /** One anime is one choice, even when several episodes are pending. */
  readonly pendingVideoSns: ReadonlySet<number>;
};

type MutablePreferenceStats = {
  wins: number;
  losses: number;
  readonly opponents: Set<number>;
  readonly decisions: Set<number>;
};

type MutableAggregate = {
  watchCount: number;
  knownContentMinutes: number;
  durationKnownCount: number;
  readonly animeSns: Set<number>;
};

export const analyzeWatchHistory = ({
  entries,
  episodes,
  anime,
  historyCoverage,
  scope,
  asOf
}: {
  readonly entries: readonly WatchEntry[];
  readonly episodes: ReadonlyMap<number, EpisodeMetadata>;
  readonly anime: ReadonlyMap<number, AnimeMetadata>;
  readonly historyCoverage: HistoryCoverage;
  readonly scope: AnalysisScope;
  readonly asOf: Date;
}): AnalyticsResult => {
  assertValidDate(asOf, "asOf");
  const period = resolvePeriod(scope, asOf);
  const dataset = buildAnalysisDataset({ entries, episodes, anime, scope, period, asOf });
  const historyComplete = historyCoversScope(historyCoverage, period, asOf);
  const durationCoverage = eventFieldCoverage(
    dataset.selectedEvents,
    (fact) => validDuration(fact.episode),
    historyComplete,
    MIN_EXACT_COVERAGE
  );
  const releaseCoverage = scope.axis === "released-at"
    ? factFieldCoverage(dataset.canonical, (fact) => fact.releaseValid, historyComplete, MIN_METADATA_COVERAGE)
    : factFieldCoverage(dataset.selectedCanonical, (fact) => fact.releaseValid, historyComplete, MIN_METADATA_COVERAGE);
  const validReleaseWatches = dataset.selectedCanonical.filter((fact) => fact.releaseValid);
  const releaseLags = validReleaseWatches.map(releaseLagMinutes);
  const summaryReleaseAvailable = validReleaseWatches.length >= MIN_SUMMARY_RELEASE_SAMPLES;
  const within24HoursCount = releaseLags.filter((lag) => lag <= MINUTES_PER_DAY).length;
  const knownContentMinutes = dataset.selectedEvents.reduce(
    (total, fact) => total + (validDuration(fact.episode) ? fact.episode.durationMinutes : 0),
    0
  );
  const runtime = buildRuntime(dataset, durationCoverage);
  const catalog = buildCatalog(dataset, historyComplete);
  const currentPlatformSnapshotComparison = buildCurrentPlatformSnapshotComparison(
    dataset,
    historyComplete
  );
  const observedWatchedEpisodeReleaseFootprints = buildObservedWatchedEpisodeReleaseFootprints(
    dataset,
    historyComplete
  );
  const completionRows = buildCompletionRows(dataset);
  const bingeRows = buildBingeRows(dataset);
  const timelinessRows = buildTimelinessRows(validReleaseWatches, dataset);
  const preference = buildPreferenceResult({
    dataset,
    historyCoverage,
    asOf,
    historyComplete
  });
  const seasonalFavorites = buildSeasonalFavorites({ entries, episodes, anime, historyCoverage, scope, asOf });
  const favoriteRows = seasonalFavorites.length > 0
    ? seasonalFavorites.flatMap((season) => season.rows)
    : favoritePicks(preference.rows);

  return {
    scope,
    period,
    historyComplete,
    summary: {
      watchCount: dataset.selectedEvents.length,
      uniqueEpisodeCount: new Set(dataset.selectedEvents.map((fact) => fact.entry.videoSn)).size,
      animeCount: new Set(dataset.selectedEvents.flatMap((fact) => fact.animeSn === null ? [] : [fact.animeSn])).size,
      activeDayCount: new Set(dataset.selectedEvents.map((fact) => axisDateKey(fact, dataset.scope))).size,
      knownContentMinutes,
      contentMinutes: durationCoverage.passed ? knownContentMinutes : null,
      durationCoverage,
      releaseCoverage,
      medianLagMinutes: summaryReleaseAvailable ? median(releaseLags) : null,
      within24HoursCount: summaryReleaseAvailable ? within24HoursCount : null,
      within24HoursRate: summaryReleaseAvailable ? within24HoursCount / releaseLags.length : null,
      negativeLagCount: (scope.axis === "released-at" ? dataset.canonical : dataset.selectedCanonical)
        .filter((fact) => fact.negativeLag).length,
      unclassifiedCount: dataset.unclassified.length,
      scheduleBoundaryIssueCount: dataset.selectedCanonical.filter(scheduleBoundaryMismatch).length
    },
    rhythm: buildRhythm(dataset),
    dailyCounts: buildDailyCounts(dataset),
    seasonBreakdown: buildSeasonBreakdown(dataset, historyComplete),
    runtime,
    catalog,
    currentPlatformSnapshotComparison,
    observedWatchedEpisodeReleaseFootprints,
    completion: {
      available: completionRows.length > 0,
      rows: completionRows,
      dropTags: buildDropTags(dataset, completionRows)
    },
    binge: { available: bingeRows.length > 0, rows: bingeRows },
    habitClock: buildHabitClock(dataset),
    marathon: buildMarathon(dataset),
    timeliness: {
      available: timelinessRows.length > 0,
      coverage: releaseCoverage,
      rows: timelinessRows
    },
    preference,
    highlights: buildHighlights(dataset, historyCoverage),
    favorites: {
      seasons: seasonalFavorites,
      hiddenGems: buildHiddenGems(dataset, favoriteRows)
    }
  };
};

/** 每集間隔超過這麼久，就算是另一次坐下來看。 */
const SESSION_GAP_MINUTES = 60;
/** 天亮了還在看：從這個時刻之前開始。 */
const DAWN_STARTED_BY_HOUR = 3;
/** 天亮了還在看：在這個區間結束。 */
const DAWN_ENDS_FROM_HOUR = 6;
const DAWN_ENDS_BEFORE_HOUR = 10;
/** 跨年夜：午夜前後的這段時間。 */
const NEW_YEARS_EVE_BEFORE_MINUTES = 2 * 60;
const NEW_YEARS_EVE_AFTER_MINUTES = 3 * 60;
/** 開播滿這麼多天才看，算舊作。 */
const OLD_WORK_DAYS = 730;
/** 一部作品的集數在這麼多天內一起上架，視為舊作整批上架，而不是正在播的新一季。 */
const BATCH_UPLOAD_DAYS = 30;
const MINUTES_PER_HOUR = 60;
const TAIPEI_OFFSET_MINUTES = 8 * MINUTES_PER_HOUR;

const NO_HIGHLIGHTS: Highlights = { newYearsEve: null, dawn: null, oldWorks: null };

const buildHighlights = (dataset: AnalysisDataset, historyCoverage: HistoryCoverage): Highlights =>
  dataset.scope.axis === "watched-at"
    ? {
        newYearsEve: buildNewYearsEve(dataset, historyCoverage),
        dawn: buildDawn(dataset),
        oldWorks: buildOldWorks(dataset)
      }
    : NO_HIGHLIGHTS;

const watchMoment = (fact: WatchFact, dataset: AnalysisDataset): WatchMoment => ({
  animeSn: fact.animeSn,
  title: (fact.animeSn !== null ? dataset.titleByAnimeSn.get(fact.animeSn) : undefined) ?? fact.entry.title,
  episode: fact.entry.episode,
  coverUrl: fact.anime?.coverUrl ?? null,
  watchedAt: new Date(fact.entry.watchedAt.getTime())
});

/** 台北時間的「一天中的第幾分鐘」。 */
const taipeiMinuteOfDay = (minute: number): number =>
  (((minute + TAIPEI_OFFSET_MINUTES) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

/**
 * 跨進這一年的那一晚屬於這一年的故事：30 小時制下它在統計上算前一年的最後一天，
 * 但「看著動畫跨年」說的是這一年怎麼開始，所以從整段紀錄裡找，不受期間邊界影響。
 */
const buildNewYearsEve = (dataset: AnalysisDataset, historyCoverage: HistoryCoverage): Highlights["newYearsEve"] => {
  if (dataset.scope.period.kind !== "calendar-year") return null;
  const year = dataset.scope.period.year;
  const midnightMinute = toEpochMinute(taipeiStartOfDate(`${String(year).padStart(4, "0")}-01-01`));
  const fromMinute = midnightMinute - NEW_YEARS_EVE_BEFORE_MINUTES;
  // 那一晚不在紀錄裡就不說：沒看到不代表沒在看。
  if (!validDate(historyCoverage.coveredFrom) || toEpochMinute(historyCoverage.coveredFrom) > fromMinute) return null;
  const night = dataset.events.filter((fact) =>
    fact.watchedMinute >= fromMinute && fact.watchedMinute < midnightMinute + NEW_YEARS_EVE_AFTER_MINUTES);
  if (night.length === 0) return null;
  const before = night.filter((fact) => fact.watchedMinute < midnightMinute).at(-1);
  const after = night.find((fact) => fact.watchedMinute >= midnightMinute);
  return {
    year,
    before: before ? watchMoment(before, dataset) : null,
    after: after ? watchMoment(after, dataset) : null
  };
};

const buildDawn = (dataset: AnalysisDataset): Highlights["dawn"] => {
  const facts = [...dataset.selectedEvents].sort((left, right) => left.watchedMinute - right.watchedMinute);
  let best: { readonly session: readonly WatchFact[]; readonly endClock: number } | null = null;
  let session: WatchFact[] = [];
  const consider = (): void => {
    const first = session[0];
    const last = session.at(-1);
    if (!first || !last) return;
    const endClock = taipeiMinuteOfDay(last.watchedMinute);
    if (endClock < DAWN_ENDS_FROM_HOUR * MINUTES_PER_HOUR || endClock >= DAWN_ENDS_BEFORE_HOUR * MINUTES_PER_HOUR) return;
    // 同一個早上的三點：開始得比它早，才算一路看到天亮，而不是早起才看。
    const morningThree = last.watchedMinute - endClock + DAWN_STARTED_BY_HOUR * MINUTES_PER_HOUR;
    if (first.watchedMinute > morningThree) return;
    if (!best || endClock > best.endClock || (endClock === best.endClock && session.length > best.session.length)) {
      best = { session: [...session], endClock };
    }
  };
  for (const fact of facts) {
    const previous = session.at(-1);
    if (previous && fact.watchedMinute - previous.watchedMinute > SESSION_GAP_MINUTES) {
      consider();
      session = [];
    }
    session.push(fact);
  }
  consider();
  const picked = best as { readonly session: readonly WatchFact[]; readonly endClock: number } | null;
  if (!picked) return null;
  const first = picked.session[0]!;
  const last = picked.session.at(-1)!;
  return {
    startedAt: new Date(first.entry.watchedAt.getTime()),
    endedAt: new Date(last.entry.watchedAt.getTime()),
    episodeCount: picked.session.length,
    last: watchMoment(last, dataset)
  };
};

const daysBetweenKeys = (fromKey: string, toKey: string): number =>
  Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);

/**
 * 舊作：開播滿兩年才看。同一個作品編號底下可能有好幾季，開播日停在第一季，所以還要看那一集
 * 本身：上架也滿兩年，或整部作品的集數是一次整批上架（舊作重新上架），才算舊作；
 * 否則多半是正在播的新一季。
 */
const buildOldWorks = (dataset: AnalysisDataset): Highlights["oldWorks"] => {
  const uploads = new Map<number, { min: number; max: number }>();
  for (const episode of dataset.episodes.values()) {
    const minute = toEpochMinute(episode.availableFrom);
    const span = uploads.get(episode.animeSn);
    uploads.set(episode.animeSn, span
      ? { min: Math.min(span.min, minute), max: Math.max(span.max, minute) }
      : { min: minute, max: minute });
  }
  const oldAnime = new Map<number, { record: AnimeMetadata; premiere: string }>();
  let episodeCount = 0;
  let datedEpisodeCount = 0;
  for (const fact of dataset.selectedEvents) {
    const record = fact.anime;
    const premiere = record?.seasonStartDateKey ?? null;
    if (!record || fact.animeSn === null || premiere === null || !fact.episode) continue;
    datedEpisodeCount += 1;
    const watchedKey = toTaipeiDateKey(fact.entry.watchedAt);
    if (daysBetweenKeys(premiere, watchedKey) < OLD_WORK_DAYS) continue;
    const uploadedLongAgo = fact.watchedMinute - toEpochMinute(fact.episode.availableFrom) >= OLD_WORK_DAYS * MINUTES_PER_DAY;
    const span = uploads.get(fact.animeSn);
    const batchUpload = span !== undefined && span.max - span.min <= BATCH_UPLOAD_DAYS * MINUTES_PER_DAY;
    if (!uploadedLongAgo && !batchUpload) continue;
    episodeCount += 1;
    oldAnime.set(fact.animeSn, { record, premiere });
  }
  const oldest = [...oldAnime].sort((left, right) =>
    left[1].premiere.localeCompare(right[1].premiere) || left[0] - right[0])[0];
  if (!oldest) return null;
  const [animeSn, { record, premiere }] = oldest;
  return {
    workCount: oldAnime.size,
    episodeCount,
    datedEpisodeCount,
    oldest: {
      animeSn,
      title: dataset.titleByAnimeSn.get(animeSn) ?? record.apiTitle,
      coverUrl: record.coverUrl,
      premiereYear: Number(premiere.slice(0, 4))
    }
  };
};

/** 每季列出幾部最愛。 */
const FAVORITES_PER_SEASON = 3;
/** 一季至少要有這麼多次「好幾部同時在等」的時刻，才說得出偏心誰。 */
const MIN_SEASON_CHOICE_EVENTS = 8;
/** 一部作品至少要在這麼多個時刻被拿來比過，而且至少一半的時候先被點開，才算得上最愛。 */
const MIN_FAVORITE_DECISIONS = 3;
const MIN_FAVORITE_WIN_RATE = 0.5;
/** 私藏：同季開播、你也看過的作品至少要有這麼多部，人氣名次才有意義。 */
const HIDDEN_GEM_MIN_COHORT = 8;
/** 私藏：人氣名次落在同季作品的後三分之一。 */
const HIDDEN_GEM_RANK_SHARE = 2 / 3;
const MAX_HIDDEN_GEMS = 2;
/** 開播日往後挪一週再判斷季別：提早幾天先播第一集的作品仍算下一季的新番。 */
const PREMIERE_GRACE_DAYS = 7;

const favoritePicks = (rows: readonly PreferenceRow[]): readonly PreferenceRow[] =>
  rows.filter((row) => row.decisionBucketCount >= MIN_FAVORITE_DECISIONS && row.rawWinRate >= MIN_FAVORITE_WIN_RATE)
    .slice(0, FAVORITES_PER_SEASON);

/**
 * 年度期間逐季重算「有得選時先看」：一部作品很少跨一整年播，整年的排行會被長青作品蓋過，
 * 每季各自排才看得出那一季最期待哪幾部。還沒開始的季不列；已開始但時刻太少的季 rows 為空。
 */
const buildSeasonalFavorites = ({
  entries,
  episodes,
  anime,
  historyCoverage,
  scope,
  asOf
}: {
  readonly entries: readonly WatchEntry[];
  readonly episodes: ReadonlyMap<number, EpisodeMetadata>;
  readonly anime: ReadonlyMap<number, AnimeMetadata>;
  readonly historyCoverage: HistoryCoverage;
  readonly scope: AnalysisScope;
  readonly asOf: Date;
}): readonly SeasonalFavorites[] => {
  if (scope.period.kind !== "calendar-year") return [];
  const year = scope.period.year;
  return CALENDAR_SEASONS.flatMap((season): SeasonalFavorites[] => {
    const seasonScope: AnalysisScope = { ...scope, period: { kind: "calendar-season", year, season } };
    let period: ResolvedPeriod;
    try {
      period = resolvePeriod(seasonScope, asOf);
    } catch (error) {
      if (error instanceof RangeError) return [];
      throw error;
    }
    const dataset = buildAnalysisDataset({ entries, episodes, anime, scope: seasonScope, period, asOf });
    const preference = buildPreferenceResult({
      dataset,
      historyCoverage,
      asOf,
      historyComplete: historyCoversScope(historyCoverage, period, asOf)
    });
    return [{
      year,
      season,
      choiceEventCount: preference.choiceEventCount,
      rows: preference.choiceEventCount >= MIN_SEASON_CHOICE_EVENTS ? favoritePicks(preference.rows) : []
    }];
  });
};

const premiereSeason = (seasonStartDateKey: string | null): { readonly year: number; readonly season: CalendarSeason } | null => {
  if (seasonStartDateKey === null) return null;
  const shifted = addTaipeiCalendarDays(seasonStartDateKey, PREMIERE_GRACE_DAYS);
  const year = Number(shifted.slice(0, 4));
  const month = Number(shifted.slice(5, 7));
  return { year, season: CALENDAR_SEASONS[Math.floor((month - 1) / 3)]! };
};

const buildHiddenGems = (
  dataset: AnalysisDataset,
  favorites: readonly PreferenceRow[]
): readonly HiddenGemRow[] => {
  const watched = new Map<number, AnimeMetadata>();
  for (const fact of dataset.selectedEvents) {
    if (fact.animeSn !== null && fact.anime) watched.set(fact.animeSn, fact.anime);
  }
  const cohorts = new Map<string, AnimeMetadata[]>();
  for (const record of watched.values()) {
    const premiere = premiereSeason(record.seasonStartDateKey);
    if (!premiere) continue;
    const key = `${premiere.year}-${premiere.season}`;
    cohorts.set(key, [...(cohorts.get(key) ?? []), record]);
  }
  const gems = new Map<number, HiddenGemRow>();
  for (const favorite of favorites) {
    const record = watched.get(favorite.animeSn);
    // 還在播的作品人氣還在累積，名次不準。
    if (!record || record.isOngoing || gems.has(favorite.animeSn)) continue;
    const premiere = premiereSeason(record.seasonStartDateKey);
    const cohort = premiere ? cohorts.get(`${premiere.year}-${premiere.season}`) ?? [] : [];
    if (!premiere || cohort.length < HIDDEN_GEM_MIN_COHORT) continue;
    const popular = record.platformSnapshot.popular;
    const popularityRank = 1 + cohort.filter((other) => other.platformSnapshot.popular > popular).length;
    if (popularityRank <= cohort.length * HIDDEN_GEM_RANK_SHARE) continue;
    const leader = cohort.reduce((best, other) =>
      other.platformSnapshot.popular > best.platformSnapshot.popular ? other : best);
    gems.set(favorite.animeSn, {
      animeSn: favorite.animeSn,
      title: favorite.title,
      coverUrl: favorite.coverUrl,
      cohortYear: premiere.year,
      cohortSeason: premiere.season,
      cohortSize: cohort.length,
      popularityRank,
      cohortLeaderTitle: dataset.titleByAnimeSn.get(leader.animeSn) ?? leader.apiTitle,
      popularityRatio: leader.platformSnapshot.popular > 0 ? popular / leader.platformSnapshot.popular : 1
    });
  }
  return [...gems.values()]
    .sort((left, right) => left.popularityRatio - right.popularityRatio || left.animeSn - right.animeSn)
    .slice(0, MAX_HIDDEN_GEMS);
};

const buildRuntime = (
  dataset: AnalysisDataset,
  coverage: CoverageResult
): AnalyticsResult["runtime"] => {
  const grouped = new Map<number, {
    watchCount: number;
    contentMinutes: number;
  }>();
  for (const fact of dataset.selectedEvents) {
    if (fact.animeSn === null || !validDuration(fact.episode)) {
      continue;
    }
    const value = grouped.get(fact.animeSn) ?? { watchCount: 0, contentMinutes: 0 };
    value.watchCount += 1;
    value.contentMinutes += fact.episode.durationMinutes;
    grouped.set(fact.animeSn, value);
  }

  const rows = assignRanks(
    Array.from(grouped, ([animeSn, value]) => ({
      animeSn,
      title: dataset.titleByAnimeSn.get(animeSn) ?? "",
      coverUrl: dataset.selectedEvents.find((fact) => fact.animeSn === animeSn)?.anime?.coverUrl ?? null,
      ...value
    })).sort((left, right) => right.contentMinutes - left.contentMinutes
      || right.watchCount - left.watchCount
      || left.animeSn - right.animeSn),
    (left, right) => left.contentMinutes === right.contentMinutes
  );

  const longest = dataset.selectedEvents
    .filter((fact): fact is WatchFact & { readonly episode: EpisodeMetadata; readonly animeSn: number } =>
      fact.animeSn !== null && validDuration(fact.episode))
    .sort((left, right) => right.episode.durationMinutes - left.episode.durationMinutes
      || left.watchedMinute - right.watchedMinute
      || left.entry.videoSn - right.entry.videoSn)[0];

  return {
    available: rows.length > 0,
    coverage,
    rows,
    longestEpisode: longest
      ? {
          videoSn: longest.entry.videoSn,
          animeSn: longest.animeSn,
          title: dataset.titleByAnimeSn.get(longest.animeSn) ?? longest.entry.title,
          episode: longest.entry.episode,
          coverUrl: longest.episode.coverUrl,
          durationMinutes: longest.episode.durationMinutes,
          watchedAt: new Date(longest.entry.watchedAt.getTime())
        }
      : null
  };
};

const buildCatalog = (
  dataset: AnalysisDataset,
  historyComplete: boolean
): AnalyticsResult["catalog"] => {
  const animeSns = new Set(dataset.selectedEvents.flatMap((fact) => fact.animeSn === null ? [] : [fact.animeSn]));
  const availableAnime = [...animeSns].filter((animeSn) => dataset.selectedEvents.some(
    (fact) => fact.animeSn === animeSn && fact.anime !== null
  ));
  const coverage = coverageResult(availableAnime.length, animeSns.size, historyComplete, MIN_METADATA_COVERAGE);
  return {
    animeCoverage: coverage,
    tags: buildDimensionRows(dataset, (record) => record.tags),
    makers: buildDimensionRows(dataset, (record) => record.maker ? [record.maker] : []),
    directors: buildDimensionRows(dataset, (record) => record.director ? [record.director] : []),
    publishers: buildDimensionRows(dataset, (record) => record.publisher ? [record.publisher] : [])
  };
};

const buildCurrentPlatformSnapshotComparison = (
  dataset: AnalysisDataset,
  historyComplete: boolean
): AnalyticsResult["currentPlatformSnapshotComparison"] => {
  const watchCounts = new Map<number, number>();
  const metadataByAnime = new Map<number, AnimeMetadata>();
  for (const fact of dataset.selectedEvents) {
    if (fact.animeSn === null) continue;
    watchCounts.set(fact.animeSn, (watchCounts.get(fact.animeSn) ?? 0) + 1);
    if (fact.anime && validCurrentPlatformSnapshot(fact.anime)) {
      metadataByAnime.set(fact.animeSn, fact.anime);
    }
  }

  const coverage = coverageResult(
    metadataByAnime.size,
    watchCounts.size,
    historyComplete,
    MIN_METADATA_COVERAGE
  );
  const personalRanks = assignRanks(
    [...watchCounts].map(([animeSn, personalWatchCount]) => ({ animeSn, personalWatchCount }))
      .sort((left, right) => right.personalWatchCount - left.personalWatchCount
        || left.animeSn - right.animeSn),
    (left, right) => left.personalWatchCount === right.personalWatchCount
  );
  const personalRankByAnime = new Map(personalRanks.map((row) => [row.animeSn, row.rank]));
  const platformRanks = assignRanks(
    [...metadataByAnime].map(([animeSn, record]) => ({
      animeSn,
      platformPopular: record.platformSnapshot.popular
    })).sort((left, right) => right.platformPopular - left.platformPopular
      || left.animeSn - right.animeSn),
    (left, right) => left.platformPopular === right.platformPopular
  );
  const platformRankByAnime = new Map(platformRanks.map((row) => [row.animeSn, row.rank]));
  const rows = [...metadataByAnime].map(([animeSn, record]): CurrentPlatformSnapshotComparisonRow => ({
    animeSn,
    title: dataset.titleByAnimeSn.get(animeSn) ?? record.apiTitle,
    coverUrl: record.coverUrl,
    personalWatchRank: requiredMapValue(personalRankByAnime, animeSn, "個人觀看排名"),
    personalWatchCount: requiredMapValue(watchCounts, animeSn, "個人觀看次數"),
    platformPopularityRankWithinCoveredAnime: requiredMapValue(
      platformRankByAnime,
      animeSn,
      "目前平台人氣排名"
    ),
    platformPopular: record.platformSnapshot.popular,
    platformSnapshotObservedAt: new Date(record.platformSnapshot.observedAt.getTime())
  })).sort((left, right) => left.personalWatchRank - right.personalWatchRank
    || right.personalWatchCount - left.personalWatchCount
    || left.animeSn - right.animeSn);

  return {
    label: "目前平台快照",
    temporalBasis: "current-platform-snapshot",
    available: rows.length >= 2,
    animeMetadataCoverage: coverage,
    rows: rows.length >= 2 ? rows : []
  };
};

const buildObservedWatchedEpisodeReleaseFootprints = (
  dataset: AnalysisDataset,
  historyComplete: boolean
): AnalyticsResult["observedWatchedEpisodeReleaseFootprints"] => {
  const grouped = new Map<number, WatchFact[]>();
  for (const fact of dataset.selectedCanonical) {
    if (fact.animeSn === null) continue;
    const facts = grouped.get(fact.animeSn) ?? [];
    facts.push(fact);
    grouped.set(fact.animeSn, facts);
  }

  const rows = [...grouped].map(([animeSn, facts]): ObservedWatchedEpisodeReleaseFootprintRow => {
    const knownReleaseFacts = facts.filter((fact): fact is WatchFact & { readonly episode: EpisodeMetadata } =>
      fact.releaseValid && fact.episode !== null);
    const seasons = new Map<string, ObservedWatchedEpisodeReleaseSeason>();
    for (const fact of knownReleaseFacts) {
      const reference = classifyReleaseAtTaipei(fact.episode.availableFrom);
      const key = `${reference.year}-${reference.season}`;
      const existing = seasons.get(key);
      seasons.set(key, {
        ...reference,
        label: `${reference.year} ${seasonName(reference.season)}`,
        knownReleaseEpisodeCount: (existing?.knownReleaseEpisodeCount ?? 0) + 1
      });
    }
    const firstAnime = facts.find((fact) => fact.anime !== null)?.anime ?? null;
    const firstEpisodeCover = facts.find((fact) => fact.episode?.coverUrl)?.episode?.coverUrl ?? null;
    return {
      animeSn,
      title: dataset.titleByAnimeSn.get(animeSn) ?? firstAnime?.apiTitle ?? "",
      coverUrl: firstAnime?.coverUrl ?? firstEpisodeCover,
      observationBasis: "selected-watched-episodes-only",
      representsCompleteAiringStructure: false,
      identifiedWatchedEpisodeCount: facts.length,
      knownReleaseEpisodeCount: knownReleaseFacts.length,
      releaseCoverage: coverageResult(
        knownReleaseFacts.length,
        facts.length,
        historyComplete,
        MIN_METADATA_COVERAGE
      ),
      observedReleaseSeasons: [...seasons.values()].sort((left, right) =>
        left.year - right.year || seasonIndex(left.season) - seasonIndex(right.season))
    };
  }).sort((left, right) => right.knownReleaseEpisodeCount - left.knownReleaseEpisodeCount
    || right.identifiedWatchedEpisodeCount - left.identifiedWatchedEpisodeCount
    || left.animeSn - right.animeSn);

  return {
    observationBasis: "selected-watched-episodes-only",
    representsCompleteAiringStructure: false,
    rows
  };
};

const buildDimensionRows = (
  dataset: AnalysisDataset,
  labelsForAnime: (anime: AnimeMetadata) => readonly string[]
): readonly DimensionRow[] => {
  const aggregates = new Map<string, MutableAggregate>();
  for (const fact of dataset.selectedEvents) {
    if (!fact.anime || fact.animeSn === null) {
      continue;
    }
    for (const rawLabel of new Set(labelsForAnime(fact.anime))) {
      const label = rawLabel.trim();
      if (!label) continue;
      const value = aggregates.get(label) ?? {
        watchCount: 0,
        knownContentMinutes: 0,
        durationKnownCount: 0,
        animeSns: new Set<number>()
      };
      value.watchCount += 1;
      value.animeSns.add(fact.animeSn);
      if (validDuration(fact.episode)) {
        value.knownContentMinutes += fact.episode.durationMinutes;
        value.durationKnownCount += 1;
      }
      aggregates.set(label, value);
    }
  }

  return assignRanks(
    Array.from(aggregates, ([label, value]) => ({
      label,
      animeCount: value.animeSns.size,
      watchCount: value.watchCount,
      contentMinutes: value.knownContentMinutes
    // 依作品數排：一部 24 集的作品不該比兩部 12 集的作品更代表你的口味。集數只用來分同數。
    })).sort((left, right) => right.animeCount - left.animeCount
      || right.watchCount - left.watchCount
      || right.contentMinutes - left.contentMinutes
      || left.label.localeCompare(right.label, "zh-Hant-TW")),
    (left, right) => left.animeCount === right.animeCount && left.watchCount === right.watchCount
  );
};

const buildCompletionRows = (dataset: AnalysisDataset): readonly CompletionRow[] => {
  const selectedAnimeSns = new Set(dataset.selectedEvents.flatMap((fact) => fact.animeSn === null ? [] : [fact.animeSn]));
  const watchedVideosByAnime = new Map<number, Set<number>>();
  for (const fact of dataset.canonical) {
    if (fact.animeSn === null) continue;
    if (dataset.scope.axis === "watched-at"
      && fact.entry.watchedAt >= dataset.period.effectiveRange.endExclusive) continue;
    const values = watchedVideosByAnime.get(fact.animeSn) ?? new Set<number>();
    values.add(fact.entry.videoSn);
    watchedVideosByAnime.set(fact.animeSn, values);
  }

  return [...selectedAnimeSns].flatMap((animeSn): CompletionRow[] => {
    const record = dataset.selectedEvents.find((fact) => fact.animeSn === animeSn)?.anime;
    const verifiedRefs = record ? singleSeasonReferences(record) : null;
    if (!record || !verifiedRefs) {
      return [];
    }
    const episodeVideoSns = new Set(verifiedRefs.map((ref) => ref.videoSn));
    const watched = watchedVideosByAnime.get(animeSn) ?? new Set<number>();
    const watchedEpisodeCount = [...watched].filter((videoSn) => episodeVideoSns.has(videoSn)).length;
    if (watchedEpisodeCount > record.totalEpisode) {
      return [];
    }
    const ratio = watchedEpisodeCount / record.totalEpisode;
    return [{
      animeSn,
      title: dataset.titleByAnimeSn.get(animeSn) ?? "",
      coverUrl: record.coverUrl,
      watchedEpisodeCount,
      totalEpisode: record.totalEpisode,
      ratio,
      isOngoing: record.isOngoing,
      outcome: completionOutcome({
        ratio,
        remaining: record.totalEpisode - watchedEpisodeCount,
        isOngoing: record.isOngoing,
        sawFirstEpisode: watched.has(verifiedRefs[0]!.videoSn)
      })
    }];
  }).sort((left, right) => right.ratio - left.ratio
    || right.watchedEpisodeCount - left.watchedEpisodeCount
    || left.animeSn - right.animeSn);
};

/** 只差這麼多集以內，算「差一點看完」。 */
const NEARLY_MAX_REMAINING = 2;
/** 看不到這個比例就停了，算「放棄」。 */
const DROPPED_BELOW_RATIO = 0.5;
/** 一個類型至少要有這麼多部從頭開始看的已完結作品，放棄比例才有意義。 */
const DROP_TAG_MIN_STARTED = 8;

const completionOutcome = ({
  ratio,
  remaining,
  isOngoing,
  sawFirstEpisode
}: {
  readonly ratio: number;
  readonly remaining: number;
  readonly isOngoing: boolean;
  readonly sawFirstEpisode: boolean;
}): CompletionOutcome => {
  if (isOngoing) return ratio >= 1 ? "caught-up" : "behind";
  if (ratio >= 1) return "finished";
  if (!sawFirstEpisode) return "unknown-start";
  if (ratio < DROPPED_BELOW_RATIO) return "dropped";
  return remaining <= NEARLY_MAX_REMAINING ? "nearly" : "midway";
};

const STARTED_OUTCOMES: ReadonlySet<CompletionOutcome> = new Set(["finished", "nearly", "midway", "dropped"]);

const buildDropTags = (dataset: AnalysisDataset, rows: readonly CompletionRow[]): readonly DropTagRow[] => {
  const tagsByAnime = new Map<number, readonly string[]>();
  for (const fact of dataset.selectedEvents) {
    if (fact.animeSn !== null && fact.anime) tagsByAnime.set(fact.animeSn, fact.anime.tags);
  }
  const stats = new Map<string, { startedCount: number; droppedCount: number }>();
  for (const row of rows) {
    if (!STARTED_OUTCOMES.has(row.outcome)) continue;
    for (const rawTag of new Set(tagsByAnime.get(row.animeSn) ?? [])) {
      const label = rawTag.trim();
      if (!label) continue;
      const value = stats.get(label) ?? { startedCount: 0, droppedCount: 0 };
      value.startedCount += 1;
      if (row.outcome === "dropped") value.droppedCount += 1;
      stats.set(label, value);
    }
  }
  return [...stats]
    .filter(([, value]) => value.startedCount >= DROP_TAG_MIN_STARTED)
    .map(([label, value]) => ({ label, ...value, dropRate: value.droppedCount / value.startedCount }))
    .sort((left, right) => right.dropRate - left.dropRate
      || right.startedCount - left.startedCount
      || left.label.localeCompare(right.label, "zh-Hant-TW"));
};

const exactContiguousGroupRefs = (
  anime: AnimeMetadata,
  groupKey: string
): AnimeMetadata["episodeRefs"] | null => {
  if (!positiveSafeInteger(anime.totalEpisode) || groupKey.trim().length === 0) return null;
  const references = anime.episodeRefs.filter((reference) => reference.groupKey === groupKey);
  if (references.length !== anime.totalEpisode) return null;
  const videoSns = new Set<number>();
  const episodeNumbers = new Set<number>();
  for (const reference of references) {
    if (
      !positiveSafeInteger(reference.videoSn)
      || videoSns.has(reference.videoSn)
      || !positiveSafeInteger(reference.episodeNumber)
      || reference.episodeNumber > anime.totalEpisode
      || episodeNumbers.has(reference.episodeNumber)
    ) {
      return null;
    }
    videoSns.add(reference.videoSn);
    episodeNumbers.add(reference.episodeNumber);
  }
  for (let episodeNumber = 1; episodeNumber <= anime.totalEpisode; episodeNumber += 1) {
    if (!episodeNumbers.has(episodeNumber)) return null;
  }
  return references;
};

const buildSeasonBreakdown = (
  dataset: AnalysisDataset,
  historyComplete: boolean
): readonly SeasonBreakdownRow[] => {
  const rows = new Map<string, MutableAggregate & { year: number; season: CalendarSeason }>();
  for (const fact of dataset.selectedEvents) {
    if (!fact.releaseValid || !fact.episode) continue;
    const reference = classifyReleaseAtTaipei(fact.episode.availableFrom);
    const key = `${reference.year}-${reference.season}`;
    const value = rows.get(key) ?? {
      ...reference,
      watchCount: 0,
      knownContentMinutes: 0,
      durationKnownCount: 0,
      animeSns: new Set<number>()
    };
    value.watchCount += 1;
    if (fact.animeSn !== null) value.animeSns.add(fact.animeSn);
    if (validDuration(fact.episode)) {
      value.knownContentMinutes += fact.episode.durationMinutes;
      value.durationKnownCount += 1;
    }
    rows.set(key, value);
  }

  if (dataset.scope.axis === "released-at" && dataset.period.scope.period.kind === "calendar-year") {
    for (const reference of dataset.period.constituentSeasons) {
      const key = `${reference.year}-${reference.season}`;
      if (!rows.has(key)) {
        rows.set(key, {
          ...reference,
          watchCount: 0,
          knownContentMinutes: 0,
          durationKnownCount: 0,
          animeSns: new Set<number>()
        });
      }
    }
  }

  return [...rows.values()]
    .sort((left, right) => left.year - right.year || seasonIndex(left.season) - seasonIndex(right.season))
    .map((value) => {
      const coverage = coverageResult(
        value.durationKnownCount,
        value.watchCount,
        historyComplete,
        MIN_EXACT_COVERAGE
      );
      return {
        year: value.year,
        season: value.season,
        label: `${value.year} ${seasonName(value.season)}`,
        watchCount: value.watchCount,
        animeCount: value.animeSns.size,
        knownContentMinutes: value.knownContentMinutes,
        contentMinutes: value.durationKnownCount > 0 || value.watchCount === 0
          ? value.knownContentMinutes
          : null,
        durationCoverage: coverage
      };
    });
};

const buildTimelinessRows = (
  watches: readonly WatchFact[],
  dataset: AnalysisDataset
): readonly TimelinessRow[] => {
  const grouped = groupValidWatchesByAnime(watches);
  const unranked = Array.from(grouped, ([animeSn, animeWatches]) => {
    const lags = animeWatches.map(releaseLagMinutes);
    const within24HoursCount = lags.filter((lag) => lag <= MINUTES_PER_DAY).length;
    return {
      animeSn,
      title: dataset.titleByAnimeSn.get(animeSn) ?? "",
      coverUrl: animeWatches[0]?.anime?.coverUrl ?? null,
      sampleCount: lags.length,
      medianLagMinutes: median(lags),
      within24HoursCount,
      within24HoursRate: within24HoursCount / lags.length
    };
  }).filter((row) => row.sampleCount >= MIN_TIMELINESS_SAMPLES)
    .sort((left, right) => left.medianLagMinutes - right.medianLagMinutes
      || right.sampleCount - left.sampleCount
      || left.animeSn - right.animeSn);

  return assignRanks(unranked, (left, right) => left.medianLagMinutes === right.medianLagMinutes);
};

const buildPreferenceResult = ({
  dataset,
  historyCoverage,
  asOf,
  historyComplete
}: {
  readonly dataset: AnalysisDataset;
  readonly historyCoverage: HistoryCoverage;
  readonly asOf: Date;
  readonly historyComplete: boolean;
}): AnalyticsResult["preference"] => {
  const asOfMinute = toEpochMinute(asOf);
  const coverageStartMinute = validDate(historyCoverage.coveredFrom)
    ? toEpochMinute(historyCoverage.coveredFrom)
    : Number.POSITIVE_INFINITY;
  const earliestSafeAnchorMinute = coverageStartMinute + SHORT_BINGE_GAP_MINUTES;
  const relevantWatches = dataset.canonical.filter((fact) =>
    fact.watchedMinute >= coverageStartMinute && fact.watchedMinute <= asOfMinute
  );
  const buckets = buildChoiceBuckets(dataset.canonical);
  const potentialDecisionMinutes = buckets
    .filter((bucket) => bucket.minute >= earliestSafeAnchorMinute
      && bucket.minute <= asOfMinute
      && bucket.watches.some((fact) => selectedPreferenceOutcome(fact, dataset)))
    .map((bucket) => bucket.minute);
  const catalog = buildPreferenceCatalog({
    dataset,
    relevantWatches,
    potentialDecisionMinutes,
    historyComplete
  });
  const stats = new Map<number, MutablePreferenceStats>();
  let choiceEventCount = 0;

  for (let index = 0; index < buckets.length; index += 1) {
    const bucket = buckets[index];
    if (!bucket
      || bucket.minute < earliestSafeAnchorMinute
      || !bucket.watches.some((fact) => selectedPreferenceOutcome(fact, dataset))) {
      continue;
    }
    if (bucket.watches.some((fact) => !fact.preferenceValid)) {
      continue;
    }

    const candidates = candidatesAtMinute(
      dataset,
      bucket.minute,
      catalog.timelines
    );
    if (candidates.size < 2) {
      continue;
    }

    const previousBucket = index > 0 ? buckets[index - 1] : undefined;
    const predecessorIsAmbiguous = previousBucket !== undefined
      && bucket.minute - previousBucket.minute <= SHORT_BINGE_GAP_MINUTES
      && previousBucket.watches.some((fact) => !fact.preferenceValid);
    if (predecessorIsAmbiguous) {
      continue;
    }

    const observedAnime = new Set(bucket.watches.flatMap((fact) =>
      fact.animeSn === null ? [] : [fact.animeSn]
    ));
    const selected = new Set<number>();
    for (const fact of bucket.watches) {
      const animeSn = fact.animeSn;
      if (animeSn === null) continue;
      const candidate = candidates.get(animeSn);
      if (!candidate
        || !candidate.pendingVideoSns.has(fact.entry.videoSn)
        || !selectedPreferenceOutcome(fact, dataset)
        || isBingeContinuation(animeSn, bucket.minute, previousBucket)) {
        continue;
      }
      selected.add(animeSn);
    }
    if (selected.size === 0) {
      continue;
    }

    let producedOutcome = false;
    for (const winnerAnimeSn of selected) {
      for (const loserAnimeSn of candidates.keys()) {
        if (winnerAnimeSn === loserAnimeSn || observedAnime.has(loserAnimeSn)) continue;
        recordOutcome(stats, winnerAnimeSn, loserAnimeSn, bucket.minute);
        producedOutcome = true;
      }
    }
    if (producedOutcome) choiceEventCount += 1;
  }

  const unranked = Array.from(stats, ([animeSn, value]) => {
    const comparisons = value.wins + value.losses;
    return {
      animeSn,
      title: dataset.titleByAnimeSn.get(animeSn) ?? dataset.anime.get(animeSn)?.apiTitle ?? "",
      coverUrl: dataset.anime.get(animeSn)?.coverUrl ?? null,
      wins: value.wins,
      losses: value.losses,
      comparisons,
      rawWinRate: value.wins / comparisons,
      wilsonLower95: wilsonLower95(value.wins, comparisons),
      distinctOpponentCount: value.opponents.size,
      decisionBucketCount: value.decisions.size
    };
  }).filter((row) => row.comparisons >= MIN_PREFERENCE_COMPARISONS
      && row.distinctOpponentCount >= MIN_PREFERENCE_OPPONENTS
      && row.decisionBucketCount >= MIN_PREFERENCE_DECISIONS)
    .sort(comparePreferenceRows);
  const rows = assignRanks(
    unranked,
    (left, right) => Math.abs(left.wilsonLower95 - right.wilsonLower95) < SCORE_TIE_EPSILON
  );

  return {
    available: rows.length >= 2,
    coverage: catalog.coverage,
    choiceEventCount,
    rows: rows.length >= 2 ? rows : []
  };
};

const selectedPreferenceOutcome = (fact: WatchFact, dataset: AnalysisDataset): boolean =>
  factInScope(fact, dataset.scope, dataset.period);

const buildPreferenceCatalog = ({
  dataset,
  relevantWatches,
  potentialDecisionMinutes,
  historyComplete
}: {
  readonly dataset: AnalysisDataset;
  readonly relevantWatches: readonly WatchFact[];
  readonly potentialDecisionMinutes: readonly number[];
  readonly historyComplete: boolean;
}): PreferenceCatalog => {
  const started = new Map<string, StreamIdentity & { firstObservedMinute: number }>();
  let numerator = relevantWatches.filter((fact) => fact.preferenceValid).length;
  let denominator = relevantWatches.length;
  let structurallyExact = true;

  for (const fact of relevantWatches) {
    const identity = streamIdentityForFact(fact);
    if (!identity) {
      structurallyExact = false;
      continue;
    }
    const existing = started.get(identity.key);
    if (!existing || fact.watchedMinute < existing.firstObservedMinute) {
      started.set(identity.key, { ...identity, firstObservedMinute: fact.watchedMinute });
    }
  }

  const firstWatchedMinuteByVideoSn = new Map(
    dataset.canonical.map((fact) => [fact.entry.videoSn, fact.watchedMinute] as const)
  );
  const timelines: StartedStreamTimeline[] = [];

  for (const stream of started.values()) {
    if (!streamIsRelevantToDecision(dataset, stream, potentialDecisionMinutes)) continue;

    const anime = dataset.anime.get(stream.animeSn);
    const animeValid = anime?.animeSn === stream.animeSn && validDate(anime.fetchedAt);
    const rawRefs = animeValid ? anime.episodeRefs : [];
    const expectedEpisodeCount = animeValid && positiveSafeInteger(anime.totalEpisode)
      ? anime.totalEpisode
      : Math.max(rawRefs.length, 1);
    denominator += expectedEpisodeCount;
    const refs = animeValid ? exactContiguousGroupRefs(anime, stream.groupKey) : null;
    const latestDecisionMinute = latestPotentialDecisionMinute(stream, potentialDecisionMinutes);
    const snapshotCoversDecisions = animeValid
      && latestDecisionMinute !== null
      && toEpochMinute(anime.fetchedAt) >= latestDecisionMinute;
    if (
      !refs
      || !snapshotCoversDecisions
    ) {
      structurallyExact = false;
      continue;
    }

    const refVideoSns = new Set<number>();
    const refEpisodeNumbers = new Set<number>();
    const matchedEpisodes: CatalogEpisode[] = [];
    for (const ref of refs) {
      const refValid = positiveSafeInteger(ref.videoSn)
        && positiveSafeInteger(ref.episodeNumber)
        && ref.groupKey === stream.groupKey
        && !refVideoSns.has(ref.videoSn)
        && !refEpisodeNumbers.has(ref.episodeNumber);
      refVideoSns.add(ref.videoSn);
      refEpisodeNumbers.add(ref.episodeNumber);

      const metadata = dataset.episodes.get(ref.videoSn);
      if (!refValid || !catalogEpisodeMatchesRef(metadata, stream, ref)) {
        structurallyExact = false;
        continue;
      }
      numerator += 1;
      matchedEpisodes.push({
        metadata,
        availableMinute: toEpochMinute(metadata.availableFrom),
        unavailableMinute: metadata.availableUntil === null
          ? null
          : toEpochMinute(metadata.availableUntil),
        firstWatchedMinute: firstWatchedMinuteByVideoSn.get(metadata.videoSn) ?? null
      });
    }

    const watchedFacts = relevantWatches.filter((fact) =>
      fact.animeSn === stream.animeSn && fact.episode?.groupKey === stream.groupKey);
    if (watchedFacts.some((fact) => !refVideoSns.has(fact.entry.videoSn))) {
      structurallyExact = false;
    }
    if (matchedEpisodes.length !== refs.length) {
      structurallyExact = false;
      continue;
    }

    timelines.push({
      ...stream,
      episodes: matchedEpisodes.slice().sort(compareCatalogEpisodes)
    });
  }

  return {
    coverage: coverageResult(
      numerator,
      denominator,
      historyComplete && structurallyExact,
      MIN_EXACT_COVERAGE
    ),
    timelines
  };
};

const streamIdentityForFact = (fact: WatchFact): StreamIdentity | null => {
  if (fact.animeSn === null || !fact.episode || fact.episode.groupKey.trim().length === 0) {
    return null;
  }
  const groupKey = fact.episode.groupKey;
  return {
    key: JSON.stringify([fact.animeSn, groupKey]),
    animeSn: fact.animeSn,
    groupKey
  };
};

const streamIsRelevantToDecision = (
  dataset: AnalysisDataset,
  stream: StreamIdentity & { readonly firstObservedMinute: number },
  potentialDecisionMinutes: readonly number[]
): boolean => {
  const latestDecisionMinute = latestPotentialDecisionMinute(stream, potentialDecisionMinutes);
  if (latestDecisionMinute === null) return false;
  if (dataset.scope.axis !== "released-at") return true;

  const anime = dataset.anime.get(stream.animeSn);
  const animeValid = anime?.animeSn === stream.animeSn && validDate(anime.fetchedAt);
  const refs = animeValid ? exactContiguousGroupRefs(anime, stream.groupKey) : null;
  if (
    !refs
    || !anime
    || toEpochMinute(anime.fetchedAt) < latestDecisionMinute
  ) {
    // Without a complete post-decision snapshot, this stream cannot be proven
    // irrelevant to the selected release cohort, so it must fail closed.
    return true;
  }
  return refs.some((ref) => {
    const metadata = dataset.episodes.get(ref.videoSn);
    return !catalogEpisodeMatchesRef(metadata, stream, ref)
      || preferenceCohortIncludesEpisode(dataset, metadata);
  });
};

const latestPotentialDecisionMinute = (
  stream: { readonly firstObservedMinute: number },
  potentialDecisionMinutes: readonly number[]
): number | null => {
  let latest: number | null = null;
  for (const minute of potentialDecisionMinutes) {
    if (minute > stream.firstObservedMinute && (latest === null || minute > latest)) {
      latest = minute;
    }
  }
  return latest;
};

const catalogEpisodeMatchesRef = (
  metadata: EpisodeMetadata | undefined,
  stream: StreamIdentity,
  ref: AnimeMetadata["episodeRefs"][number]
): metadata is EpisodeMetadata => metadata !== undefined
  && metadata.videoSn === ref.videoSn
  && metadata.animeSn === stream.animeSn
  && metadata.groupKey === stream.groupKey
  && metadata.episodeNumber === ref.episodeNumber
  && Number.isSafeInteger(metadata.episodeIndex)
  && metadata.episodeIndex >= 0
  && validDate(metadata.availableFrom)
  && (metadata.availableUntil === null || validDate(metadata.availableUntil))
  && validDate(metadata.fetchedAt);

const preferenceCohortIncludesEpisode = (
  dataset: AnalysisDataset,
  episode: EpisodeMetadata
): boolean => {
  if (dataset.scope.axis !== "released-at") return true;
  const timestamp = episode.availableFrom.getTime();
  return timestamp >= dataset.period.effectiveRange.startInclusive.getTime()
    && timestamp < dataset.period.effectiveRange.endExclusive.getTime();
};

const compareCatalogEpisodes = (left: CatalogEpisode, right: CatalogEpisode): number =>
  left.metadata.episodeNumber - right.metadata.episodeNumber
  || left.availableMinute - right.availableMinute
  || left.metadata.videoSn - right.metadata.videoSn;

const candidatesAtMinute = (
  dataset: AnalysisDataset,
  minute: number,
  timelines: readonly StartedStreamTimeline[]
): ReadonlyMap<number, PreferenceCandidate> => {
  const pendingByAnime = new Map<number, Set<number>>();
  for (const timeline of timelines) {
    if (timeline.firstObservedMinute >= minute) continue;
    for (const episode of timeline.episodes) {
      if (episode.availableMinute <= timeline.firstObservedMinute
        || episode.availableMinute > minute
        || (episode.unavailableMinute !== null && minute >= episode.unavailableMinute)
        || (episode.firstWatchedMinute !== null && episode.firstWatchedMinute < minute)
        || !preferenceCohortIncludesEpisode(dataset, episode.metadata)) {
        continue;
      }
      const pending = pendingByAnime.get(timeline.animeSn) ?? new Set<number>();
      pending.add(episode.metadata.videoSn);
      pendingByAnime.set(timeline.animeSn, pending);
    }
  }
  return new Map(Array.from(pendingByAnime, ([animeSn, pendingVideoSns]) => [
    animeSn,
    { animeSn, pendingVideoSns }
  ]));
};

const CLOCK_SEGMENT_DEFINITIONS = [
  { key: "morning", label: "清晨", startHour: 5, endHour: 11 },
  { key: "daytime", label: "白天", startHour: 11, endHour: 17 },
  { key: "evening", label: "晚間", startHour: 17, endHour: 23 },
  { key: "late-night", label: "深夜", startHour: 23, endHour: 5 }
] as const;

const WEEKDAY_LABELS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"] as const;

const taipeiHourOf = (instant: Date): number =>
  new Date(instant.getTime() + 8 * 3_600_000).getUTCHours();

const segmentHourList = (startHour: number, endHour: number): readonly number[] => {
  const hours: number[] = [];
  for (let hour = startHour; hour !== endHour; hour = (hour + 1) % 24) hours.push(hour);
  return hours;
};

const buildHabitClock = (dataset: AnalysisDataset): HabitClock => {
  const hourCounts = Array.from({ length: 24 }, () => 0);
  const weekdayCounts = Array.from({ length: 7 }, () => 0);
  for (const fact of dataset.selectedEvents) {
    const hour = taipeiHourOf(fact.entry.watchedAt);
    const weekday = taipeiWeekday(fact.entry.dateKey);
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
    weekdayCounts[weekday] = (weekdayCounts[weekday] ?? 0) + 1;
  }
  const total = dataset.selectedEvents.length;
  if (total === 0) {
    return {
      available: false,
      hourCounts,
      peakHour: null,
      peakHourCount: 0,
      segments: [],
      topSegment: null,
      weekdayCounts,
      topWeekday: null
    };
  }

  const segments: ClockSegment[] = CLOCK_SEGMENT_DEFINITIONS.map((definition) => {
    const watchCount = segmentHourList(definition.startHour, definition.endHour)
      .reduce((sum, hour) => sum + hourCounts[hour]!, 0);
    return { ...definition, watchCount, share: watchCount / total };
  });
  const topSegment = segments.reduce((best, segment) =>
    segment.watchCount > best.watchCount ? segment : best);

  const peakHour = hourCounts.reduce(
    (best, count, hour) => count > hourCounts[best]! ? hour : best,
    0
  );
  const topWeekdayIndex = weekdayCounts.reduce(
    (best, count, weekday) => count > weekdayCounts[best]! ? weekday : best,
    0
  );

  return {
    available: true,
    hourCounts,
    peakHour,
    peakHourCount: hourCounts[peakHour]!,
    segments,
    topSegment,
    weekdayCounts,
    topWeekday: {
      weekday: topWeekdayIndex,
      label: WEEKDAY_LABELS[topWeekdayIndex]!,
      watchCount: weekdayCounts[topWeekdayIndex]!
    }
  };
};

const buildMarathon = (dataset: AnalysisDataset): Marathon => {
  if (dataset.selectedEvents.length === 0) {
    return { available: false, peakDay: null, longestStreak: null, topSingleDayRun: null };
  }

  const byDay = new Map<string, { watchCount: number; knownContentMinutes: number }>();
  const byDayAnime = new Map<string, number>();
  for (const fact of dataset.selectedEvents) {
    const dateKey = fact.entry.dateKey;
    const day = byDay.get(dateKey) ?? { watchCount: 0, knownContentMinutes: 0 };
    day.watchCount += 1;
    if (validDuration(fact.episode)) day.knownContentMinutes += fact.episode.durationMinutes;
    byDay.set(dateKey, day);
    if (fact.animeSn !== null) {
      const runKey = `${dateKey}|${fact.animeSn}`;
      byDayAnime.set(runKey, (byDayAnime.get(runKey) ?? 0) + 1);
    }
  }

  const peakDayEntry = [...byDay.entries()].sort((left, right) =>
    right[1].watchCount - left[1].watchCount || (left[0] < right[0] ? -1 : 1))[0]!;

  const dayKeys = [...byDay.keys()].sort();
  let longestStreak = { days: 1, fromDateKey: dayKeys[0]!, toDateKey: dayKeys[0]! };
  let streakStart = dayKeys[0]!;
  for (let index = 1; index < dayKeys.length; index++) {
    const previous = dayKeys[index - 1]!;
    const current = dayKeys[index]!;
    if (addTaipeiCalendarDays(previous, 1) !== current) streakStart = current;
    const days = spanInDays(streakStart, current);
    if (days > longestStreak.days) longestStreak = { days, fromDateKey: streakStart, toDateKey: current };
  }

  const topRunEntry = [...byDayAnime.entries()].sort((left, right) =>
    right[1] - left[1] || (left[0] < right[0] ? -1 : 1))[0];
  let topSingleDayRun: Marathon["topSingleDayRun"] = null;
  if (topRunEntry && topRunEntry[1] > 1) {
    const [runKey, watchCount] = topRunEntry;
    const separator = runKey.lastIndexOf("|");
    const dateKey = runKey.slice(0, separator);
    const animeSn = Number(runKey.slice(separator + 1));
    topSingleDayRun = {
      animeSn,
      title: dataset.titleByAnimeSn.get(animeSn) ?? "",
      coverUrl: dataset.selectedEvents.find((fact) => fact.animeSn === animeSn)?.anime?.coverUrl ?? null,
      dateKey,
      watchCount
    };
  }

  return {
    available: true,
    peakDay: {
      dateKey: peakDayEntry[0],
      watchCount: peakDayEntry[1].watchCount,
      knownContentMinutes: peakDayEntry[1].knownContentMinutes
    },
    longestStreak,
    topSingleDayRun
  };
};

const spanInDays = (fromDateKey: string, toDateKey: string): number => {
  let days = 1;
  let cursor = fromDateKey;
  while (cursor < toDateKey) {
    cursor = addTaipeiCalendarDays(cursor, 1);
    days += 1;
  }
  return days;
};

const buildRhythm = (dataset: AnalysisDataset): readonly RhythmPoint[] => {
  const useDaily = dataset.scope.period.kind === "calendar-month"
    || (dataset.scope.period.kind === "rolling-days" && dataset.scope.period.days === 30);
  const aggregates = new Map<string, { count: number; knownMinutes: number; knownDurations: number }>();
  for (const fact of dataset.selectedEvents) {
    const dateKey = axisDateKey(fact, dataset.scope);
    const label = useDaily ? dateKey : dateKey.slice(0, 7);
    const value = aggregates.get(label) ?? { count: 0, knownMinutes: 0, knownDurations: 0 };
    value.count += 1;
    if (validDuration(fact.episode)) {
      value.knownMinutes += fact.episode.durationMinutes;
      value.knownDurations += 1;
    }
    aggregates.set(label, value);
  }

  let labels: string[];
  if (useDaily) {
    const mode = dataset.scope.axis === "watched-at" ? dataset.scope.dayBoundaryMode : "calendar";
    const start = toTaipeiDateKey(dataset.period.effectiveRange.startInclusive, mode);
    const end = toTaipeiDateKey(
      new Date(dataset.period.effectiveRange.endExclusive.getTime() - 1),
      mode
    );
    labels = [];
    for (let key = start; key <= end; key = addTaipeiCalendarDays(key, 1)) labels.push(key);
  } else {
    const mode = dataset.scope.axis === "watched-at" ? dataset.scope.dayBoundaryMode : "calendar";
    labels = monthLabelsBetween(
      toTaipeiDateKey(dataset.period.effectiveRange.startInclusive, mode).slice(0, 7),
      toTaipeiDateKey(new Date(dataset.period.effectiveRange.endExclusive.getTime() - 1), mode).slice(0, 7)
    );
  }

  return labels.map((label) => {
    const value = aggregates.get(label) ?? { count: 0, knownMinutes: 0, knownDurations: 0 };
    return {
      label,
      count: value.count,
      contentMinutes: value.knownDurations > 0 || value.count === 0 ? value.knownMinutes : null
    };
  });
};

const buildDailyCounts = (dataset: AnalysisDataset): readonly DailyCount[] => {
  const mode = dataset.scope.axis === "watched-at" ? dataset.scope.dayBoundaryMode : "calendar";
  const start = toTaipeiDateKey(dataset.period.effectiveRange.startInclusive, mode);
  const end = toTaipeiDateKey(new Date(dataset.period.effectiveRange.endExclusive.getTime() - 1), mode);
  const counts = new Map<string, number>();
  for (let key = start; key <= end; key = addTaipeiCalendarDays(key, 1)) counts.set(key, 0);
  for (const fact of dataset.selectedEvents) {
    const key = axisDateKey(fact, dataset.scope);
    const count = counts.get(key);
    if (count !== undefined) counts.set(key, count + 1);
  }
  return [...counts].map(([dateKey, count]) => ({ dateKey, count }));
};

const axisDateKey = (fact: WatchFact, scope: AnalysisScope): string => {
  if (scope.axis === "watched-at") return fact.entry.dateKey;
  if (!fact.releaseValid || fact.episode === null) {
    throw new Error("released-at 範圍內的觀看事實必須具備有效上架時間");
  }
  return toTaipeiDateKey(fact.episode.availableFrom);
};

const monthLabelsBetween = (start: string, end: string): string[] => {
  const labels: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    labels.push(cursor);
    const [yearText, monthText] = cursor.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
    cursor = `${String(next.year).padStart(4, "0")}-${String(next.month).padStart(2, "0")}`;
  }
  return labels;
};

const scheduleBoundaryMismatch = (fact: WatchFact): boolean => {
  if (!fact.releaseValid || !fact.episode || !fact.anime) return false;
  const dateKey = toTaipeiDateKey(fact.episode.availableFrom);
  return (fact.anime.seasonStartDateKey !== null && dateKey < fact.anime.seasonStartDateKey)
    || (fact.anime.seasonEndDateKey !== null && dateKey > fact.anime.seasonEndDateKey);
};

const historyCoversScope = (
  coverage: HistoryCoverage,
  period: ResolvedPeriod,
  asOf: Date
): boolean => {
  if (!coverage.complete || !validDate(coverage.coveredFrom) || !validDate(coverage.coveredThrough)) {
    return false;
  }
  const requiredEnd = period.scope.axis === "released-at"
    ? asOf.getTime()
    : period.effectiveRange.endExclusive.getTime() - 60_000;
  return coverage.coveredFrom.getTime() <= period.effectiveRange.startInclusive.getTime()
    && coverage.coveredThrough.getTime() >= requiredEnd;
};

const factFieldCoverage = (
  facts: readonly WatchFact[],
  available: (fact: WatchFact) => boolean,
  sourceComplete: boolean,
  threshold: number
): CoverageResult => coverageResult(facts.filter(available).length, facts.length, sourceComplete, threshold);

const eventFieldCoverage = factFieldCoverage;

const coverageResult = (
  numerator: number,
  denominator: number,
  sourceComplete: boolean,
  threshold: number
): CoverageResult => ({
  numerator,
  denominator,
  ratio: denominator === 0 ? null : numerator / denominator,
  passed: sourceComplete && denominator > 0 && numerator / denominator >= threshold
});

const validDuration = (episode: EpisodeMetadata | null): episode is EpisodeMetadata => episode !== null
  && Number.isSafeInteger(episode.durationMinutes)
  && episode.durationMinutes > 0;

const validCurrentPlatformSnapshot = (anime: AnimeMetadata): boolean =>
  Number.isFinite(anime.platformSnapshot.popular)
  && anime.platformSnapshot.popular >= 0
  && validDate(anime.platformSnapshot.observedAt);

const requiredMapValue = <K, V>(values: ReadonlyMap<K, V>, key: K, label: string): V => {
  const value = values.get(key);
  if (value === undefined) {
    throw new Error(`${label}缺少必要資料`);
  }
  return value;
};

const groupValidWatchesByAnime = (
  watches: readonly WatchFact[]
): ReadonlyMap<number, readonly WatchFact[]> => {
  const grouped = new Map<number, WatchFact[]>();
  for (const fact of watches) {
    if (!fact.releaseValid || fact.animeSn === null) continue;
    const group = grouped.get(fact.animeSn) ?? [];
    group.push(fact);
    grouped.set(fact.animeSn, group);
  }
  return grouped;
};

const buildChoiceBuckets = (facts: readonly WatchFact[]): readonly ChoiceBucket[] => {
  const buckets = new Map<number, WatchFact[]>();
  for (const fact of facts) {
    const value = buckets.get(fact.watchedMinute) ?? [];
    value.push(fact);
    buckets.set(fact.watchedMinute, value);
  }
  return Array.from(buckets, ([minute, watches]) => ({
    minute,
    watches: watches.slice().sort(compareEpisodeOrder)
  })).sort((left, right) => left.minute - right.minute);
};

const isBingeContinuation = (
  animeSn: number,
  minute: number,
  previousBucket: ChoiceBucket | undefined
): boolean => {
  if (!previousBucket || minute - previousBucket.minute > SHORT_BINGE_GAP_MINUTES) return false;
  if (previousBucket.watches.some((fact) => !fact.preferenceValid || fact.animeSn === null)) return false;
  return previousBucket.watches.some((fact) => fact.animeSn === animeSn);
};

const recordOutcome = (
  stats: Map<number, MutablePreferenceStats>,
  winnerAnimeSn: number,
  loserAnimeSn: number,
  decisionMinute: number
): void => {
  const winner = getPreferenceStats(stats, winnerAnimeSn);
  const loser = getPreferenceStats(stats, loserAnimeSn);
  winner.wins += 1;
  winner.opponents.add(loserAnimeSn);
  winner.decisions.add(decisionMinute);
  loser.losses += 1;
  loser.opponents.add(winnerAnimeSn);
  loser.decisions.add(decisionMinute);
};

const getPreferenceStats = (
  stats: Map<number, MutablePreferenceStats>,
  animeSn: number
): MutablePreferenceStats => {
  const existing = stats.get(animeSn);
  if (existing) return existing;
  const created = { wins: 0, losses: 0, opponents: new Set<number>(), decisions: new Set<number>() };
  stats.set(animeSn, created);
  return created;
};

const wilsonLower95 = (wins: number, total: number): number => {
  if (total <= 0) return 0;
  const probability = wins / total;
  const zSquared = Z_95 * Z_95;
  return (
    probability
    + zSquared / (2 * total)
    - Z_95 * Math.sqrt(probability * (1 - probability) / total + zSquared / (4 * total * total))
  ) / (1 + zSquared / total);
};

const median = (values: readonly number[]): number => {
  if (values.length === 0) throw new Error("無法計算空樣本的中位數");
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) throw new Error("中位數樣本索引超出範圍");
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[middle - 1];
  if (lower === undefined) throw new Error("中位數樣本索引超出範圍");
  return (lower + upper) / 2;
};

const assignRanks = <T extends object>(
  rows: readonly T[],
  tied: (left: T, right: T) => boolean
): readonly (T & { readonly rank: number })[] => {
  let rank = 0;
  return rows.map((row, index) => {
    const previous = index > 0 ? rows[index - 1] : undefined;
    if (!previous || !tied(previous, row)) rank = index + 1;
    return { ...row, rank };
  });
};

const comparePreferenceRows = (
  left: Omit<PreferenceRow, "rank">,
  right: Omit<PreferenceRow, "rank">
): number => {
  const scoreDifference = right.wilsonLower95 - left.wilsonLower95;
  if (Math.abs(scoreDifference) >= SCORE_TIE_EPSILON) return scoreDifference;
  return right.rawWinRate - left.rawWinRate
    || right.comparisons - left.comparisons
    || right.distinctOpponentCount - left.distinctOpponentCount
    || left.animeSn - right.animeSn;
};

const compareEpisodeOrder = (left: WatchFact, right: WatchFact): number =>
  (left.episode?.episodeIndex ?? Number.POSITIVE_INFINITY)
    - (right.episode?.episodeIndex ?? Number.POSITIVE_INFINITY)
  || (left.availableMinute ?? Number.POSITIVE_INFINITY)
    - (right.availableMinute ?? Number.POSITIVE_INFINITY)
  || left.entry.videoSn - right.entry.videoSn;

const releaseLagMinutes = (fact: WatchFact): number => {
  if (!fact.releaseValid || fact.availableMinute === null) {
    throw new Error("無效紀錄不可計算觀看延遲");
  }
  return fact.watchedMinute - fact.availableMinute;
};

const seasonIndex = (season: CalendarSeason): number =>
  season === "winter" ? 0 : season === "spring" ? 1 : season === "summer" ? 2 : 3;

const seasonName = (season: CalendarSeason): string =>
  season === "winter" ? "冬季" : season === "spring" ? "春季" : season === "summer" ? "夏季" : "秋季";

const toEpochMinute = (date: Date): number => Math.floor(date.getTime() / 60_000);
const validDate = (date: Date): boolean => date instanceof Date && Number.isFinite(date.getTime());
const positiveSafeInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

const assertValidDate = (date: Date, label: string): void => {
  if (!validDate(date)) throw new TypeError(`${label} 必須是有效日期`);
};
