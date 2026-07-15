import { describe, expect, it } from "vitest";

import {
  analyzeWatchHistory,
  type HistoryCoverage
} from "./analytics";
import type {
  AnimeMetadata,
  EpisodeMetadata,
  EpisodeRef,
  WatchEntry
} from "./model";
import type { AnalysisScope, CalendarSeason } from "./period";
import { toTaipeiDateKey } from "./time";

const instant = (value: string): Date => new Date(value);
const observedAt = instant("2026-07-14T00:00:00+08:00");

const entry = (
  videoSn: number,
  watchedAt: string,
  title: string,
  dateKey = toTaipeiDateKey(instant(watchedAt))
): WatchEntry => ({
  videoSn,
  watchedAt: instant(watchedAt),
  dateKey,
  title,
  episode: `第 ${videoSn} 集`
});

const episode = (
  videoSn: number,
  animeSn: number,
  episodeIndex: number,
  availableFrom: string,
  durationMinutes = 24,
  overrides: Partial<Pick<EpisodeMetadata, "groupKey" | "availableUntil">> = {}
): EpisodeMetadata => ({
  videoSn,
  animeSn,
  groupKey: "0",
  episodeIndex,
  episodeNumber: episodeIndex + 1,
  availableFrom: instant(availableFrom),
  availableUntil: null,
  durationMinutes,
  coverUrl: `https://p2.bahamut.com.tw/B/2KU/${videoSn}.JPG`,
  videoType: 0,
  fetchedAt: observedAt,
  ...overrides
});

const animeRecord = (
  animeSn: number,
  references: readonly EpisodeRef[],
  overrides: Partial<AnimeMetadata> = {}
): AnimeMetadata => ({
  animeSn,
  apiTitle: `API title ${animeSn}`,
  totalEpisode: references.length,
  seasonStartDateKey: "2026-01-01",
  seasonEndDateKey: "2026-12-31",
  coverUrl: `https://p2.bahamut.com.tw/B/ACG/${animeSn}.JPG`,
  tags: ["動畫", "冒險"],
  maker: "Studio Example",
  director: "Director Example",
  publisher: "Publisher Example",
  episodeRefs: references,
  platformSnapshot: {
    score: 4.8,
    reviewCount: 100,
    popular: 1000,
    observedAt
  },
  fetchedAt: observedAt,
  ...overrides
});

const ref = (videoSn: number, episodeNumber: number, groupKey = "0"): EpisodeRef => ({
  videoSn,
  episodeNumber,
  groupKey,
  coverUrl: `https://p2.bahamut.com.tw/B/2KU/${videoSn}.JPG`
});

const completeCoverage = (
  from = "2025-01-01T00:00:00+08:00",
  through = "2026-12-31T23:59:00+08:00"
): HistoryCoverage => ({
  coveredFrom: instant(from),
  coveredThrough: instant(through),
  complete: true
});

const watchedScope = (
  period: AnalysisScope["period"] = { kind: "calendar-month", year: 2026, month: 7 }
): AnalysisScope => ({ axis: "watched-at", dayBoundaryMode: "calendar", period });

const releasedScope = (
  period: AnalysisScope["period"]
): AnalysisScope => ({ axis: "released-at", period });

const analyze = ({
  entries,
  episodeRecords,
  animeRecords = [],
  scope = watchedScope(),
  asOf = instant("2026-07-31T23:59:00+08:00"),
  historyCoverage = completeCoverage()
}: {
  readonly entries: readonly WatchEntry[];
  readonly episodeRecords: readonly EpisodeMetadata[];
  readonly animeRecords?: readonly AnimeMetadata[];
  readonly scope?: AnalysisScope;
  readonly asOf?: Date;
  readonly historyCoverage?: HistoryCoverage;
}) => analyzeWatchHistory({
  entries,
  episodes: new Map(episodeRecords.map((record) => [record.videoSn, record])),
  anime: new Map(animeRecords.map((record) => [record.animeSn, record])),
  historyCoverage,
  scope,
  asOf
});

