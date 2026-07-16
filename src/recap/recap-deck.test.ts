import { describe, expect, it } from "vitest";

import type { AnalyticsResult, CoverageResult } from "../analytics";
import { analysisScopeKey, type AnalysisScope, type CalendarSeason, type ResolvedPeriod } from "../period";
import {
  buildRecapDeck,
  type RecapPresentationChapter,
  type RecapPresentationDeck
} from "./recap-deck";
import { initialRecapUiState, reduceRecapUiState, type RecapUiState } from "./recap-state";

const instant = (value: string): Date => new Date(value);
const cover = (name: string): string => `https://p2.bahamut.com.tw/${name}.JPG`;

const coverage = (numerator: number, denominator = numerator, passed = true): CoverageResult => ({
  numerator,
  denominator,
  ratio: denominator === 0 ? null : numerator / denominator,
  passed
});

const releaseYearScope = (): AnalysisScope => ({
  axis: "released-at",
  period: { kind: "calendar-year", year: 2026 }
});

const watchedRollingYearScope = (): AnalysisScope => ({
  axis: "watched-at",
  dayBoundaryMode: "calendar",
  period: { kind: "rolling-days", days: 365 }
});

const resolvedPeriod = (
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

const seasonRow = (
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

const fullResult = (): AnalyticsResult => {
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
          ratio: 1
        },
        {
          animeSn: 20,
          title: "作品 B",
          coverUrl: cover("anime-b"),
          watchedEpisodeCount: 8,
          totalEpisode: 12,
          ratio: 2 / 3
        }
      ]
    },
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
    }
  };
};

const chapter = <Kind extends RecapPresentationChapter["kind"]>(
  deck: RecapPresentationDeck,
  kind: Kind
): Extract<RecapPresentationChapter, { readonly kind: Kind }> => {
  const value = deck.chapters.find((candidate) => candidate.kind === kind);
  if (!value || value.kind !== kind) throw new Error(`missing ${kind} chapter`);
  return value as Extract<RecapPresentationChapter, { readonly kind: Kind }>;
};

describe("recap presentation deck", () => {
  it("builds release-calendar-year chapters in presentation order", () => {
    const deck = buildRecapDeck(fullResult());
    expect(deck.chapters.map((item) => item.kind)).toEqual([
      "overview",
      "season-breakdown",
      "habit-clock",
      "marathon",
      "runtime",
      "taste",
      "completion",
      "timeliness",
      "behavior-preference"
    ]);
    expect(deck.scope).toMatchObject({
      key: "released-at:year:2026",
      axis: "released-at",
      period: { kind: "calendar-year", year: 2026 }
    });

    const overview = chapter(deck, "overview");
    expect(overview.payload).toMatchObject({ watchCount: 12, activeDayCount: 9 });

    const seasons = chapter(deck, "season-breakdown");
    expect(seasons.payload.leadingSeasons).toEqual(["summer"]);
    expect(seasons.payload.rows.map((row) => [row.season, row.watchCount])).toEqual([
      ["winter", 3],
      ["spring", 2],
      ["summer", 5],
      ["autumn", 2]
    ]);

    const runtime = chapter(deck, "runtime");
    expect(runtime.payload.totalContentMinutes).toBe(366);
    expect(runtime.payload.longestEpisode).toMatchObject({
      videoSn: 101,
      durationMinutes: 89,
      watchedAtIso: "2026-07-14T02:00:00.000Z"
    });
    expect(runtime.narrative).toContain("6 小時 6 分鐘");

    expect(chapter(deck, "timeliness").payload.rows[0]).toMatchObject({
      title: "作品 A",
      medianLagMinutes: 90
    });
    expect(chapter(deck, "behavior-preference").payload.rows[0]).toMatchObject({
      title: "作品 A",
      wins: 9,
      comparisons: 10
    });
    expect(chapter(deck, "taste").payload.tags[0]).toMatchObject({
      label: "懸疑",
      knownContentMinutes: 240
    });
  });

  it("uses the same insight chapters for a watched-at rolling 365-day recap", () => {
    const result = fullResult();
    const scope = watchedRollingYearScope();
    const watchedRollingYear: AnalyticsResult = {
      ...result,
      scope,
      period: resolvedPeriod(scope, "過去一年")
    };
    const deck = buildRecapDeck(watchedRollingYear);

    expect(deck.chapters.map((item) => item.kind)).toEqual([
      "overview",
      "habit-clock",
      "marathon",
      "runtime",
      "taste",
      "completion",
      "timeliness",
      "behavior-preference"
    ]);
    expect(deck.omissions).toContainEqual(expect.objectContaining({
      chapter: "season-breakdown",
      reason: "not-release-calendar-year"
    }));

  });

  it("keeps every tied leading release season in calendar order", () => {
    const result = fullResult();
    const tied: AnalyticsResult = {
      ...result,
      seasonBreakdown: [
        seasonRow("winter", 4, 90),
        seasonRow("spring", 2, 50),
        seasonRow("summer", 4, 160),
        seasonRow("autumn", 2, 66)
      ]
    };
    const seasons = chapter(buildRecapDeck(tied), "season-breakdown");

    expect(seasons.payload.leadingSeasons).toEqual(["winter", "summer"]);
    expect(seasons.narrative).toBe("各有 4 次觀看。");
  });

  it("deep-freezes the complete presentation graph and detaches it from source rows", () => {
    const source = fullResult();
    const deck = buildRecapDeck(source);
    expect(Object.isFrozen(deck)).toBe(true);
    expect(Object.isFrozen(deck.scope)).toBe(true);
    expect(Object.isFrozen(deck.chapters)).toBe(true);
    expect(Object.isFrozen(deck.chapters[0])).toBe(true);
    expect(Object.isFrozen(deck.chapters[0]?.payload)).toBe(true);
    expect(Object.isFrozen(deck.chapters[0]?.evidence)).toBe(true);
    expect(Object.isFrozen(deck.omissions)).toBe(true);

    const mutableRows = source.runtime.rows as Array<AnalyticsResult["runtime"]["rows"][number]>;
    mutableRows[0] = { ...mutableRows[0]!, title: "被外部改寫" };
    expect(chapter(deck, "runtime").payload.rows[0]?.title).toBe("作品 A");
  });

  it("preserves typed chapter payloads when the state reducer snapshots the deck", () => {
    const deck = buildRecapDeck(fullResult());
    let state: RecapUiState<RecapPresentationDeck> = initialRecapUiState;
    state = reduceRecapUiState(state, { type: "OPEN", surface: "recap" });
    state = reduceRecapUiState(state, { type: "START_RECAP", deck });
    expect(state.kind).toBe("recap-chapter");
    if (state.kind !== "recap-chapter") throw new Error("expected recap chapter");
    expect(state.deck.chapters[0]?.kind).toBe("overview");
    expect(chapter(state.deck, "overview").payload.watchCount).toBe(12);
  });
});

