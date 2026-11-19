import { describe, expect, it } from "vitest";
import { analyzeWatchHistory } from "./analytics";
import type { AnimeMetadata, DayBoundaryMode, EpisodeMetadata, WatchEntry } from "./model";
import type { AnalysisScope } from "./period";
import { toTaipeiDateKey } from "./time";

const date = (day: string, time = "12:00") => new Date(`${day}T${time}:00+08:00`);
const asOf = date("2026-03-31", "23:59");

const season = (
  dates: readonly Date[],
  overrides: Partial<AnimeMetadata> = {},
  firstNumber = 1,
  animeSn = 10
) => {
  const entries: WatchEntry[] = dates.map((watchedAt, index) => ({
    videoSn: animeSn * 100 + index,
    watchedAt,
    dateKey: toTaipeiDateKey(watchedAt),
    title: `作品 ${animeSn}`,
    episode: `第 ${firstNumber + index} 集`
  }));
  const episodes: EpisodeMetadata[] = entries.map((entry, index) => ({
    videoSn: entry.videoSn,
    animeSn,
    groupKey: "0",
    episodeIndex: index,
    episodeNumber: firstNumber + index,
    availableFrom: date("2025-12-01"),
    availableUntil: null,
    durationMinutes: 24,
    coverUrl: null,
    videoType: 0,
    fetchedAt: asOf
  }));
  const anime: AnimeMetadata = {
    animeSn,
    apiTitle: `作品 ${animeSn}`,
    totalEpisode: dates.length,
    isOngoing: false,
    seasonStartDateKey: "2025-10-01",
    seasonEndDateKey: "2025-12-31",
    coverUrl: null,
    tags: [],
    maker: null,
    director: null,
    publisher: null,
    episodeRefs: episodes.map((episode) => ({
      videoSn: episode.videoSn, episodeNumber: episode.episodeNumber, groupKey: "0", coverUrl: null
    })),
    platformSnapshot: { score: 4, popular: 100, reviewCount: 10, observedAt: asOf },
    fetchedAt: asOf,
    ...overrides
  };
  return { entries, episodes, anime };
};

const analyze = (
  seasons: readonly ReturnType<typeof season>[],
  period: AnalysisScope["period"] = { kind: "calendar-month", year: 2026, month: 1 },
  mode: DayBoundaryMode = "calendar",
  released = false
) => analyzeWatchHistory({
  entries: seasons.flatMap((value) => value.entries),
  episodes: new Map(seasons.flatMap((value) => value.episodes.map((episode) => [episode.videoSn, episode] as const))),
  anime: new Map(seasons.map((value) => [value.anime.animeSn, value.anime])),
  historyCoverage: { complete: true, coveredFrom: date("2025-04-01"), coveredThrough: asOf },
  scope: released ? { axis: "released-at", period } : { axis: "watched-at", dayBoundaryMode: mode, period },
  asOf
});

const fourDays = [date("2026-01-01"), date("2026-01-02"), date("2026-01-04"), date("2026-01-05")];