describe("volume, duration, and metadata dimensions", () => {
  it("counts watch events, unique episodes, and exact content duration separately", () => {
    const records = [episode(1, 10, 0, "2026-07-01T08:00:00+08:00", 47)];
    const anime = animeRecord(10, [ref(1, 1)]);
    const result = analyze({
      entries: [
        entry(1, "2026-07-02T10:00:00+08:00", "作品 A"),
        entry(1, "2026-07-03T10:00:00+08:00", "作品 A")
      ],
      episodeRecords: records,
      animeRecords: [anime]
    });

    expect(result.summary).toMatchObject({
      watchCount: 2,
      uniqueEpisodeCount: 1,
      animeCount: 1,
      knownContentMinutes: 94,
      contentMinutes: 94
    });
    expect(result.summary.durationCoverage).toEqual({
      numerator: 2,
      denominator: 2,
      ratio: 1,
      passed: true
    });
    expect(result.runtime.rows[0]).toMatchObject({ animeSn: 10, watchCount: 2, contentMinutes: 94 });
    expect(result.runtime.longestEpisode).toMatchObject({ videoSn: 1, durationMinutes: 47 });
  });

  it("never extrapolates exact duration when one selected watch lacks metadata", () => {
    const result = analyze({
      entries: [
        entry(1, "2026-07-02T10:00:00+08:00", "A"),
        entry(2, "2026-07-03T10:00:00+08:00", "B")
      ],
      episodeRecords: [episode(1, 10, 0, "2026-07-01T08:00:00+08:00", 47)]
    });

    expect(result.summary.knownContentMinutes).toBe(47);
    expect(result.summary.contentMinutes).toBeNull();
    expect(result.runtime).toMatchObject({
      available: true,
      rows: [{ animeSn: 10, watchCount: 1, contentMinutes: 47 }],
      longestEpisode: { videoSn: 1, durationMinutes: 47 }
    });
  });

  it("builds tag, maker, director, publisher, and verified completion results from anime metadata", () => {
    const references = [ref(1, 1), ref(2, 2), ref(3, 3)];
    const anime = animeRecord(10, references, {
      tags: ["懸疑", "動作"],
      maker: "Studio X",
      director: "導演 X",
      publisher: "代理商 X"
    });
    const result = analyze({
      entries: [
        entry(1, "2026-07-02T10:00:00+08:00", "作品 A"),
        entry(2, "2026-07-03T10:00:00+08:00", "作品 A")
      ],
      episodeRecords: [
        episode(1, 10, 0, "2026-07-01T08:00:00+08:00"),
        episode(2, 10, 1, "2026-07-02T08:00:00+08:00")
      ],
      animeRecords: [anime]
    });

    expect(result.catalog.tags.map((row) => row.label)).toEqual(["動作", "懸疑"]);
    expect(result.catalog.makers[0]).toMatchObject({ label: "Studio X", watchCount: 2 });
    expect(result.catalog.directors[0]).toMatchObject({ label: "導演 X", watchCount: 2 });
    expect(result.catalog.publishers[0]).toMatchObject({ label: "代理商 X", watchCount: 2 });
    expect(result.completion.rows[0]).toMatchObject({
      animeSn: 10,
      watchedEpisodeCount: 2,
      totalEpisode: 3,
      ratio: 2 / 3
    });
  });

  it("compares personal watch volume only with explicitly current platform snapshots", () => {
    const animeA = animeRecord(10, [ref(1, 1)], {
      platformSnapshot: { score: 4.8, reviewCount: 10, popular: 100, observedAt }
    });
    const animeB = animeRecord(20, [ref(2, 1)], {
      platformSnapshot: { score: 4.7, reviewCount: 20, popular: 300, observedAt }
    });
    const animeC = animeRecord(30, [ref(3, 1)], {
      platformSnapshot: { score: 4.6, reviewCount: 30, popular: 200, observedAt }
    });
    const result = analyze({
      entries: [
        entry(1, "2026-07-02T10:00:00+08:00", "A"),
        entry(1, "2026-07-03T10:00:00+08:00", "A"),
        entry(1, "2026-07-04T10:00:00+08:00", "A"),
        entry(2, "2026-07-05T10:00:00+08:00", "B"),
        entry(2, "2026-07-06T10:00:00+08:00", "B"),
        entry(3, "2026-07-07T10:00:00+08:00", "C")
      ],
      episodeRecords: [
        episode(1, 10, 0, "2026-07-01T08:00:00+08:00"),
        episode(2, 20, 0, "2026-07-01T08:00:00+08:00"),
        episode(3, 30, 0, "2026-07-01T08:00:00+08:00")
      ],
      animeRecords: [animeA, animeB, animeC]
    });

    expect(result.currentPlatformSnapshotComparison).toMatchObject({
      label: "目前平台快照",
      temporalBasis: "current-platform-snapshot",
      available: true,
      animeMetadataCoverage: {
        numerator: 3,
        denominator: 3,
        ratio: 1,
        passed: true
      }
    });
    expect(result.currentPlatformSnapshotComparison.rows.map((row) => ({
      animeSn: row.animeSn,
      personalRank: row.personalWatchRank,
      personalWatches: row.personalWatchCount,
      platformRank: row.platformPopularityRankWithinCoveredAnime,
      popular: row.platformPopular
    }))).toEqual([
      { animeSn: 10, personalRank: 1, personalWatches: 3, platformRank: 3, popular: 100 },
      { animeSn: 20, personalRank: 2, personalWatches: 2, platformRank: 1, popular: 300 },
      { animeSn: 30, personalRank: 3, personalWatches: 1, platformRank: 2, popular: 200 }
    ]);
    expect(result.currentPlatformSnapshotComparison.rows[0]?.platformSnapshotObservedAt.toISOString())
      .toBe(observedAt.toISOString());
    expect(result.currentPlatformSnapshotComparison.rows[0]?.platformSnapshotObservedAt)
      .not.toBe(animeA.platformSnapshot.observedAt);
  });

  it("compares the anime with known platform snapshots even below 90% metadata coverage", () => {
    const entries = Array.from({ length: 10 }, (_, offset) => entry(
      offset + 1,
      `2026-07-${String(offset + 1).padStart(2, "0")}T10:00:00+08:00`,
      `作品 ${offset + 1}`
    ));
    const episodeRecords = entries.map((watch, offset) => episode(
      watch.videoSn,
      offset + 1,
      0,
      "2026-07-01T08:00:00+08:00"
    ));
    const animeRecords = episodeRecords.slice(0, 8).map((record) =>
      animeRecord(record.animeSn, [ref(record.videoSn, 1)]));
    const result = analyze({ entries, episodeRecords, animeRecords });

    expect(result.currentPlatformSnapshotComparison).toMatchObject({
      label: "目前平台快照",
      temporalBasis: "current-platform-snapshot",
      available: true,
      animeMetadataCoverage: {
        numerator: 8,
        denominator: 10,
        ratio: 0.8,
        passed: false
      }
    });
    expect(result.currentPlatformSnapshotComparison.rows).toHaveLength(8);

    const exactThreshold = analyze({
      entries,
      episodeRecords,
      animeRecords: [
        ...animeRecords,
        animeRecord(episodeRecords[8]!.animeSn, [ref(episodeRecords[8]!.videoSn, 1)])
      ]
    });
    expect(exactThreshold.currentPlatformSnapshotComparison.animeMetadataCoverage).toEqual({
      numerator: 9,
      denominator: 10,
      ratio: 0.9,
      passed: true
    });
    expect(exactThreshold.currentPlatformSnapshotComparison.available).toBe(true);
    expect(exactThreshold.currentPlatformSnapshotComparison.rows).toHaveLength(9);
  });

  it("does not claim a completion denominator for multi-group episode indexes", () => {
    const anime = animeRecord(10, [ref(1, 1, "0"), ref(2, 1, "1")]);
    const result = analyze({
      entries: [entry(1, "2026-07-02T10:00:00+08:00", "作品 A")],
      episodeRecords: [episode(1, 10, 0, "2026-07-01T08:00:00+08:00")],
      animeRecords: [anime]
    });
    expect(result.completion).toEqual({ available: false, rows: [] });
  });

  it.each([
    ["missing number", [ref(1, 1), ref(3, 3)]],
    ["out-of-range number", [ref(1, 1), ref(2, 2), ref(4, 4)]]
  ] as const)("does not verify a completion denominator with a %s", (_label, references) => {
    const result = analyze({
      entries: [entry(1, "2026-07-02T10:00:00+08:00", "作品 A")],
      episodeRecords: [episode(1, 10, 0, "2026-07-01T08:00:00+08:00")],
      animeRecords: [animeRecord(10, references, { totalEpisode: 3 })]
    });

    expect(result.completion).toEqual({ available: false, rows: [] });
  });
});