describe("scope-aware chapters", () => {
  it("uses the same builder for a season but never invents a four-season breakdown", () => {
    const result = fullResult();
    const scope: AnalysisScope = {
      axis: "released-at",
      period: { kind: "calendar-season", year: 2026, season: "summer" }
    };
    const seasonal: AnalyticsResult = {
      ...result,
      scope,
      period: resolvedPeriod(scope, "2026 年夏季")
    };
    const deck = buildRecapDeck(seasonal);
    expect(deck.chapters.some((item) => item.kind === "season-breakdown")).toBe(false);
    expect(deck.chapters.some((item) => item.kind === "runtime")).toBe(true);
    expect(deck.omissions).toContainEqual(expect.objectContaining({
      chapter: "season-breakdown",
      reason: "not-release-calendar-year"
    }));
  });

  it("does not call watched-at calendar-year rows a release-year four-season union", () => {
    const result = fullResult();
    const scope: AnalysisScope = {
      axis: "watched-at",
      dayBoundaryMode: "calendar",
      period: { kind: "calendar-year", year: 2026 }
    };
    const watched: AnalyticsResult = {
      ...result,
      scope,
      period: resolvedPeriod(scope, "2026 年")
    };
    const deck = buildRecapDeck(watched);
    expect(deck.chapters.some((item) => item.kind === "season-breakdown")).toBe(false);
  });

  it("keeps a useful annual breakdown when some episodes cannot be assigned to a season", () => {
    const result = fullResult();
    const inconsistent: AnalyticsResult = {
      ...result,
      seasonBreakdown: result.seasonBreakdown.map((row) => row.season === "summer"
        ? { ...row, watchCount: row.watchCount - 1 }
        : row)
    };
    const deck = buildRecapDeck(inconsistent);
    expect(chapter(deck, "season-breakdown").payload.rows.map((row) => row.watchCount)).toEqual([3, 2, 4, 2]);
  });
});

