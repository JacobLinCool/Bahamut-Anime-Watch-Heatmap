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
  isOngoing: false,
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

describe("highlights that only some people get", () => {
  it("tells how the year began even when 30-hour days file that night under the year before", () => {
    const records = [
      episode(1, 10, 0, "2025-12-01T08:00:00+08:00"),
      episode(2, 20, 0, "2025-12-31T08:00:00+08:00"),
      episode(3, 20, 1, "2026-01-02T08:00:00+08:00")
    ];
    const entries = [
      entry(1, "2025-12-31T23:50:00+08:00", "作品 A"),
      entry(2, "2026-01-01T00:30:00+08:00", "作品 B"),
      entry(3, "2026-01-03T20:00:00+08:00", "作品 B")
    ];
    const animeRecords = [animeRecord(10, [ref(1, 1)]), animeRecord(20, [ref(2, 1), ref(3, 2)])];
    const year: AnalysisScope = { axis: "watched-at", dayBoundaryMode: "thirty-hour", period: { kind: "calendar-year", year: 2026 } };
    const result = analyze({ entries, episodeRecords: records, animeRecords, scope: year });
    expect(result.highlights.newYearsEve).toMatchObject({
      year: 2026,
      before: { animeSn: 10, episode: "第 1 集", watchedAt: instant("2025-12-31T23:50:00+08:00") },
      after: { animeSn: 20, episode: "第 2 集", watchedAt: instant("2026-01-01T00:30:00+08:00") }
    });
    // 那一晚不在紀錄裡：沒看到不代表沒在看。
    const late = analyze({ entries, episodeRecords: records, animeRecords, scope: year, historyCoverage: completeCoverage("2026-01-01T00:00:00+08:00") });
    expect(late.highlights.newYearsEve).toBeNull();
    // 不是年度回顧就不談跨年。
    expect(analyze({ entries, episodeRecords: records, animeRecords, scope: watchedScope({ kind: "calendar-month", year: 2026, month: 1 }) })
      .highlights.newYearsEve).toBeNull();
  });

  it("only calls it a night until dawn when the watching started before three and never paused for an hour", () => {
    const records: EpisodeMetadata[] = [];
    const entries: WatchEntry[] = [];
    const watch = (videoSn: number, at: string): void => {
      records.push(episode(videoSn, 10, videoSn - 1, "2026-07-01T08:00:00+08:00"));
      entries.push(entry(videoSn, at, "作品 A"));
    };
    // 7/5：02:30 開始，每集間隔不到一小時，一路看到 06:20。
    ["02:30", "03:10", "03:50", "04:40", "05:30", "06:20"].forEach((time, index) => watch(1 + index, `2026-07-05T${time}:00+08:00`));
    // 7/10：早起才看，06:00 開始。
    ["06:00", "06:40", "07:30"].forEach((time, index) => watch(20 + index, `2026-07-10T${time}:00+08:00`));
    // 7/15：01:00 看一集，中斷四小時，05:00 再看到 06:50。
    ["01:00", "05:00", "05:40", "06:50"].forEach((time, index) => watch(30 + index, `2026-07-15T${time}:00+08:00`));
    const refs = records.map((record, index) => ref(record.videoSn, index + 1));
    const result = analyze({ entries, episodeRecords: records, animeRecords: [animeRecord(10, refs)] });
    expect(result.highlights.dawn).toMatchObject({
      startedAt: instant("2026-07-05T02:30:00+08:00"),
      endedAt: instant("2026-07-05T06:20:00+08:00"),
      episodeCount: 6,
      last: { animeSn: 10, episode: "第 6 集" }
    });
  });

  it("counts a work as old only when the watched episode is not a new season of an old series", () => {
    const records: EpisodeMetadata[] = [];
    const entries: WatchEntry[] = [];
    const animeRecords: AnimeMetadata[] = [];
    const add = (animeSn: number, uploads: readonly string[], watchedFrom: number, overrides: Partial<AnimeMetadata>): void => {
      const refs = uploads.map((uploaded, index) => {
        const videoSn = animeSn * 100 + index;
        records.push(episode(videoSn, animeSn, index, uploaded));
        if (index >= watchedFrom) entries.push(entry(videoSn, `2026-07-${String(2 + index).padStart(2, "0")}T21:${String(animeSn).padStart(2, "0")}:00+08:00`, `作品 ${animeSn}`));
        return ref(videoSn, index + 1);
      });
      animeRecords.push(animeRecord(animeSn, refs, overrides));
    };
    // 2010 年的作品，今年整批重新上架：舊作。
    add(1, ["2026-06-01T12:00:00+08:00", "2026-06-01T12:00:00+08:00", "2026-06-01T12:00:00+08:00"], 0, { seasonStartDateKey: "2010-07-05", seasonEndDateKey: "2010-09-27" });
    // 2023 年開播的系列，今年播新一季：作品編號一樣，但看的是新集數，不算舊作。
    add(2, ["2023-04-12T23:00:00+08:00", "2023-04-19T23:00:00+08:00", "2026-04-08T23:00:00+08:00", "2026-04-15T23:00:00+08:00"], 2, { seasonStartDateKey: "2023-04-12", seasonEndDateKey: "2026-06-30" });
    // 今年的新番。
    add(3, ["2026-04-03T23:00:00+08:00", "2026-04-10T23:00:00+08:00"], 0, { seasonStartDateKey: "2026-04-03", seasonEndDateKey: "2026-06-30" });
    const result = analyze({ entries, episodeRecords: records, animeRecords });
    expect(result.highlights.oldWorks).toMatchObject({
      workCount: 1,
      episodeCount: 3,
      datedEpisodeCount: 7,
      oldest: { animeSn: 1, premiereYear: 2010 }
    });
  });
});

