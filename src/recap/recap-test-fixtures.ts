import type { AnalyticsResult, CoverageResult, DailyCount } from "../analytics";
import { analysisScopeKey, resolvePeriod, type AnalysisScope, type CalendarSeason, type ResolvedPeriod } from "../period";
import { addTaipeiCalendarDays } from "../time";

/** 回顧測試共用的分析結果樣本：2026 上架年度，含所有章節需要的資料。 */
export const instant = (value: string): Date => new Date(value);
export const cover = (name: string): string => `https://p2.bahamut.com.tw/${name}.JPG`;

export const coverage = (numerator: number, denominator = numerator, passed = true): CoverageResult => ({
  numerator,
  denominator,
  ratio: denominator === 0 ? null : numerator / denominator,
  passed
});

export const releaseYearScope = (): AnalysisScope => ({
  axis: "released-at",
  period: { kind: "calendar-year", year: 2026 }
});

export const watchedRollingYearScope = (): AnalysisScope => ({
  axis: "watched-at",
  dayBoundaryMode: "calendar",
  period: { kind: "rolling-days", days: 365 }
});

export const resolvedPeriod = (
  scope: AnalysisScope,
  label = "2026 年",
  status: ResolvedPeriod["periodStatus"] = "closed"
): ResolvedPeriod => {
  const period = scope.period;
  const constituentSeasons = period.kind === "calendar-year"
    ? (["winter", "spring", "summer", "autumn"] as const).map((season) => ({ year: period.year, season }))
    : period.kind === "calendar-season"
      ? [{ year: period.year, season: period.season }]
      : [];
  return {
    scope,
    key: analysisScopeKey(scope),
    label,
    periodStatus: status,
    fullRange: {
      startInclusive: instant("2026-01-01T00:00:00+08:00"),
      endExclusive: instant("2027-01-01T00:00:00+08:00")
    },
    effectiveRange: {
      startInclusive: instant("2026-01-01T00:00:00+08:00"),
      endExclusive: instant("2027-01-01T00:00:00+08:00")
    },
    constituentSeasons
  };
};

/** 從 startDateKey 起連續 dayCount 天；沒列出的日子為 0。 */
export const dailyCountsFrom = (
  startDateKey: string,
  dayCount: number,
  counts: Readonly<Record<string, number>>
): DailyCount[] => Array.from({ length: dayCount }, (_, index) => {
  const dateKey = addTaipeiCalendarDays(startDateKey, index);
  return { dateKey, count: counts[dateKey] ?? 0 };
});

export const seasonRow = (
  season: CalendarSeason,
  watchCount: number,
  contentMinutes: number
): AnalyticsResult["seasonBreakdown"][number] => ({
  year: 2026,
  season,
  label: `2026 ${season}`,
  watchCount,
  animeCount: watchCount === 0 ? 0 : Math.max(1, Math.ceil(watchCount / 2)),
  knownContentMinutes: contentMinutes,
  contentMinutes,
  durationCoverage: coverage(watchCount)
});