describe("evidence gates", () => {
  it("shows runtime from known episodes without extrapolating missing duration", () => {
    const result = fullResult();
    const partial: AnalyticsResult = {
      ...result,
      summary: {
        ...result.summary,
        knownContentMinutes: 300,
        contentMinutes: null,
        durationCoverage: coverage(11, 12, false)
      },
      seasonBreakdown: result.seasonBreakdown.map((row) => row.season === "autumn"
        ? { ...row, contentMinutes: null, durationCoverage: coverage(1, 2, false) }
        : row),
      runtime: {
        ...result.runtime,
        available: true,
        coverage: coverage(11, 12, false),
      }
    };
    const deck = buildRecapDeck(partial);
    const runtime = chapter(deck, "runtime");
    expect(runtime.payload.totalContentMinutes).toBe(300);
    expect(runtime.narrative).toContain("5 小時");
    expect(chapter(deck, "season-breakdown").payload.rows.find(
      (row) => row.season === "autumn"
    )?.contentMinutes).toBeNull();
  });

  it("independently omits insights with no usable rows", () => {
    const result = fullResult();
    const gated: AnalyticsResult = {
      ...result,
      catalog: {
        animeCoverage: coverage(2, 3, false),
        tags: [],
        makers: [],
        directors: [],
        publishers: []
      },
      completion: { available: false, rows: [] },
      habitClock: {
        available: false,
        hourCounts: Array.from({ length: 24 }, () => 0),
        peakHour: null,
        peakHourCount: 0,
        segments: [],
        topSegment: null,
        weekdayCounts: Array.from({ length: 7 }, () => 0),
        topWeekday: null
      },
      marathon: { available: false, peakDay: null, longestStreak: null, topSingleDayRun: null },
      timeliness: { available: false, coverage: coverage(8, 12, false), rows: [] },
      preference: {
        available: false,
        coverage: coverage(8, 12, false),
        choiceEventCount: 0,
        rows: []
      }
    };
    const deck = buildRecapDeck(gated);
    expect(deck.chapters.map((item) => item.kind)).toEqual([
      "overview",
      "season-breakdown",
      "runtime"
    ]);
    expect(deck.omissions.map((item) => [item.chapter, item.reason])).toEqual(expect.arrayContaining([
      ["timeliness", "insufficient-timeliness"],
      ["behavior-preference", "insufficient-preference"],
      ["taste", "no-taste-dimensions"]
    ]));
  });

  it("does not suppress factual chapters when history or metadata coverage is partial", () => {
    const result = fullResult();
    const deck = buildRecapDeck({
      ...result,
      historyComplete: false,
      summary: {
        ...result.summary,
        durationCoverage: coverage(6, 12, false),
        releaseCoverage: coverage(6, 12, false)
      },
      runtime: { ...result.runtime, coverage: coverage(6, 12, false) },
      catalog: { ...result.catalog, animeCoverage: coverage(2, 3, false) },
      timeliness: { ...result.timeliness, coverage: coverage(6, 12, false) },
      preference: { ...result.preference, coverage: coverage(6, 12, false) }
    });

    expect(deck.chapters.map((item) => item.kind)).toEqual([
      "overview",
      "season-breakdown",
      "habit-clock",
      "marathon",
      "runtime",
      "taste",
      "completion",
      "timeliness",
      "behavior-preference"
    ]);
  });
});

describe("fingerprint", () => {
  it("is deterministic for equal analytics values", () => {
    const first = buildRecapDeck(fullResult());
    const second = buildRecapDeck(fullResult());
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprint).toMatch(/^recap-v4:[a-f0-9]{64}$/);
  });

  it("changes for substantive analytic and metadata-derived presentation changes", () => {
    const baseline = fullResult();
    const baselineFingerprint = buildRecapDeck(baseline).fingerprint;

    const runtimeChanged: AnalyticsResult = {
      ...fullResult(),
      summary: { ...fullResult().summary, contentMinutes: 367, knownContentMinutes: 367 }
    };
    expect(buildRecapDeck(runtimeChanged).fingerprint).not.toBe(baselineFingerprint);

    const coverResult = fullResult();
    const coverChanged: AnalyticsResult = {
      ...coverResult,
      runtime: {
        ...coverResult.runtime,
        rows: coverResult.runtime.rows.map((row, index) => index === 0
          ? { ...row, coverUrl: cover("new-cover") }
          : row)
      }
    };
    expect(buildRecapDeck(coverChanged).fingerprint).not.toBe(baselineFingerprint);

    const tagResult = fullResult();
    const tagChanged: AnalyticsResult = {
      ...tagResult,
      catalog: {
        ...tagResult.catalog,
        tags: tagResult.catalog.tags.map((row, index) => index === 0
          ? { ...row, label: "科幻" }
          : row)
      }
    };
    expect(buildRecapDeck(tagChanged).fingerprint).not.toBe(baselineFingerprint);

    const rhythmResult = fullResult();
    const rhythmChanged: AnalyticsResult = {
      ...rhythmResult,
      rhythm: rhythmResult.rhythm.map((point, index) => index === 0
        ? { ...point, count: point.count + 1 }
        : point)
    };
    expect(buildRecapDeck(rhythmChanged).fingerprint).toBe(baselineFingerprint);
  });
});