describe("release seasons and annual union", () => {
  it("classifies a cross-season work by each episode upTime and deduplicates annual anime count", () => {
    const records = [
      episode(1, 10, 0, "2026-01-07T01:00:00+08:00", 47),
      episode(2, 10, 1, "2026-03-18T01:00:00+08:00", 23),
      episode(3, 10, 2, "2026-07-13T01:00:00+08:00", 89)
    ];
    const entries = [
      entry(1, "2026-01-08T10:00:00+08:00", "跨季作品"),
      entry(2, "2026-03-19T10:00:00+08:00", "跨季作品"),
      entry(3, "2026-07-14T10:00:00+08:00", "跨季作品")
    ];
    const anime = animeRecord(10, [ref(1, 1), ref(2, 2), ref(3, 3)], {
      seasonStartDateKey: "2026-01-07",
      seasonEndDateKey: "2026-07-27"
    });
    const asOf = instant("2026-12-31T23:59:00+08:00");
    const annual = analyze({
      entries,
      episodeRecords: records,
      animeRecords: [anime],
      scope: releasedScope({ kind: "calendar-year", year: 2026 }),
      asOf
    });
    const winter = analyze({
      entries,
      episodeRecords: records,
      animeRecords: [anime],
      scope: releasedScope({ kind: "calendar-season", year: 2026, season: "winter" }),
      asOf
    });
    const summer = analyze({
      entries,
      episodeRecords: records,
      animeRecords: [anime],
      scope: releasedScope({ kind: "calendar-season", year: 2026, season: "summer" }),
      asOf
    });

    expect(winter.summary.watchCount).toBe(2);
    expect(summer.summary.watchCount).toBe(1);
    expect(annual.summary.watchCount).toBe(winter.summary.watchCount + summer.summary.watchCount);
    expect(annual.summary.animeCount).toBe(1);
    expect(annual.summary.contentMinutes).toBe(159);
    expect(annual.seasonBreakdown.map((row) => [row.season, row.watchCount])).toEqual([
      ["winter", 2],
      ["spring", 0],
      ["summer", 1],
      ["autumn", 0]
    ]);
    expect(annual.observedWatchedEpisodeReleaseFootprints).toMatchObject({
      observationBasis: "selected-watched-episodes-only",
      representsCompleteAiringStructure: false
    });
    expect(annual.observedWatchedEpisodeReleaseFootprints.rows[0]).toMatchObject({
      animeSn: 10,
      identifiedWatchedEpisodeCount: 3,
      knownReleaseEpisodeCount: 3,
      releaseCoverage: {
        numerator: 3,
        denominator: 3,
        ratio: 1,
        passed: true
      },
      observedReleaseSeasons: [
        { year: 2026, season: "winter", knownReleaseEpisodeCount: 2 },
        { year: 2026, season: "summer", knownReleaseEpisodeCount: 1 }
      ]
    });
  });

  it("keeps release-season footprint boundaries exact at Taipei midnight", () => {
    const records = [
      episode(1, 10, 0, "2026-03-31T23:59:00+08:00"),
      episode(2, 10, 1, "2026-04-01T00:00:00+08:00")
    ];
    const result = analyze({
      entries: [
        entry(1, "2026-04-01T01:00:00+08:00", "季度邊界"),
        entry(2, "2026-04-01T02:00:00+08:00", "季度邊界")
      ],
      episodeRecords: records,
      animeRecords: [animeRecord(10, [ref(1, 1), ref(2, 2)])],
      scope: releasedScope({ kind: "calendar-year", year: 2026 }),
      asOf: instant("2026-12-31T23:59:00+08:00")
    });

    expect(result.observedWatchedEpisodeReleaseFootprints.rows[0]?.observedReleaseSeasons).toEqual([
      { year: 2026, season: "winter", label: "2026 冬季", knownReleaseEpisodeCount: 1 },
      { year: 2026, season: "spring", label: "2026 春季", knownReleaseEpisodeCount: 1 }
    ]);
  });

  it("reports per-series known release coverage without filling from anime season dates", () => {
    const result = analyze({
      entries: [
        entry(1, "2026-07-02T10:00:00+08:00", "部分可分類"),
        entry(2, "2026-07-03T10:00:00+08:00", "部分可分類")
      ],
      episodeRecords: [
        episode(1, 10, 0, "2026-07-01T08:00:00+08:00"),
        episode(2, 10, 1, "2026-07-20T08:00:00+08:00")
      ],
      animeRecords: [animeRecord(10, [ref(1, 1), ref(2, 2)], {
        seasonStartDateKey: "2026-01-01",
        seasonEndDateKey: "2026-12-31"
      })]
    });

    expect(result.observedWatchedEpisodeReleaseFootprints.rows[0]).toMatchObject({
      observationBasis: "selected-watched-episodes-only",
      representsCompleteAiringStructure: false,
      identifiedWatchedEpisodeCount: 2,
      knownReleaseEpisodeCount: 1,
      releaseCoverage: {
        numerator: 1,
        denominator: 2,
        ratio: 0.5,
        passed: false
      },
      observedReleaseSeasons: [
        { year: 2026, season: "summer", knownReleaseEpisodeCount: 1 }
      ]
    });
  });

  it("keeps missing and release-after-watch facts unclassified instead of guessing from anime dates", () => {
    const records = [episode(1, 10, 0, "2026-07-20T08:00:00+08:00")];
    const anime = animeRecord(10, [ref(1, 1)], {
      seasonStartDateKey: "2026-07-01",
      seasonEndDateKey: "2026-09-30"
    });
    const result = analyze({
      entries: [
        entry(1, "2026-07-10T10:00:00+08:00", "重新上架"),
        entry(2, "2026-07-11T10:00:00+08:00", "缺資料")
      ],
      episodeRecords: records,
      animeRecords: [anime],
      scope: releasedScope({ kind: "calendar-season", year: 2026, season: "summer" }),
      asOf: instant("2026-09-30T23:59:00+08:00")
    });

    expect(result.summary.watchCount).toBe(0);
    expect(result.summary.unclassifiedCount).toBe(2);
    expect(result.summary.releaseCoverage).toEqual({
      numerator: 0,
      denominator: 2,
      ratio: 0,
      passed: false
    });
  });

  it("uses seasonStart/end only as mismatch evidence", () => {
    const record = episode(1, 10, 0, "2026-07-13T01:00:00+08:00");
    const anime = animeRecord(10, [ref(1, 1)], {
      seasonStartDateKey: "2026-01-01",
      seasonEndDateKey: "2026-03-31"
    });
    const result = analyze({
      entries: [entry(1, "2026-07-14T10:00:00+08:00", "分段作品")],
      episodeRecords: [record],
      animeRecords: [anime],
      scope: releasedScope({ kind: "calendar-season", year: 2026, season: "summer" }),
      asOf: instant("2026-09-30T23:59:00+08:00")
    });
    expect(result.summary.watchCount).toBe(1);
    expect(result.summary.scheduleBoundaryIssueCount).toBe(1);
    expect(result.seasonBreakdown.find((row) => row.season === "summer")?.watchCount).toBe(1);
  });
});