export const fullResult = (): AnalyticsResult => {
  const scope = releaseYearScope();
  return {
    scope,
    period: resolvedPeriod(scope),
    historyComplete: true,
    summary: {
      watchCount: 12,
      uniqueEpisodeCount: 12,
      animeCount: 3,
      activeDayCount: 9,
      knownContentMinutes: 366,
      contentMinutes: 366,
      durationCoverage: coverage(12),
      releaseCoverage: coverage(12),
      medianLagMinutes: 180,
      within24HoursCount: 9,
      within24HoursRate: 0.75,
      negativeLagCount: 0,
      unclassifiedCount: 0,
      scheduleBoundaryIssueCount: 1
    },
    rhythm: [
      { label: "2026-01", count: 2, contentMinutes: 70 },
      { label: "2026-07", count: 5, contentMinutes: 160 }
    ],
    dailyCounts: dailyCountsFrom("2026-01-01", 365, {
      "2026-01-10": 1,
      "2026-01-11": 1,
      "2026-07-01": 1,
      "2026-07-02": 1,
      "2026-07-03": 1,
      "2026-07-04": 4,
      "2026-07-10": 1,
      "2026-07-11": 1,
      "2026-07-12": 1
    }),
    seasonBreakdown: [
      seasonRow("winter", 3, 90),
      seasonRow("spring", 2, 50),
      seasonRow("summer", 5, 160),
      seasonRow("autumn", 2, 66)
    ],
    runtime: {
      available: true,
      coverage: coverage(12),
      rows: [
        {
          rank: 1,
          animeSn: 10,
          title: "作品 A",
          coverUrl: cover("anime-a"),
          watchCount: 6,
          contentMinutes: 210
        },
        {
          rank: 2,
          animeSn: 20,
          title: "作品 B",
          coverUrl: cover("anime-b"),
          watchCount: 4,
          contentMinutes: 100
        }
      ],
      longestEpisode: {
        videoSn: 101,
        animeSn: 10,
        title: "作品 A",
        episode: "完結篇",
        coverUrl: cover("episode-a"),
        durationMinutes: 89,
        watchedAt: instant("2026-07-14T10:00:00+08:00")
      }
    },
    catalog: {
      animeCoverage: coverage(3),
      tags: [
        { rank: 1, label: "懸疑", animeCount: 2, watchCount: 8, contentMinutes: 240 },
        { rank: 2, label: "動作", animeCount: 2, watchCount: 6, contentMinutes: 180 }
      ],
      makers: [
        { rank: 1, label: "Studio X", animeCount: 2, watchCount: 7, contentMinutes: 220 }
      ],
      directors: [
        { rank: 1, label: "導演 X", animeCount: 1, watchCount: 6, contentMinutes: 210 }
      ],
      publishers: [
        { rank: 1, label: "代理商 X", animeCount: 2, watchCount: 7, contentMinutes: 220 }
      ]
    },
    currentPlatformSnapshotComparison: {
      label: "目前平台快照",
      temporalBasis: "current-platform-snapshot",
      available: false,
      animeMetadataCoverage: coverage(3),
      rows: []
    },
    observedWatchedEpisodeReleaseFootprints: {
      observationBasis: "selected-watched-episodes-only",
      representsCompleteAiringStructure: false,
      rows: []
    },
    completion: {
      available: true,
      rows: [
        {
          animeSn: 10,
          title: "作品 A",
          coverUrl: cover("anime-a"),
          watchedEpisodeCount: 12,
          totalEpisode: 12,
          ratio: 1,
          isOngoing: false,
          outcome: "finished"
        },
        {
          animeSn: 20,
          title: "作品 B",
          coverUrl: cover("anime-b"),
          watchedEpisodeCount: 8,
          totalEpisode: 12,
          ratio: 2 / 3,
          isOngoing: false,
          outcome: "midway"
        }
      ],
      dropTags: []
    },
    binge: { available: false, rows: [] },
    habitClock: {
      available: true,
      hourCounts: Array.from({ length: 24 }, (_, hour) =>
        hour === 23 ? 5 : hour === 22 ? 3 : hour === 12 ? 4 : 0),
      peakHour: 23,
      peakHourCount: 5,
      segments: [
        { key: "morning", label: "清晨", startHour: 5, endHour: 11, watchCount: 0, share: 0 },
        { key: "daytime", label: "白天", startHour: 11, endHour: 17, watchCount: 4, share: 4 / 12 },
        { key: "evening", label: "晚間", startHour: 17, endHour: 23, watchCount: 3, share: 3 / 12 },
        { key: "late-night", label: "深夜", startHour: 23, endHour: 5, watchCount: 5, share: 5 / 12 }
      ],
      topSegment: { key: "late-night", label: "深夜", startHour: 23, endHour: 5, watchCount: 5, share: 5 / 12 },
      weekdayCounts: [0, 0, 0, 0, 0, 7, 5],
      topWeekday: { weekday: 5, label: "週五", watchCount: 7 }
    },
    marathon: {
      available: true,
      peakDay: { dateKey: "2026-07-04", watchCount: 6, knownContentMinutes: 144 },
      longestStreak: { days: 4, fromDateKey: "2026-07-01", toDateKey: "2026-07-04" },
      topSingleDayRun: {
        animeSn: 10,
        title: "作品 A",
        coverUrl: cover("anime-a"),
        dateKey: "2026-07-04",
        watchCount: 4
      }
    },
    timeliness: {
      available: true,
      coverage: coverage(12),
      rows: [
        {
          rank: 1,
          animeSn: 10,
          title: "作品 A",
          coverUrl: cover("anime-a"),
          sampleCount: 6,
          medianLagMinutes: 90,
          within24HoursCount: 6,
          within24HoursRate: 1
        },
        {
          rank: 2,
          animeSn: 20,
          title: "作品 B",
          coverUrl: cover("anime-b"),
          sampleCount: 4,
          medianLagMinutes: 240,
          within24HoursCount: 2,
          within24HoursRate: 0.5
        }
      ]
    },
    preference: {
      available: true,
      coverage: coverage(12),
      choiceEventCount: 8,
      rows: [
        {
          rank: 1,
          animeSn: 10,
          title: "作品 A",
          coverUrl: cover("anime-a"),
          wins: 9,
          losses: 1,
          comparisons: 10,
          rawWinRate: 0.9,
          wilsonLower95: 0.596,
          distinctOpponentCount: 4,
          decisionBucketCount: 6
        },
        {
          rank: 2,
          animeSn: 20,
          title: "作品 B",
          coverUrl: cover("anime-b"),
          wins: 5,
          losses: 5,
          comparisons: 10,
          rawWinRate: 0.5,
          wilsonLower95: 0.237,
          distinctOpponentCount: 4,
          decisionBucketCount: 5
        }
      ]
    },
    highlights: { newYearsEve: null, dawn: null, oldWorks: null },
    favorites: { seasons: [], hiddenGems: [] }
  };
};

/** A watched-month recap with a cross-month completion and a longer season. */
export const bingeResult = (): AnalyticsResult => {
  const scope: AnalysisScope = {
    axis: "watched-at",
    dayBoundaryMode: "calendar",
    period: { kind: "calendar-month", year: 2026, month: 7 }
  };
  return {
    ...fullResult(),
    scope,
    period: resolvePeriod(scope, instant("2026-08-01T00:00:00+08:00")),
    binge: {
      available: true,
      rows: [
        {
          rank: 1,
          animeSn: 40,
          title: "補番作品 B",
          coverUrl: cover("binge-b"),
          episodeCount: 24,
          startedAt: instant("2026-07-01T20:00:00+08:00"),
          completedAt: instant("2026-07-08T20:00:00+08:00"),
          elapsedMinutes: 7 * 24 * 60,
          spanDays: 8,
          activeDayCount: 6,
          episodesPerDay: 3
        },
        {
          rank: 2,
          animeSn: 30,
          title: "補番作品 A",
          coverUrl: cover("binge-a"),
          episodeCount: 12,
          startedAt: instant("2026-06-30T20:00:00+08:00"),
          completedAt: instant("2026-07-04T20:00:00+08:00"),
          elapsedMinutes: 4 * 24 * 60,
          spanDays: 5,
          activeDayCount: 3,
          episodesPerDay: 2.4
        }
      ]
    }
  };
};