describe("volume, duration, and metadata dimensions", () => {
  it("ranks tags and makers by how many works they cover, not by episodes", () => {
    const records: EpisodeMetadata[] = [];
    const entries: WatchEntry[] = [];
    // 一部 24 集的長篇（類型「長篇」）對上兩部各兩集的作品（類型「短篇」）。
    for (let index = 0; index < 24; index += 1) {
      records.push(episode(100 + index, 1, index, "2026-07-01T08:00:00+08:00"));
      entries.push(entry(100 + index, `2026-07-${String(2 + (index % 20)).padStart(2, "0")}T2${index % 4}:00:00+08:00`, "長篇"));
    }
    for (const [animeSn, base] of [[2, 200], [3, 300]] as const) {
      for (let index = 0; index < 2; index += 1) {
        records.push(episode(base + index, animeSn, index, "2026-07-01T08:00:00+08:00"));
        entries.push(entry(base + index, `2026-07-2${5 + index}T1${animeSn}:00:00+08:00`, `短篇 ${animeSn}`));
      }
    }
    const refsOf = (animeSn: number) => records.filter((record) => record.animeSn === animeSn)
      .map((record) => ref(record.videoSn, record.episodeIndex + 1));
    const result = analyze({
      entries,
      episodeRecords: records,
      animeRecords: [
        animeRecord(1, refsOf(1), { tags: ["長篇"], maker: "長篇工作室" }),
        animeRecord(2, refsOf(2), { tags: ["短篇"], maker: "短篇工作室" }),
        animeRecord(3, refsOf(3), { tags: ["短篇"], maker: "短篇工作室" })
      ]
    });
    expect(result.catalog.tags.map((row) => [row.label, row.animeCount, row.watchCount])).toEqual([
      ["短篇", 2, 4],
      ["長篇", 1, 24]
    ]);
    expect(result.catalog.makers[0]).toMatchObject({ rank: 1, label: "短篇工作室", animeCount: 2 });
  });

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

  it("sorts each verifiable work into how far you followed it, and counts drops per genre", () => {
    const records: EpisodeMetadata[] = [];
    const entries: WatchEntry[] = [];
    const animeRecords: AnimeMetadata[] = [];
    let videoSn = 1;
    /** total 集的作品，看了 watched 這幾集（1-based）。 */
    const work = (animeSn: number, total: number, watched: readonly number[], overrides: Partial<AnimeMetadata> = {}): void => {
      const refs: EpisodeRef[] = [];
      for (let number = 1; number <= total; number += 1) {
        const sn = videoSn++;
        records.push(episode(sn, animeSn, number - 1, "2026-07-01T08:00:00+08:00"));
        refs.push(ref(sn, number));
        if (watched.includes(number)) {
          entries.push(entry(sn, `2026-07-${String(2 + (number % 25)).padStart(2, "0")}T${String(10 + (animeSn % 12)).padStart(2, "0")}:00:00+08:00`, `作品 ${animeSn}`));
        }
      }
      animeRecords.push(animeRecord(animeSn, refs, overrides));
    };
    const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, index) => from + index);
    work(1, 12, range(1, 12), { tags: ["校園"] });
    work(2, 13, range(1, 12), { tags: ["校園"] });
    work(3, 12, range(1, 7), { tags: ["校園"] });
    work(4, 12, [1], { tags: ["校園"] });
    work(5, 12, range(5, 9), { tags: ["校園"] });
    work(6, 7, range(1, 7), { tags: ["校園"], isOngoing: true });
    work(7, 7, range(1, 3), { tags: ["校園"], isOngoing: true });
    const result = analyze({ entries, episodeRecords: records, animeRecords });

    const outcomes = Object.fromEntries(result.completion.rows.map((row) => [row.animeSn, row.outcome]));
    expect(outcomes).toEqual({
      1: "finished",
      2: "nearly",
      3: "midway",
      4: "dropped",
      // 第 1 集不在紀錄裡：分不出是放棄還是早就看過。
      5: "unknown-start",
      6: "caught-up",
      7: "behind"
    });
    // 只有 4 部從頭開始看、已完結：不到 8 部，類型的放棄比例不列。
    expect(result.completion.dropTags).toEqual([]);

    for (let animeSn = 10; animeSn < 14; animeSn += 1) work(animeSn, 12, range(1, 12), { tags: ["校園"] });
    const more = analyze({ entries, episodeRecords: records, animeRecords });
    expect(more.completion.dropTags).toEqual([{ label: "校園", startedCount: 8, droppedCount: 1, dropRate: 1 / 8 }]);
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
    expect(result.completion).toEqual({ available: false, rows: [], dropTags: [] });
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

    expect(result.completion).toEqual({ available: false, rows: [], dropTags: [] });
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

  it("lists every day of a season scope for the poster calendar", () => {
    const result = analyze({
      entries: [
        entry(1, "2026-07-20T10:00:00+08:00", "作品 A"),
        entry(2, "2026-07-21T10:00:00+08:00", "作品 A"),
        entry(3, "2026-10-02T10:00:00+08:00", "作品 B")
      ],
      episodeRecords: [
        episode(1, 10, 0, "2026-07-02T23:59:00+08:00", 20),
        episode(2, 10, 1, "2026-07-08T00:00:00+08:00", 24),
        episode(3, 20, 0, "2026-09-30T08:00:00+08:00", 30)
      ],
      scope: releasedScope({ kind: "calendar-season", year: 2026, season: "summer" }),
      asOf: instant("2026-10-31T23:59:00+08:00")
    });

    // 7/1–9/30 共 92 天，每天一格（含沒看的日子），依上架日歸類。
    expect(result.dailyCounts).toHaveLength(92);
    expect(result.dailyCounts[0]).toEqual({ dateKey: "2026-07-01", count: 0 });
    expect(result.dailyCounts.find((day) => day.dateKey === "2026-07-02")).toEqual({ dateKey: "2026-07-02", count: 1 });
    expect(result.dailyCounts.find((day) => day.dateKey === "2026-07-08")).toEqual({ dateKey: "2026-07-08", count: 1 });
    expect(result.dailyCounts.at(-1)).toEqual({ dateKey: "2026-09-30", count: 1 });
    expect(result.dailyCounts.reduce((sum, day) => sum + day.count, 0)).toBe(3);
    // 儀表板用的月節奏不變。
    expect(result.rhythm.map((point) => point.label)).toEqual(["2026-07", "2026-08", "2026-09"]);
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

  it("ranks each started season of a year on its own and calls a cold favorite a hidden gem", () => {
    const build = (options: { readonly ongoing?: boolean; readonly cohortExtras?: number } = {}) => {
      const records: EpisodeMetadata[] = [];
      const entries: WatchEntry[] = [];
      const references = new Map<number, EpisodeRef[]>();
      const add = (videoSn: number, animeSn: number, episodeIndex: number, release: string, watchedAt?: string): void => {
        records.push(episode(videoSn, animeSn, episodeIndex, release));
        references.set(animeSn, [...(references.get(animeSn) ?? []), ref(videoSn, episodeIndex + 1)]);
        if (watchedAt) entries.push(entry(videoSn, watchedAt, `作品 ${animeSn}`));
      };
      // 四部同時開始追；之後作品 1 有七天被先點開、作品 2 三天，作品 3、4 一直擱著。
      for (const animeSn of [1, 2, 3, 4]) add(animeSn * 100, animeSn, 0, "2026-07-01T07:00:00+08:00", "2026-07-01T08:00:00+08:00");
      // 作品快照在 7/14 取得：選擇時刻都要落在快照之前，才確定當時有哪些集數在等。
      const firstDays = [3, 5, 7, 9, 10, 11, 12];
      const secondDays = [4, 6, 8];
      firstDays.forEach((day, index) =>
        add(101 + index, 1, index + 1, "2026-07-02T08:00:00+08:00", `2026-07-${String(day).padStart(2, "0")}T10:00:00+08:00`));
      secondDays.forEach((day, index) =>
        add(201 + index, 2, index + 1, "2026-07-02T08:00:00+08:00", `2026-07-0${day}T10:00:00+08:00`));
      add(199, 1, 8, "2026-07-02T08:00:00+08:00");
      add(299, 2, 4, "2026-07-02T08:00:00+08:00");
      for (const animeSn of [3, 4]) add(animeSn * 100 + 1, animeSn, 1, "2026-07-02T08:00:00+08:00");
      // 同季開播、看過一集就結束的作品：只用來湊出同季的人氣名次。
      const extras = options.cohortExtras ?? 5;
      for (let index = 0; index < extras; index += 1) {
        add(1000 + index, 50 + index, 0, "2026-07-01T07:00:00+08:00", "2026-07-01T08:00:00+08:00");
      }
      const popular = (animeSn: number): number => animeSn === 1 ? 100 : animeSn === 2 ? 5000 : 1000 + animeSn;
      return analyze({
        entries,
        episodeRecords: records,
        animeRecords: [...references].map(([animeSn, refs]) => animeRecord(animeSn, refs, {
          seasonStartDateKey: "2026-07-01",
          isOngoing: animeSn === 1 && options.ongoing === true,
          platformSnapshot: { score: 4.5, reviewCount: 10, popular: popular(animeSn), observedAt }
        })),
        scope: watchedScope({ kind: "calendar-year", year: 2026 })
      });
    };

    const result = build();
    // 7 月底時秋季還沒開始，不列；冬、春沒有可比較的時刻，列出但選不出最愛。
    expect(result.favorites.seasons.map((season) => [season.season, season.rows.map((row) => row.animeSn)])).toEqual([
      ["winter", []],
      ["spring", []],
      ["summer", [1, 2]]
    ]);
    expect(result.favorites.seasons[2]?.choiceEventCount).toBe(10);
    // 作品 1 是夏季最愛，同季 9 部裡人氣墊底；作品 2 也是最愛，但同季最熱門。
    expect(result.favorites.hiddenGems).toEqual([{
      animeSn: 1,
      title: "作品 1",
      coverUrl: "https://p2.bahamut.com.tw/B/ACG/1.JPG",
      cohortYear: 2026,
      cohortSeason: "summer",
      cohortSize: 9,
      popularityRank: 9,
      cohortLeaderTitle: "作品 2",
      popularityRatio: 100 / 5000
    }]);
    // 還在播的作品人氣還在累積；同季看過的作品太少時名次沒有意義。
    expect(build({ ongoing: true }).favorites.hiddenGems).toEqual([]);
    expect(build({ cohortExtras: 3 }).favorites.hiddenGems).toEqual([]);
    // 不是年度期間就不逐季拆。
    const month = analyze({ entries: [], episodeRecords: [], scope: watchedScope() });
    expect(month.favorites).toEqual({ seasons: [], hiddenGems: [] });
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

describe("habit clock", () => {
  it("buckets watches by Taipei hour, segment, and weekday", () => {
    const records = [
      episode(1, 10, 0, "2026-07-01T08:00:00+08:00"),
      episode(2, 10, 1, "2026-07-02T08:00:00+08:00"),
      episode(3, 10, 2, "2026-07-03T08:00:00+08:00")
    ];
    const result = analyze({
      entries: [
        entry(1, "2026-07-03T23:30:00+08:00", "作品 A"),
        entry(2, "2026-07-04T23:10:00+08:00", "作品 A"),
        entry(3, "2026-07-04T12:00:00+08:00", "作品 A")
      ],
      episodeRecords: records,
      animeRecords: [animeRecord(10, [ref(1, 1), ref(2, 2), ref(3, 3)])]
    });

    expect(result.habitClock.available).toBe(true);
    expect(result.habitClock.hourCounts[23]).toBe(2);
    expect(result.habitClock.hourCounts[12]).toBe(1);
    expect(result.habitClock.peakHour).toBe(23);
    expect(result.habitClock.peakHourCount).toBe(2);
    expect(result.habitClock.topSegment).toMatchObject({ key: "late-night", watchCount: 2 });
    expect(result.habitClock.topSegment?.share).toBeCloseTo(2 / 3);
    // 2026-07-03 是週五、07-04 是週六：週六有兩次（23:10 與 12:00）。
    expect(result.habitClock.topWeekday).toMatchObject({ label: "週六", watchCount: 2 });
  });

  it("is unavailable without watches in scope", () => {
    const result = analyze({ entries: [], episodeRecords: [] });
    expect(result.habitClock.available).toBe(false);
    expect(result.habitClock.topSegment).toBeNull();
  });
});

describe("marathon", () => {
  it("finds the peak day, longest streak, and biggest single-day run", () => {
    const records = [
      episode(1, 100, 0, "2026-06-30T00:00:00+08:00"),
      episode(2, 100, 1, "2026-07-01T00:00:00+08:00"),
      episode(3, 100, 2, "2026-07-02T00:00:00+08:00"),
      episode(4, 100, 3, "2026-07-02T12:00:00+08:00"),
      episode(5, 200, 0, "2026-07-01T00:00:00+08:00"),
      episode(6, 200, 1, "2026-07-05T00:00:00+08:00")
    ];
    const result = analyze({
      entries: [
        entry(1, "2026-07-01T20:00:00+08:00", "作品 甲"),
        entry(2, "2026-07-02T20:00:00+08:00", "作品 甲"),
        entry(3, "2026-07-03T20:00:00+08:00", "作品 甲"),
        entry(4, "2026-07-03T21:00:00+08:00", "作品 甲"),
        entry(5, "2026-07-03T22:00:00+08:00", "作品 乙"),
        entry(6, "2026-07-10T20:00:00+08:00", "作品 乙")
      ],
      episodeRecords: records,
      animeRecords: [
        animeRecord(100, [ref(1, 1), ref(2, 2), ref(3, 3), ref(4, 4)]),
        animeRecord(200, [ref(5, 1), ref(6, 2)])
      ]
    });

    expect(result.marathon.available).toBe(true);
    expect(result.marathon.peakDay).toMatchObject({
      dateKey: "2026-07-03",
      watchCount: 3,
      knownContentMinutes: 72
    });
    expect(result.marathon.longestStreak).toMatchObject({
      days: 3,
      fromDateKey: "2026-07-01",
      toDateKey: "2026-07-03"
    });
    expect(result.marathon.topSingleDayRun).toMatchObject({
      animeSn: 100,
      title: "作品 甲",
      dateKey: "2026-07-03",
      watchCount: 2
    });
  });

  it("omits a single-day run when no anime repeats within a day", () => {
    const records = [
      episode(1, 100, 0, "2026-06-30T00:00:00+08:00"),
      episode(2, 200, 0, "2026-07-01T00:00:00+08:00")
    ];
    const result = analyze({
      entries: [
        entry(1, "2026-07-03T20:00:00+08:00", "作品 甲"),
        entry(2, "2026-07-03T21:00:00+08:00", "作品 乙")
      ],
      episodeRecords: records,
      animeRecords: [animeRecord(100, [ref(1, 1)]), animeRecord(200, [ref(2, 1)])]
    });
    expect(result.marathon.peakDay).toMatchObject({ dateKey: "2026-07-03", watchCount: 2 });
    expect(result.marathon.topSingleDayRun).toBeNull();
  });
});

describe("special episode numbers", () => {
  const analyzeNumbers = (references: readonly EpisodeRef[]) => analyze({
    entries: [
      entry(1, "2026-07-11T10:00:00+08:00", "作品 A"),
      entry(2, "2026-07-12T10:00:00+08:00", "作品 A"),
      entry(9, "2026-07-12T10:30:00+08:00", "作品 B"),
      entry(3, "2026-07-13T10:00:00+08:00", "作品 A")
    ],
    episodeRecords: [
      ...references.map((reference, index): EpisodeMetadata => ({
        ...episode(reference.videoSn, 10, index, `2026-07-0${index + 1}T08:00:00+08:00`, 30),
        episodeNumber: reference.episodeNumber
      })),
      episode(9, 20, 0, "2026-07-01T08:00:00+08:00", 30)
    ],
    animeRecords: [animeRecord(10, references), animeRecord(20, [ref(9, 1)])]
  });

  it("verifies completion and preference for a group numbered exactly 1..totalEpisode", () => {
    const result = analyzeNumbers([ref(1, 1), ref(2, 2), ref(3, 3)]);
    expect(result.completion.rows.map((row) => row.animeSn)).toEqual([10, 20]);
    expect(result.preference.coverage.passed).toBe(true);
  });

  it.each([
    ["a prologue numbered 0", [ref(1, 0), ref(2, 1), ref(3, 2)]],
    ["a special numbered 1.5", [ref(1, 1), ref(2, 1.5), ref(3, 2)]]
  ] as const)("keeps release and duration facts but excludes structural results for %s", (_label, references) => {
    const result = analyzeNumbers(references);
    expect(result.summary).toMatchObject({ watchCount: 4, knownContentMinutes: 120, contentMinutes: 120 });
    // The special group is excluded, never guessed; other anime keep their results.
    expect(result.completion.rows.map((row) => row.animeSn)).toEqual([20]);
    expect(result.preference.coverage.passed).toBe(false);
    expect(result.preference.rows).toEqual([]);
  });
});