describe("axis-specific active days and rhythm", () => {
  it("groups a release-month scope by Taipei release day instead of watch day", () => {
    const result = analyze({
      entries: [
        entry(1, "2026-07-20T10:00:00+08:00", "作品 A"),
        entry(2, "2026-07-21T10:00:00+08:00", "作品 A"),
        entry(3, "2026-07-22T10:00:00+08:00", "作品 B")
      ],
      episodeRecords: [
        episode(1, 10, 0, "2026-07-02T23:59:00+08:00", 20),
        episode(2, 10, 1, "2026-07-02T00:00:00+08:00", 24),
        episode(3, 20, 0, "2026-07-04T08:00:00+08:00", 30)
      ],
      scope: releasedScope({ kind: "calendar-month", year: 2026, month: 7 }),
      asOf: instant("2026-07-31T23:59:00+08:00")
    });

    expect(result.summary.activeDayCount).toBe(2);
    expect(result.rhythm).toHaveLength(31);
    expect(result.rhythm[0]).toEqual({ label: "2026-07-01", count: 0, contentMinutes: 0 });
    expect(result.rhythm.find((point) => point.label === "2026-07-02"))
      .toEqual({ label: "2026-07-02", count: 2, contentMinutes: 44 });
    expect(result.rhythm.find((point) => point.label === "2026-07-04"))
      .toEqual({ label: "2026-07-04", count: 1, contentMinutes: 30 });
    expect(result.rhythm.find((point) => point.label === "2026-07-20")?.count).toBe(0);
    expect(result.rhythm.at(-1)?.label).toBe("2026-07-31");
  });

  it("keeps a rolling 30-day release scope daily and includes every zero-value date", () => {
    const result = analyze({
      entries: [
        entry(1, "2026-07-01T10:00:00+08:00", "作品 A"),
        entry(2, "2026-07-14T10:00:00+08:00", "作品 B")
      ],
      episodeRecords: [
        episode(1, 10, 0, "2026-06-15T00:00:00+08:00"),
        episode(2, 20, 0, "2026-07-14T00:00:00+08:00")
      ],
      scope: releasedScope({ kind: "rolling-days", days: 30 }),
      asOf: instant("2026-07-14T12:00:00+08:00")
    });

    expect(result.summary.activeDayCount).toBe(2);
    expect(result.rhythm).toHaveLength(30);
    expect(result.rhythm[0]).toMatchObject({ label: "2026-06-15", count: 1 });
    expect(result.rhythm[1]).toEqual({ label: "2026-06-16", count: 0, contentMinutes: 0 });
    expect(result.rhythm.at(-1)).toMatchObject({ label: "2026-07-14", count: 1 });
  });

  it("groups longer release scopes monthly and includes every zero-value month", () => {
    const result = analyze({
      entries: [
        entry(1, "2026-07-20T10:00:00+08:00", "作品 A"),
        entry(2, "2026-07-21T10:00:00+08:00", "作品 B")
      ],
      episodeRecords: [
        episode(1, 10, 0, "2026-02-28T23:59:00+08:00", 20),
        episode(2, 20, 0, "2026-04-01T00:00:00+08:00", 30)
      ],
      scope: releasedScope({ kind: "calendar-year", year: 2026 }),
      asOf: instant("2026-12-31T23:59:00+08:00")
    });

    expect(result.summary.activeDayCount).toBe(2);
    expect(result.rhythm).toHaveLength(12);
    expect(result.rhythm.map((point) => point.label)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"
    ]);
    expect(result.rhythm[1]).toEqual({ label: "2026-02", count: 1, contentMinutes: 20 });
    expect(result.rhythm[2]).toEqual({ label: "2026-03", count: 0, contentMinutes: 0 });
    expect(result.rhythm[3]).toEqual({ label: "2026-04", count: 1, contentMinutes: 30 });
    expect(result.rhythm[6]?.count).toBe(0);
  });

  it("keeps watched-at active days and daily rhythm on the selected date-key convention", () => {
    const firstWatch = instant("2026-07-02T02:00:00+08:00");
    const secondWatch = instant("2026-07-02T07:00:00+08:00");
    const result = analyze({
      entries: [
        entry(1, firstWatch.toISOString(), "作品 A", toTaipeiDateKey(firstWatch, "thirty-hour")),
        entry(2, secondWatch.toISOString(), "作品 B", toTaipeiDateKey(secondWatch, "thirty-hour"))
      ],
      episodeRecords: [
        episode(1, 10, 0, "2026-07-01T00:00:00+08:00"),
        episode(2, 20, 0, "2026-07-01T00:00:00+08:00")
      ],
      scope: {
        axis: "watched-at",
        dayBoundaryMode: "thirty-hour",
        period: { kind: "calendar-month", year: 2026, month: 7 }
      },
      asOf: instant("2026-07-31T23:59:00+08:00")
    });

    expect(result.summary.activeDayCount).toBe(2);
    expect(result.rhythm).toHaveLength(31);
    expect(result.rhythm.find((point) => point.label === "2026-07-01")?.count).toBe(1);
    expect(result.rhythm.find((point) => point.label === "2026-07-02")?.count).toBe(1);
  });
});