describe("single-season binge completion", () => {
  it("uses official ending dates without imposing a seven-day speed threshold", () => {
    const data = season([date("2026-01-01"), date("2026-01-05"), date("2026-01-10"), date("2026-01-13")]);
    expect(analyze([data]).binge.rows[0]).toMatchObject({
      episodeCount: 4, elapsedMinutes: 12 * 1440, spanDays: 13, activeDayCount: 4, episodesPerDay: 4 / 13
    });
  });

  it("includes catching up at the end even when the season was started while airing", () => {
    const data = season([
      date("2025-12-10"), date("2025-12-17"), ...fourDays
    ]);
    expect(analyze([data]).binge.rows[0]).toMatchObject({
      episodeCount: 6, startedAt: date("2025-12-10"), completedAt: date("2026-01-05")
    });
  });

  it("does not turn normal weekly following into binge completion", () => {
    const data = season([
      date("2026-01-01"), date("2026-01-08"), date("2026-01-15"), date("2026-01-22")
    ], { seasonEndDateKey: "2026-01-22" });
    expect(analyze([data]).binge).toEqual({ available: false, rows: [] });
  });

  it("never overrides a known future ending date or a positive ongoing marker with the proxy", () => {
    expect(analyze([season(fourDays, { seasonEndDateKey: "2026-03-01" })]).binge.available).toBe(false);
    expect(analyze([season(fourDays, { seasonEndDateKey: null, isOngoing: true })]).binge.available).toBe(false);
  });

  it("treats the ending date at day precision, independent of the 30H watch boundary", () => {
    const data = season([date("2026-01-01", "01:00"), date("2026-01-01", "02:00")]);
    expect(analyze([data], { kind: "rolling-days", days: 365 }, "thirty-hour").binge.available).toBe(true);
    const endingToday = { ...data, anime: { ...data.anime, seasonEndDateKey: "2026-01-01" } };
    expect(analyze([endingToday]).binge.available).toBe(false);
  });

  it("uses exactly a rolling 168 hours only when official ending information is absent", () => {
    const start = date("2026-01-03", "20:00");
    const end = new Date(start.getTime() + 168 * 3_600_000);
    const data = season([start, date("2026-01-04"), date("2026-01-08"), end], { seasonEndDateKey: null });
    expect(analyze([data]).binge.available).toBe(true);
    data.entries[3] = { ...data.entries[3]!, watchedAt: new Date(end.getTime() + 60_000) };
    expect(analyze([data]).binge.available).toBe(false);
  });

  it("resolves a same-day ending from the final release time, or uses the proxy if that time is inconclusive", () => {
    const data = season([10, 11, 12, 13].map((hour) => date("2026-01-05", `${hour}:00`)), { seasonEndDateKey: "2026-01-05" });
    data.episodes[3] = { ...data.episodes[3]!, availableFrom: date("2026-01-05", "09:00") };
    expect(analyze([data]).binge.available).toBe(true);
    data.episodes[3] = { ...data.episodes[3]!, availableFrom: date("2026-01-05", "12:00") };
    expect(analyze([data]).binge.available).toBe(false);
    data.episodes[3] = { ...data.episodes[3]!, availableFrom: date("2025-12-01") };
    expect(analyze([data]).binge.available).toBe(true);
  });

  it("uses the catalog's final four episodes rather than the last four watch events", () => {
    const data = season([
      date("2026-01-20"), date("2026-01-20"), date("2026-01-01"),
      date("2026-01-10"), date("2026-01-20"), date("2026-01-20")
    ], { seasonEndDateKey: null });
    expect(analyze([data]).binge.available).toBe(false);
  });

  it("does not require episode order and finishes when the last missing episode is observed", () => {
    const data = season([date("2026-01-02"), date("2026-01-04"), date("2026-01-03"), date("2026-01-01")]);
    data.entries.reverse();
    expect(analyze([data]).binge.rows[0]).toMatchObject({
      startedAt: date("2026-01-01"), completedAt: date("2026-01-04"), spanDays: 4
    });
  });

  it("does not let repeated watches inflate episode counts or extend a completed journey", () => {
    const data = season(fourDays);
    data.entries.push({ ...data.entries[0]!, watchedAt: date("2026-01-25") });
    expect(analyze([data]).binge.rows[0]).toMatchObject({ episodeCount: 4, completedAt: date("2026-01-05"), episodesPerDay: 0.8 });
  });

  it("supports continuation numbering and keeps different seasons separate", () => {
    const first = season(fourDays);
    const second = season(fourDays, {}, 13, 20);
    const result = analyze([first, second]);
    expect(result.binge.rows.map((row) => row.animeSn)).toEqual([10, 20]);
    expect(result.completion.rows.map((row) => row.ratio)).toEqual([1, 1]);
  });

  it("rejects missing watches, missing metadata, and mismatched or impossible release facts", () => {
    const missingWatch = season(fourDays);
    missingWatch.entries.splice(1, 1);
    const missingMetadata = season(fourDays);
    missingMetadata.episodes.splice(1, 1);
    const wrongGroup = season(fourDays);
    wrongGroup.episodes[1] = { ...wrongGroup.episodes[1]!, groupKey: "dub" };
    const futureRelease = season(fourDays);
    futureRelease.episodes[1] = { ...futureRelease.episodes[1]!, availableFrom: date("2026-01-30") };
    for (const data of [missingWatch, missingMetadata, wrongGroup, futureRelease]) {
      expect(analyze([data]).binge.available).toBe(false);
    }
  });

  it("does not guess catalog structure for gaps, duplicate numbers, specials, or multiple groups", () => {
    for (const numbers of [[1, 2, 4, 5], [1, 2, 2, 3], [0, 1, 2, 3], [1, 2, 2.5, 3]]) {
      const data = season(fourDays);
      data.anime = { ...data.anime, episodeRefs: data.anime.episodeRefs.map((ref, index) => ({ ...ref, episodeNumber: numbers[index]! })) };
      expect(analyze([data]).binge.available).toBe(false);
    }
    const multipleGroups = season(fourDays);
    multipleGroups.anime = { ...multipleGroups.anime, episodeRefs: multipleGroups.anime.episodeRefs.map((ref, index) => ({ ...ref, groupKey: index === 3 ? "special" : "0" })) };
    expect(analyze([multipleGroups]).binge.available).toBe(false);
  });

  it("requires four episodes for the proxy but supports officially ended short seasons", () => {
    expect(analyze([season(fourDays.slice(0, 3), { seasonEndDateKey: null })]).binge.available).toBe(false);
    expect(analyze([season(fourDays.slice(0, 3))]).binge.available).toBe(true);
    expect(analyze([season(fourDays.slice(0, 1))]).binge.available).toBe(false);
  });

  it("attributes cross-month completion once, preserving the full viewing span", () => {
    const data = season([date("2026-01-30"), date("2026-01-31"), date("2026-02-01"), date("2026-02-02")]);
    const january = analyze([data]);
    expect(january.binge.available).toBe(false);
    expect(january.completion.rows[0]?.ratio).toBe(0.5);
    const february = analyze([data], { kind: "calendar-month", year: 2026, month: 2 });
    expect(february.binge.rows[0]).toMatchObject({
      startedAt: date("2026-01-30"), completedAt: date("2026-02-02"), elapsedMinutes: 3 * 1440, spanDays: 4
    });
    expect(analyze([data], { kind: "calendar-month", year: 2026, month: 3 }).binge.available).toBe(false);
  });

  it("uses inclusive logical watch days, including idle days, without changing elapsed time", () => {
    const data = season([date("2026-01-02", "23:00"), date("2026-01-03", "00:00"), date("2026-01-03", "01:00"), date("2026-01-03", "02:00")]);
    expect(analyze([data]).binge.rows[0]).toMatchObject({ elapsedMinutes: 180, spanDays: 2, episodesPerDay: 2 });
    expect(analyze([data], undefined, "thirty-hour").binge.rows[0]).toMatchObject({ elapsedMinutes: 180, spanDays: 1, episodesPerDay: 4 });
    expect(analyze([season(fourDays)]).binge.rows[0]).toMatchObject({ spanDays: 5, activeDayCount: 4, episodesPerDay: 0.8 });
  });

  it("ranks daily episode rates across different season lengths, sharing ranks independently of elapsed time", () => {
    const watches = (count: number, lastDay: string) => Array.from(
      { length: count }, (_, index) => date(index === 0 ? "2026-01-01" : lastDay)
    );
    const shorter = season(watches(12, "2026-01-05"), {}, 1, 10);
    const faster = season(watches(24, "2026-01-08"), {}, 1, 20);
    const equalRate = season(watches(24, "2026-01-10"), {}, 1, 30);
    const slower = season(watches(12, "2026-01-06"), {}, 1, 40);
    expect(analyze([shorter, equalRate, slower, faster]).binge.rows.map((row) => [
      row.animeSn, row.rank, row.episodesPerDay, row.elapsedMinutes
    ])).toEqual([
      [20, 1, 3, 7 * 1440],
      [10, 2, 2.4, 4 * 1440],
      [30, 2, 2.4, 9 * 1440],
      [40, 4, 2, 5 * 1440]
    ]);
  });

  it("orders equal daily rates and elapsed times deterministically", () => {
    const slow = season(fourDays, {}, 1, 30);
    const fast = season(fourDays.map(() => date("2026-01-01")), {}, 1, 20);
    const tie = season(fourDays.map(() => date("2026-01-01")), {}, 13, 10);
    expect(analyze([slow, fast, tie]).binge.rows.map((row) => [row.animeSn, row.rank])).toEqual([[10, 1], [20, 1], [30, 3]]);
  });

  it("omits completion rankings on the release-time axis", () => {
    expect(analyze([season(fourDays)], { kind: "rolling-days", days: 365 }, "calendar", true).binge).toEqual({ available: false, rows: [] });
  });
});