describe("timeliness and behavioral preference", () => {
  it("ranks timeliness by median release-to-first-watch lag", () => {
    const entries = [
      entry(1, "2026-07-01T12:00:00+08:00", "A"),
      entry(2, "2026-07-02T12:00:00+08:00", "A"),
      entry(3, "2026-07-03T12:00:00+08:00", "A"),
      entry(4, "2026-07-04T12:00:00+08:00", "B"),
      entry(5, "2026-07-05T12:00:00+08:00", "B"),
      entry(6, "2026-07-06T12:00:00+08:00", "B")
    ];
    const records = entries.map((watch, index) => episode(
      watch.videoSn,
      index < 3 ? 10 : 20,
      index % 3,
      new Date(watch.watchedAt.getTime() - (index < 3 ? 120 : 180) * 60_000).toISOString()
    ));
    const result = analyze({ entries, episodeRecords: records });
    expect(result.timeliness.rows.map((row) => [row.animeSn, row.medianLagMinutes])).toEqual([
      [10, 120],
      [20, 180]
    ]);
  });

  it("does not treat episodes released before stream start as pending", () => {
    const entries = [
      entry(101, "2026-07-01T08:00:00+08:00", "A"),
      entry(203, "2026-07-02T10:00:00+08:00", "Late start"),
      entry(102, "2026-07-03T10:00:00+08:00", "A"),
      entry(204, "2026-07-04T10:00:00+08:00", "Late start")
    ];
    const records = [
      episode(101, 1, 1, "2026-07-01T07:00:00+08:00"),
      episode(102, 1, 2, "2026-07-01T09:00:00+08:00"),
      episode(203, 2, 3, "2026-06-20T09:00:00+08:00"),
      episode(204, 2, 4, "2026-06-27T09:00:00+08:00")
    ];
    const result = analyze({
      entries,
      episodeRecords: records,
      animeRecords: [
        animeRecord(1, [ref(101, 2), ref(102, 3)]),
        animeRecord(2, [ref(203, 4), ref(204, 5)])
      ],
      asOf: instant("2026-07-10T12:00:00+08:00"),
      historyCoverage: completeCoverage("2026-06-01T00:00:00+08:00", "2026-07-10T12:00:00+08:00")
    });
    expect(result.preference.choiceEventCount).toBe(0);
  });

  it("builds release-season preference from full started context but only compares cohort episodes", () => {
    const entries: WatchEntry[] = [];
    const records: EpisodeMetadata[] = [];
    let videoSn = 1;
    const nextVideo = (): number => videoSn++;

    for (const [animeSn, title] of [[1, "A"], [2, "B"], [3, "C"], [4, "D"], [5, "E"]] as const) {
      const sn = nextVideo();
      entries.push(entry(sn, "2026-06-20T08:00:00+08:00", title));
      records.push(episode(sn, animeSn, 0, "2026-06-01T08:00:00+08:00"));
    }

    const summerRelease = "2026-07-01T08:00:00+08:00";
    for (const day of [2, 3, 4]) {
      const sn = nextVideo();
      entries.push(entry(sn, `2026-07-${String(day).padStart(2, "0")}T12:00:00+08:00`, "A"));
      records.push(episode(sn, 1, day - 1, summerRelease));
    }
    for (const [animeSn, title, day] of [[2, "B", 5], [3, "C", 6], [4, "D", 7]] as const) {
      const sn = nextVideo();
      entries.push(entry(sn, `2026-07-0${day}T12:00:00+08:00`, title));
      records.push(episode(sn, animeSn, 1, summerRelease));
    }
    const springSn = nextVideo();
    entries.push(entry(springSn, "2026-07-08T12:00:00+08:00", "E"));
    records.push(episode(springSn, 5, 1, "2026-06-30T08:00:00+08:00"));

    const result = analyze({
      entries,
      episodeRecords: records,
      animeRecords: [1, 2, 3, 4, 5].map((animeSn) => animeRecord(
        animeSn,
        records
          .filter((record) => record.animeSn === animeSn)
          .map((record) => ref(record.videoSn, record.episodeNumber, record.groupKey))
      )),
      scope: releasedScope({ kind: "calendar-season", year: 2026, season: "summer" }),
      asOf: instant("2026-09-30T23:59:00+08:00"),
      historyCoverage: completeCoverage("2026-05-01T00:00:00+08:00", "2026-09-30T23:59:00+08:00")
    });

    expect(result.preference.choiceEventCount).toBe(5);
    expect(result.preference.rows.find((row) => row.animeSn === 1)).toMatchObject({
      wins: 9,
      losses: 0,
      comparisons: 9
    });
    expect(result.preference.rows.some((row) => row.animeSn === 5)).toBe(false);
  });

  it("counts a catalog episode that has never been watched as a pending loser", () => {
    const records = [
      episode(101, 1, 0, "2026-07-01T07:00:00+08:00"),
      episode(102, 1, 1, "2026-07-02T08:00:00+08:00"),
      episode(201, 2, 0, "2026-07-01T07:00:00+08:00"),
      episode(202, 2, 1, "2026-07-02T08:00:00+08:00")
    ];
    const result = analyze({
      entries: [
        entry(101, "2026-07-01T08:00:00+08:00", "A"),
        entry(201, "2026-07-01T08:00:00+08:00", "B"),
        entry(102, "2026-07-03T10:00:00+08:00", "A")
      ],
      episodeRecords: records,
      animeRecords: [
        animeRecord(1, [ref(101, 1), ref(102, 2)]),
        animeRecord(2, [ref(201, 1), ref(202, 2)])
      ]
    });

    expect(result.preference.coverage.passed).toBe(true);
    expect(result.preference.choiceEventCount).toBe(1);
  });

  it("requires a release to be strictly after stream start, including same-minute releases", () => {
    const records = [
      episode(101, 1, 0, "2026-07-01T07:00:00+08:00"),
      episode(102, 1, 1, "2026-07-01T08:00:00+08:00"),
      episode(201, 2, 0, "2026-07-01T07:00:00+08:00"),
      episode(202, 2, 1, "2026-07-01T08:00:00+08:00")
    ];
    const result = analyze({
      entries: [
        entry(101, "2026-07-01T08:00:00+08:00", "A"),
        entry(201, "2026-07-01T08:00:00+08:00", "B"),
        entry(102, "2026-07-03T10:00:00+08:00", "A")
      ],
      episodeRecords: records,
      animeRecords: [
        animeRecord(1, [ref(101, 1), ref(102, 2)]),
        animeRecord(2, [ref(201, 1), ref(202, 2)])
      ]
    });

    expect(result.preference.choiceEventCount).toBe(0);
  });

  it("does not let a stream that starts in the decision minute become a candidate", () => {
    const records = [
      episode(101, 1, 0, "2026-07-01T07:00:00+08:00"),
      episode(102, 1, 1, "2026-07-02T08:00:00+08:00"),
      episode(201, 2, 0, "2026-07-02T08:00:00+08:00"),
      episode(202, 2, 1, "2026-07-02T09:00:00+08:00")
    ];
    const result = analyze({
      entries: [
        entry(101, "2026-07-01T08:00:00+08:00", "A"),
        entry(102, "2026-07-03T10:00:00+08:00", "A"),
        entry(201, "2026-07-03T10:00:00+08:00", "B")
      ],
      episodeRecords: records,
      animeRecords: [
        animeRecord(1, [ref(101, 1), ref(102, 2)]),
        animeRecord(2, [ref(201, 1), ref(202, 2)])
      ]
    });

    expect(result.preference.choiceEventCount).toBe(0);
  });

  it("excludes episodes whose license has ended at the decision minute", () => {
    const records = [
      episode(101, 1, 0, "2026-07-01T07:00:00+08:00"),
      episode(102, 1, 1, "2026-07-02T08:00:00+08:00"),
      episode(201, 2, 0, "2026-07-01T07:00:00+08:00"),
      episode(202, 2, 1, "2026-07-02T08:00:00+08:00", 24, {
        availableUntil: instant("2026-07-03T10:00:00+08:00")
      })
    ];
    const result = analyze({
      entries: [
        entry(101, "2026-07-01T08:00:00+08:00", "A"),
        entry(201, "2026-07-01T08:00:00+08:00", "B"),
        entry(102, "2026-07-03T10:00:00+08:00", "A")
      ],
      episodeRecords: records,
      animeRecords: [
        animeRecord(1, [ref(101, 1), ref(102, 2)]),
        animeRecord(2, [ref(201, 1), ref(202, 2)])
      ]
    });

    expect(result.preference.choiceEventCount).toBe(0);
  });

  it("excludes an episode that was first watched before the decision", () => {
    const records = [
      episode(101, 1, 0, "2026-07-01T07:00:00+08:00"),
      episode(102, 1, 1, "2026-07-04T08:00:00+08:00"),
      episode(201, 2, 0, "2026-07-01T07:00:00+08:00"),
      episode(202, 2, 1, "2026-07-02T08:00:00+08:00")
    ];
    const result = analyze({
      entries: [
        entry(101, "2026-07-01T08:00:00+08:00", "A"),
        entry(201, "2026-07-01T08:00:00+08:00", "B"),
        entry(202, "2026-07-03T10:00:00+08:00", "B"),
        entry(102, "2026-07-05T10:00:00+08:00", "A")
      ],
      episodeRecords: records,
      animeRecords: [
        animeRecord(1, [ref(101, 1), ref(102, 2)]),
        animeRecord(2, [ref(201, 1), ref(202, 2)])
      ]
    });

    expect(result.preference.choiceEventCount).toBe(0);
  });

  it("collapses every pending episode of one anime into one comparison candidate", () => {
    const records: EpisodeMetadata[] = [];
    const entries: WatchEntry[] = [];
    const references = new Map<number, EpisodeRef[]>();
    const add = (
      videoSn: number,
      animeSn: number,
      episodeIndex: number,
      release: string,
      watchedAt?: string
    ): void => {
      records.push(episode(videoSn, animeSn, episodeIndex, release));
      const animeRefs = references.get(animeSn) ?? [];
      animeRefs.push(ref(videoSn, episodeIndex + 1));
      references.set(animeSn, animeRefs);
      if (watchedAt) entries.push(entry(videoSn, watchedAt, animeSn === 1 ? "A" : animeSn === 2 ? "B" : animeSn === 3 ? "C" : "D"));
    };

    for (const animeSn of [1, 2, 3, 4]) {
      add(animeSn * 100 + 1, animeSn, 0, "2026-07-01T07:00:00+08:00", "2026-07-01T08:00:00+08:00");
    }
    for (const [index, day] of [3, 5, 7].entries()) {
      add(102 + index, 1, index + 1, "2026-07-02T08:00:00+08:00", `2026-07-0${day}T10:00:00+08:00`);
    }
    for (const [index, day] of [4, 6, 8].entries()) {
      add(202 + index, 2, index + 1, "2026-07-02T08:00:00+08:00", `2026-07-0${day}T10:00:00+08:00`);
    }
    add(105, 1, 4, "2026-07-02T08:00:00+08:00");
    add(205, 2, 4, "2026-07-02T08:00:00+08:00");
    for (const animeSn of [3, 4]) {
      add(animeSn * 100 + 2, animeSn, 1, "2026-07-02T08:00:00+08:00");
      add(animeSn * 100 + 3, animeSn, 2, "2026-07-02T08:00:00+08:00");
    }

    const result = analyze({
      entries,
      episodeRecords: records,
      animeRecords: [...references].map(([animeSn, refs]) => animeRecord(animeSn, refs))
    });

    expect(result.preference.available).toBe(true);
    expect(result.preference.choiceEventCount).toBe(6);
    expect(result.preference.rows.map((row) => ({
      animeSn: row.animeSn,
      wins: row.wins,
      losses: row.losses,
      comparisons: row.comparisons,
      opponents: row.distinctOpponentCount,
      decisions: row.decisionBucketCount
    }))).toEqual([
      { animeSn: 1, wins: 9, losses: 3, comparisons: 12, opponents: 3, decisions: 6 },
      { animeSn: 2, wins: 9, losses: 3, comparisons: 12, opponents: 3, decisions: 6 },
      { animeSn: 3, wins: 0, losses: 6, comparisons: 6, opponents: 2, decisions: 6 },
      { animeSn: 4, wins: 0, losses: 6, comparisons: 6, opponents: 2, decisions: 6 }
    ]);
  });

  it("verifies a complete started group independently and ignores an unstarted group", () => {
    const records = [
      episode(101, 1, 0, "2026-07-01T07:00:00+08:00"),
      episode(102, 1, 1, "2026-07-02T08:00:00+08:00"),
      episode(111, 1, 0, "2026-07-02T08:00:00+08:00", 24, { groupKey: "movie" }),
      episode(112, 1, 1, "2026-07-02T08:00:00+08:00", 24, { groupKey: "movie" }),
      episode(201, 2, 0, "2026-07-01T07:00:00+08:00"),
      episode(202, 2, 1, "2026-07-02T08:00:00+08:00")
    ];
    const result = analyze({
      entries: [
        entry(101, "2026-07-01T08:00:00+08:00", "A"),
        entry(201, "2026-07-01T08:00:00+08:00", "B"),
        entry(202, "2026-07-03T10:00:00+08:00", "B")
      ],
      episodeRecords: records,
      animeRecords: [
        animeRecord(1, [
          ref(101, 1),
          ref(102, 2),
          ref(111, 1, "movie"),
          ref(112, 2, "movie")
        ], { totalEpisode: 2 }),
        animeRecord(2, [ref(201, 1), ref(202, 2)])
      ]
    });

    expect(result.preference.coverage.passed).toBe(true);
    expect(result.preference.choiceEventCount).toBe(1);
  });

  it("withholds preference when one authoritative episode in a relevant started group is missing", () => {
    const result = analyze({
      entries: [
        entry(101, "2026-07-01T08:00:00+08:00", "A"),
        entry(201, "2026-07-01T08:00:00+08:00", "B"),
        entry(102, "2026-07-03T10:00:00+08:00", "A")
      ],
      episodeRecords: [
        episode(101, 1, 0, "2026-07-01T07:00:00+08:00"),
        episode(102, 1, 1, "2026-07-02T08:00:00+08:00"),
        episode(201, 2, 0, "2026-07-01T07:00:00+08:00")
      ],
      animeRecords: [
        animeRecord(1, [ref(101, 1), ref(102, 2)]),
        animeRecord(2, [ref(201, 1), ref(202, 2)])
      ]
    });

    expect(result.preference.coverage).toEqual({
      numerator: 6,
      denominator: 7,
      ratio: 6 / 7,
      passed: false
    });
    expect(result.preference).toMatchObject({ available: false, choiceEventCount: 0, rows: [] });
  });

  it("withholds preference when the authoritative refs list is shorter than totalEpisode", () => {
    const result = analyze({
      entries: [
        entry(101, "2026-07-01T08:00:00+08:00", "A"),
        entry(201, "2026-07-01T08:00:00+08:00", "B"),
        entry(102, "2026-07-03T10:00:00+08:00", "A")
      ],
      episodeRecords: [
        episode(101, 1, 0, "2026-07-01T07:00:00+08:00"),
        episode(102, 1, 1, "2026-07-02T08:00:00+08:00"),
        episode(201, 2, 0, "2026-07-01T07:00:00+08:00"),
        episode(202, 2, 1, "2026-07-02T08:00:00+08:00")
      ],
      animeRecords: [
        animeRecord(1, [ref(101, 1), ref(102, 2)]),
        animeRecord(2, [ref(201, 1), ref(202, 2)], { totalEpisode: 3 })
      ]
    });

    expect(result.preference.coverage.passed).toBe(false);
    expect(result.preference).toMatchObject({ available: false, choiceEventCount: 0, rows: [] });
  });

  it("withholds preference when a relevant refs list is not exactly numbered 1 through totalEpisode", () => {
    const result = analyze({
      entries: [
        entry(101, "2026-07-01T08:00:00+08:00", "A"),
        entry(201, "2026-07-01T08:00:00+08:00", "B"),
        entry(102, "2026-07-03T10:00:00+08:00", "A")
      ],
      episodeRecords: [
        episode(101, 1, 0, "2026-07-01T07:00:00+08:00"),
        episode(102, 1, 1, "2026-07-02T08:00:00+08:00"),
        episode(201, 2, 0, "2026-07-01T07:00:00+08:00"),
        episode(202, 2, 1, "2026-07-02T08:00:00+08:00"),
        episode(204, 2, 3, "2026-07-02T08:00:00+08:00")
      ],
      animeRecords: [
        animeRecord(1, [ref(101, 1), ref(102, 2)]),
        animeRecord(2, [ref(201, 1), ref(202, 2), ref(204, 4)], { totalEpisode: 3 })
      ]
    });

    expect(result.preference.coverage.passed).toBe(false);
    expect(result.preference).toMatchObject({ available: false, choiceEventCount: 0, rows: [] });
  });

  it("requires the anime catalog snapshot to cover the latest potential decision minute", () => {
    const run = (fetchedAt: string) => analyze({
      entries: [
        entry(101, "2026-07-01T08:00:00+08:00", "A"),
        entry(201, "2026-07-01T08:00:00+08:00", "B"),
        entry(102, "2026-07-03T10:00:00+08:00", "A")
      ],
      episodeRecords: [
        episode(101, 1, 0, "2026-07-01T07:00:00+08:00"),
        episode(102, 1, 1, "2026-07-02T08:00:00+08:00"),
        episode(201, 2, 0, "2026-07-01T07:00:00+08:00"),
        episode(202, 2, 1, "2026-07-02T08:00:00+08:00")
      ],
      animeRecords: [
        animeRecord(1, [ref(101, 1), ref(102, 2)], { fetchedAt: instant(fetchedAt) }),
        animeRecord(2, [ref(201, 1), ref(202, 2)], { fetchedAt: instant(fetchedAt) })
      ]
    });

    const stale = run("2026-07-03T09:59:00+08:00");
    expect(stale.preference.coverage.passed).toBe(false);
    expect(stale.preference).toMatchObject({ available: false, choiceEventCount: 0, rows: [] });

    const exactBoundary = run("2026-07-03T10:00:00+08:00");
    expect(exactBoundary.preference.coverage.passed).toBe(true);
    expect(exactBoundary.preference.choiceEventCount).toBe(1);
  });

  it("keeps the 60-minute same-series continuation out of preference decisions", () => {
    const records = [
      episode(101, 1, 0, "2026-07-01T07:00:00+08:00"),
      episode(102, 1, 1, "2026-07-02T08:00:00+08:00"),
      episode(103, 1, 2, "2026-07-02T08:00:00+08:00"),
      episode(201, 2, 0, "2026-07-01T07:00:00+08:00"),
      episode(202, 2, 1, "2026-07-02T08:00:00+08:00")
    ];
    const result = analyze({
      entries: [
        entry(101, "2026-07-01T08:00:00+08:00", "A"),
        entry(201, "2026-07-01T08:00:00+08:00", "B"),
        entry(102, "2026-07-03T10:00:00+08:00", "A"),
        entry(103, "2026-07-03T10:30:00+08:00", "A")
      ],
      episodeRecords: records,
      animeRecords: [
        animeRecord(1, [ref(101, 1), ref(102, 2), ref(103, 3)]),
        animeRecord(2, [ref(201, 1), ref(202, 2)])
      ]
    });

    expect(result.preference.choiceEventCount).toBe(1);
  });

  it("uses exact Taipei release-cohort boundaries for preference candidates", () => {
    const records = [
      episode(101, 1, 0, "2026-03-01T07:00:00+08:00"),
      episode(102, 1, 1, "2026-04-01T00:00:00+08:00"),
      episode(201, 2, 0, "2026-03-01T07:00:00+08:00"),
      episode(202, 2, 1, "2026-03-31T23:59:00+08:00"),
      episode(301, 3, 0, "2026-03-01T07:00:00+08:00"),
      episode(302, 3, 1, "2026-06-30T23:59:00+08:00"),
      episode(401, 4, 0, "2026-03-01T07:00:00+08:00"),
      episode(402, 4, 1, "2026-07-01T00:00:00+08:00")
    ];
    const result = analyze({
      entries: [
        entry(101, "2026-03-01T08:00:00+08:00", "A"),
        entry(201, "2026-03-01T08:00:00+08:00", "B"),
        entry(301, "2026-03-01T08:00:00+08:00", "C"),
        entry(401, "2026-03-01T08:00:00+08:00", "D"),
        entry(102, "2026-06-30T23:59:00+08:00", "A")
      ],
      episodeRecords: records,
      animeRecords: [1, 2, 3, 4].map((animeSn) => animeRecord(
        animeSn,
        records
          .filter((record) => record.animeSn === animeSn)
          .map((record) => ref(record.videoSn, record.episodeNumber))
      )),
      scope: releasedScope({ kind: "calendar-season", year: 2026, season: "spring" }),
      asOf: instant("2026-06-30T23:59:00+08:00"),
      historyCoverage: completeCoverage("2026-01-01T00:00:00+08:00", "2026-06-30T23:59:00+08:00")
    });

    expect(result.preference.coverage.passed).toBe(true);
    expect(result.preference.choiceEventCount).toBe(1);
  });
});

describe("history coverage", () => {
  it("labels an uncovered scope as incomplete while retaining observed insights", () => {
    const result = analyze({
      entries: [entry(1, "2026-07-02T10:00:00+08:00", "A")],
      episodeRecords: [episode(1, 10, 0, "2026-07-01T08:00:00+08:00")],
      historyCoverage: {
        coveredFrom: instant("2026-07-02T00:00:00+08:00"),
        coveredThrough: instant("2026-07-31T23:59:00+08:00"),
        complete: true
      }
    });
    expect(result.historyComplete).toBe(false);
    expect(result.summary.durationCoverage.passed).toBe(false);
    expect(result.summary.contentMinutes).toBeNull();
    expect(result.timeliness).toMatchObject({
      available: true,
      rows: [{ animeSn: 10, sampleCount: 1 }]
    });
  });

  it.each<[number, CalendarSeason]>([
    [1, "winter"],
    [4, "spring"],
    [7, "summer"],
    [10, "autumn"]
  ])("keeps a calendar season scope explicit for month %i", (month, season) => {
    const day = `${String(month).padStart(2, "0")}-01`;
    const result = analyze({
      entries: [entry(1, `2026-${day}T12:00:00+08:00`, "A")],
      episodeRecords: [episode(1, 10, 0, `2026-${day}T08:00:00+08:00`)],
      scope: releasedScope({ kind: "calendar-season", year: 2026, season }),
      asOf: instant("2026-12-31T23:59:00+08:00")
    });
    expect(result.summary.watchCount).toBe(1);
  });
});
