import { describe, expect, it } from "vitest";

import { analyzeWatchHistory } from "./analytics";
import { historyWindowStart, watchEntriesFromHistory, type HistoryRow, type HistoryWatch, type WatchTimePrecision } from "./history";
import {
  evaluateHistoryPage,
  evaluateIncrementalStop,
  finalizeHistoryLoad,
  historyAccountHash,
  historyCoverageFor,
  HISTORY_FULL_SYNC_INTERVAL_MILLISECONDS,
  HISTORY_PAGE_RETENTION_FLOOR_DAYS,
  historySnapshotView,
  mergeIncrementalHistory,
  parseStoredHistoryCache,
  readBahamutUserId,
  selectHistoryCache,
  serializeHistoryCache,
  shouldForceFullHistoryLoad,
  watchEntriesDiffer,
  type HistoryCacheRecord
} from "./history-cache";
import { createAnalysisScope } from "./period";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const HASH = "a".repeat(64);
const S = new Date("2026-10-15T12:00:00.000Z");

const watch = (
  videoSn: number,
  watchedAt: Date | string,
  precision: WatchTimePrecision = "minute"
): HistoryWatch => ({
  videoSn,
  watchedAt: new Date(watchedAt),
  precision,
  title: `作品 ${videoSn}`,
  episode: "第 1 集"
});

const row = (
  videoSn: number,
  watchedAt: Date | string,
  precision: WatchTimePrecision = "minute",
  relativeToNow = false
): HistoryRow => ({ ...watch(videoSn, watchedAt, precision), relativeToNow });

const before = (milliseconds: number, reference = S): Date => new Date(reference.getTime() - milliseconds);

const cacheRecord = (entries: readonly HistoryWatch[], overrides: Partial<HistoryCacheRecord> = {}): HistoryCacheRecord => ({
  accountHash: HASH,
  collectedAt: S,
  lastFullSyncAt: before(DAY),
  complete: true,
  entries,
  ...overrides
});

describe("history cache account scope", () => {
  it("reads BAHAID exactly like Bahamut's getUserid", () => {
    expect(readBahamutUserId("a=1; BAHAID=jacob123; b=2")).toBe("jacob123");
    expect(readBahamutUserId("BAHAID= Jacob123 ")).toBe("Jacob123");
    expect(readBahamutUserId("BAHAID=\"jacob\"")).toBe("jacob");
    expect(readBahamutUserId("BAHAID=%6Aacob")).toBe("jacob");
    expect(readBahamutUserId("BAHAID=guest")).toBeNull();
    expect(readBahamutUserId("BAHAID=")).toBeNull();
    expect(readBahamutUserId("BAHAID=1jacob")).toBeNull();
    expect(readBahamutUserId("BAHAID=j")).toBeNull();
    expect(readBahamutUserId("BAHAID=abcdefghijklm")).toBeNull();
    expect(readBahamutUserId("BAHAID=ja_cob")).toBeNull();
    expect(readBahamutUserId("XBAHAID=jacob; BAHAIDX=jacob")).toBeNull();
    expect(readBahamutUserId("BAHAID=%E0%A4%A; BAHAID=second")).toBe("second");
    expect(readBahamutUserId("BAHAID=first; BAHAID=second")).toBe("first");
    expect(readBahamutUserId("")).toBeNull();
  });

  it("hashes the account id one way and case-insensitively", async () => {
    const hash = await historyAccountHash("Jacob123");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await historyAccountHash("jacob123")).toBe(hash);
    expect(await historyAccountHash("other")).not.toBe(hash);
    expect(hash).not.toContain("jacob");
    await expect(historyAccountHash("guest!")).rejects.toThrow();
  });

  it("uses only a valid record of the same account that does not claim the future", () => {
    const stored = serializeHistoryCache(cacheRecord([watch(1, before(HOUR))]));
    expect(selectHistoryCache(undefined, HASH, S)).toEqual({ cache: null, status: "absent" });
    expect(selectHistoryCache({ ...stored, extra: 1 }, HASH, S)).toEqual({ cache: null, status: "invalid" });
    expect(selectHistoryCache(stored, "b".repeat(64), S)).toEqual({ cache: null, status: "account-mismatch" });
    expect(selectHistoryCache(stored, HASH, before(1))).toEqual({ cache: null, status: "invalid" });
    const loaded = selectHistoryCache(stored, HASH, S);
    expect(loaded.status).toBe("loaded");
    expect(loaded.cache?.entries).toEqual([watch(1, before(HOUR))]);
  });
});

describe("history cache record", () => {
  it("round-trips the exact v1 shape, sorted, without entries past retention", () => {
    const record = cacheRecord([
      watch(2, before(2 * HOUR), "hour"),
      watch(1, before(3 * HOUR)),
      watch(3, before(401 * DAY))
    ]);
    const stored = serializeHistoryCache(record);
    expect(stored).toEqual({
      schemaVersion: 1,
      accountHash: HASH,
      collectedAt: S.toISOString(),
      lastFullSyncAt: before(DAY).toISOString(),
      complete: true,
      entries: [
        { videoSn: 1, watchedAt: before(3 * HOUR).toISOString(), title: "作品 1", episode: "第 1 集", precision: "minute" },
        { videoSn: 2, watchedAt: before(2 * HOUR).toISOString(), title: "作品 2", episode: "第 1 集", precision: "hour" }
      ]
    });
    expect(parseStoredHistoryCache(JSON.parse(JSON.stringify(stored)))).toEqual({
      ...record,
      entries: [watch(1, before(3 * HOUR)), watch(2, before(2 * HOUR), "hour")]
    });
  });

  it.each([
    ["extra key", (value: Record<string, unknown>) => { value.extra = true; }],
    ["schema version", (value: Record<string, unknown>) => { value.schemaVersion = 2; }],
    ["uppercase hash", (value: Record<string, unknown>) => { value.accountHash = "A".repeat(64); }],
    ["non-boolean complete", (value: Record<string, unknown>) => { value.complete = 1; }],
    ["non-canonical date", (value: Record<string, unknown>) => { value.collectedAt = "2026-10-15T12:00:00Z"; }],
    ["full sync after collection", (value: Record<string, unknown>) => {
      value.lastFullSyncAt = new Date(S.getTime() + 1).toISOString();
    }],
    ["duplicate videoSn", (value: Record<string, unknown>) => {
      const entries = value.entries as Record<string, unknown>[];
      entries.push({ ...entries[0] });
    }],
    ["unknown precision", (value: Record<string, unknown>) => {
      (value.entries as Record<string, unknown>[])[0]!.precision = "second";
    }],
    ["blank title", (value: Record<string, unknown>) => {
      (value.entries as Record<string, unknown>[])[0]!.title = " ";
    }],
    ["entry past retention", (value: Record<string, unknown>) => {
      (value.entries as Record<string, unknown>[])[0]!.watchedAt = before(401 * DAY).toISOString();
    }],
    ["entry extra key", (value: Record<string, unknown>) => {
      (value.entries as Record<string, unknown>[])[0]!.dateKey = "2026-10-15";
    }]
  ])("rejects a record with %s", (_label, mutate) => {
    const value = JSON.parse(JSON.stringify(serializeHistoryCache(cacheRecord([watch(1, before(HOUR))])))) as Record<string, unknown>;
    mutate(value);
    expect(() => parseStoredHistoryCache(value)).toThrow();
  });

  it("forces a full load without a cache or once the last full sync is a week old", () => {
    expect(shouldForceFullHistoryLoad(null, S)).toBe("no-cache");
    const cache = cacheRecord([], { lastFullSyncAt: before(HISTORY_FULL_SYNC_INTERVAL_MILLISECONDS - 1) });
    expect(shouldForceFullHistoryLoad(cache, S)).toBeNull();
    expect(shouldForceFullHistoryLoad(cache, new Date(S.getTime() + 1))).toBe("full-sync-due");
    // A clock that moved back before the last full sync cannot vouch for the cache.
    expect(shouldForceFullHistoryLoad(cache, before(8 * DAY))).toBe("full-sync-due");
  });

  it("anchors the shown window and coverage at the snapshot, never at now", () => {
    // Saved at 2026-10-15 22:00 Taipei, shown the next morning.
    const collectedAt = new Date("2026-10-15T14:00:00.000Z");
    const cache = cacheRecord([
      // 2025-10-16 07:00 Taipei: the first day of both windows ending at the snapshot.
      watch(1, "2025-10-15T23:00:00.000Z"),
      watch(2, before(HOUR, collectedAt))
    ], { collectedAt, lastFullSyncAt: collectedAt });
    for (const mode of ["calendar", "thirty-hour"] as const) {
      const view = historySnapshotView({ watches: cache.entries, collectedAt, complete: true, mode });
      expect(view.coverage.coveredThrough).toEqual(collectedAt);
      expect(view.coverage.coveredFrom).toEqual(historyWindowStart(collectedAt, mode));
      // The analysis measures periods up to coveredThrough; its 365-day period
      // must be complete and include the watch on its first day.
      const result = analyzeWatchHistory({
        entries: view.entries,
        episodes: new Map(),
        anime: new Map(),
        historyCoverage: view.coverage,
        scope: createAnalysisScope({ axis: "watched-at", dayBoundaryMode: mode }, { kind: "rolling-days", days: 365 }),
        asOf: view.coverage.coveredThrough
      });
      expect(result.historyComplete).toBe(true);
      expect(result.summary.watchCount).toBe(2);
    }
    expect(historyCoverageFor({ collectedAt, complete: false, mode: "calendar" }))
      .toEqual({ coveredFrom: new Date("2025-10-15T16:00:00.000Z"), coveredThrough: collectedAt, complete: false });
  });
});

describe("incremental stop rule", () => {
  const cache = cacheRecord([
    watch(10, before(10 * MINUTE)),
    watch(11, before(3 * HOUR), "hour"),
    watch(20, before(2 * DAY)),
    watch(21, before(3 * DAY)),
    watch(30, before(30 * DAY))
  ]);

  it("stops when every row of the page predates the snapshot and matches the cache", () => {
    const page = [row(20, before(2 * DAY)), row(21, before(3 * DAY))];
    const loaded = [row(10, before(10 * MINUTE)), row(11, before(3 * HOUR), "hour"), ...page];
    expect(evaluateIncrementalStop({ cache, page, loaded })).toEqual({ stop: true });
  });

  it("applies each row's precision before the snapshot time", () => {
    const loaded = (page: HistoryRow[]) => [row(10, before(10 * MINUTE)), ...page];
    const minuteEdge = [row(10, before(MINUTE + 1))];
    expect(evaluateIncrementalStop({ cache: cacheRecord([watch(10, before(MINUTE + 1))]), page: minuteEdge, loaded: minuteEdge }))
      .toEqual({ stop: true });
    const minuteLate = [row(10, before(MINUTE))];
    expect(evaluateIncrementalStop({ cache: cacheRecord([watch(10, before(MINUTE))]), page: minuteLate, loaded: minuteLate }))
      .toEqual({ stop: false, reason: "row-after-cache" });
    const hourLate = [row(11, before(50 * MINUTE), "hour")];
    expect(evaluateIncrementalStop({ cache, page: hourLate, loaded: loaded(hourLate) }))
      .toEqual({ stop: false, reason: "row-after-cache" });
  });

  it("accepts cached times within both tolerances and rejects anything further", () => {
    const evaluate = (page: HistoryRow[]) => evaluateIncrementalStop({
      cache,
      page,
      loaded: [row(10, before(10 * MINUTE)), row(11, before(3 * HOUR), "hour"), ...page]
    });
    // Two hour labels may disagree by up to 1 h + 1 h.
    expect(evaluate([row(11, before(3 * HOUR + 110 * MINUTE), "hour")])).toEqual({ stop: true });
    expect(evaluate([row(11, before(3 * HOUR + 121 * MINUTE), "hour")]))
      .toEqual({ stop: false, reason: "row-time-mismatch" });
    expect(evaluate([row(20, before(2 * DAY + 2 * MINUTE))])).toEqual({ stop: true });
    expect(evaluate([row(20, before(2 * DAY + 2 * MINUTE + 1))]))
      .toEqual({ stop: false, reason: "row-time-mismatch" });
  });

  it("refuses rows the cache never saw and empty pages", () => {
    const page = [row(20, before(2 * DAY)), row(99, before(2 * DAY))];
    expect(evaluateIncrementalStop({ cache, page, loaded: page })).toEqual({ stop: false, reason: "row-not-cached" });
    expect(evaluateIncrementalStop({ cache, page: [], loaded: [] })).toEqual({ stop: false, reason: "empty-page" });
  });

  it("refuses when a cached watch newer than the page was not loaded", () => {
    const page = [row(20, before(2 * DAY)), row(21, before(3 * DAY))];
    // Row 11 is cached as newer than the page but has not appeared yet.
    expect(evaluateIncrementalStop({ cache, page, loaded: [row(10, before(10 * MINUTE)), ...page] }))
      .toEqual({ stop: false, reason: "ordering-violation" });
    // A cached watch within tolerance of the page's newest row may legitimately sit on the next page.
    const tied = cacheRecord([watch(20, before(2 * DAY)), watch(22, before(2 * DAY - 2 * MINUTE))]);
    expect(evaluateIncrementalStop({ cache: tied, page: [row(20, before(2 * DAY))], loaded: [row(20, before(2 * DAY))] }))
      .toEqual({ stop: true });
  });
});

describe("approximate saved times", () => {
  it("keeps paging until a watch saved only to the hour is read again", () => {
    // "1 小時前" read at 01:20 Taipei for a 23:50 watch was saved as 00:20, the
    // wrong day. Ten newer cards keep its row off page 1 on the next visit.
    const approximate = watch(99, before(6 * HOUR), "hour");
    const page1 = Array.from({ length: 10 }, (_, index) => row(10 + index, before((2 + index * 0.25) * HOUR)));
    const cache = cacheRecord([...page1.map((entry) => watch(entry.videoSn, entry.watchedAt)), approximate]);
    expect(evaluateIncrementalStop({ cache, page: page1, loaded: page1 }))
      .toEqual({ stop: false, reason: "hour-row-not-reloaded" });

    // Page 2 shows the same row with an exact label, which replaces the approximation.
    const exact = row(99, before(6 * HOUR + 30 * MINUTE));
    const page2 = [exact, row(30, before(DAY))];
    const withPage2 = cacheRecord([...cache.entries, watch(30, before(DAY))]);
    expect(evaluateIncrementalStop({ cache: withPage2, page: page2, loaded: [...page1, ...page2] })).toEqual({ stop: true });
    const result = finalizeHistoryLoad({
      end: "incremental-stop",
      rows: [...page1, ...page2],
      issueCount: 0,
      cache: withPage2,
      collectedAt: new Date(S.getTime() + DAY)
    });
    expect(result.watches.find((entry) => entry.videoSn === 99)).toMatchObject({
      watchedAt: exact.watchedAt,
      precision: "minute"
    });
  });
});

describe("history page evaluation", () => {
  const now = new Date(S.getTime() + DAY);
  const cache = cacheRecord([watch(20, before(2 * DAY)), watch(21, before(3 * DAY))]);

  it("needs zero clicks when page 1 already satisfies the rule", () => {
    expect(evaluateHistoryPage({ cache, incremental: true, pages: [[row(20, before(2 * DAY))]], collectedAt: now }))
      .toEqual({ kind: "incremental-stop" });
  });

  it("reports why it continues, and ignores the cache on a forced full load", () => {
    const pages = [[row(5, before(-HOUR)), row(20, before(2 * DAY))]];
    expect(evaluateHistoryPage({ cache, incremental: true, pages, collectedAt: now }))
      .toEqual({ kind: "continue", incrementalRejection: "row-after-cache" });
    expect(evaluateHistoryPage({ cache, incremental: false, pages: [[row(20, before(2 * DAY))]], collectedAt: now }))
      .toEqual({ kind: "continue", incrementalRejection: null });
    expect(evaluateHistoryPage({ cache: null, incremental: true, pages: [[row(20, before(2 * DAY))]], collectedAt: now }))
      .toEqual({ kind: "continue", incrementalRejection: null });
  });

  it("stops once a whole page is older than both day-boundary windows", () => {
    const old = [row(1, before(367 * DAY, now)), row(2, before(400 * DAY, now))];
    expect(evaluateHistoryPage({ cache: null, incremental: false, pages: [[row(3, before(300 * DAY, now))], old], collectedAt: now }))
      .toEqual({ kind: "window-stop" });
    // One row near the boundary keeps paging; so does an empty page.
    const edge = [row(1, before(364 * DAY, now)), row(2, before(400 * DAY, now))];
    expect(evaluateHistoryPage({ cache: null, incremental: false, pages: [[row(3, before(300 * DAY, now))], edge], collectedAt: now }).kind)
      .toBe("continue");
    expect(evaluateHistoryPage({ cache: null, incremental: false, pages: [[]], collectedAt: now }).kind).toBe("continue");
  });

  it("disables both early stops once pages are not newest-first", () => {
    const pages = [[row(20, before(3 * DAY))], [row(21, before(2 * DAY))]];
    expect(evaluateHistoryPage({ cache, incremental: true, pages, collectedAt: now }))
      .toEqual({ kind: "continue", incrementalRejection: "ordering-violation" });
    const oldAfterViolation = [...pages, [row(1, before(500 * DAY, now))]];
    expect(evaluateHistoryPage({ cache: null, incremental: false, pages: oldAfterViolation, collectedAt: now }).kind).toBe("continue");
  });
});

describe("history load merge", () => {
  const cache = cacheRecord([
    watch(10, before(2 * DAY)),
    watch(11, before(5 * HOUR), "hour"),
    watch(20, before(10 * DAY)),
    watch(30, before(40 * DAY))
  ]);

  it("keeps cached watches below a verified page and lets loaded rows win", () => {
    const now = new Date(S.getTime() + DAY);
    const result = finalizeHistoryLoad({
      end: "incremental-stop",
      rows: [
        row(40, before(-HOUR)),
        // A rewatch moves the episode up with a newer time.
        row(10, before(-2 * HOUR)),
        row(20, before(10 * DAY))
      ],
      issueCount: 0,
      cache,
      collectedAt: now
    });
    expect(result.source).toBe("incremental");
    expect(result.lastFullSyncAt).toEqual(cache.lastFullSyncAt);
    expect(result.complete).toBe(true);
    expect(result.watches.map((entry) => [entry.videoSn, entry.watchedAt.toISOString()])).toEqual([
      [30, before(40 * DAY).toISOString()],
      [20, before(10 * DAY).toISOString()],
      [11, before(5 * HOUR).toISOString()],
      [40, before(-HOUR).toISOString()],
      [10, before(-2 * HOUR).toISOString()]
    ]);
  });

  it("inherits incompleteness from the cache and from parse issues", () => {
    const base = { end: "incremental-stop" as const, rows: [row(20, before(10 * DAY))], collectedAt: S };
    expect(finalizeHistoryLoad({ ...base, issueCount: 0, cache: { ...cache, complete: false } }).complete).toBe(false);
    expect(finalizeHistoryLoad({ ...base, issueCount: 1, cache }).complete).toBe(false);
    expect(() => finalizeHistoryLoad({ ...base, issueCount: 0, cache: null })).toThrow();
  });

  it("replaces the cache entirely once the end of the history reaches every saved watch", () => {
    const now = new Date(S.getTime() + DAY);
    const result = finalizeHistoryLoad({
      end: "end-of-history",
      // Rows 11 and 20 vanished between loaded rows, so the page is authoritative.
      rows: [row(10, before(2 * DAY)), row(50, before(DAY)), row(30, before(40 * DAY))],
      issueCount: 0,
      cache,
      collectedAt: now
    });
    expect(result).toMatchObject({ source: "full", complete: true, lastFullSyncAt: now, retainedCachedEntryCount: 0 });
    expect(result.watches.map((entry) => entry.videoSn)).toEqual([30, 10, 50]);
    expect(finalizeHistoryLoad({ end: "window-stop", rows: [], issueCount: 2, cache: null, collectedAt: now }))
      .toMatchObject({ source: "full", complete: false, watches: [] });
  });

  it("keeps saved watches a full load ended before, without claiming a full sync", () => {
    // 130 daily watches; the full sync is due, but "顯示更多" vanished after 4 pages.
    const visit = new Date(S.getTime() + 8 * DAY);
    const all = Array.from({ length: 130 }, (_, index) => row(1000 + index, before((index + 1) * 2 * DAY)));
    const saved = cacheRecord(all, { lastFullSyncAt: before(8 * DAY) });
    expect(shouldForceFullHistoryLoad(saved, visit)).toBe("full-sync-due");
    const truncated = finalizeHistoryLoad({
      end: "end-of-history",
      rows: all.slice(0, 40),
      issueCount: 0,
      cache: saved,
      collectedAt: visit
    });
    expect(truncated).toMatchObject({
      source: "full",
      complete: false,
      lastFullSyncAt: saved.lastFullSyncAt,
      retainedCachedEntryCount: 90
    });
    expect(truncated.watches.map((entry) => entry.videoSn).sort()).toEqual(all.map((entry) => entry.videoSn).sort());
    // The next visit therefore retries the full load instead of trusting page 1.
    const next = { ...saved, collectedAt: visit, complete: truncated.complete, entries: truncated.watches };
    expect(shouldForceFullHistoryLoad(next, new Date(visit.getTime() + 10 * MINUTE))).toBe("full-sync-due");
  });

  it("keeps the saved history when every row of a full load fails to parse", () => {
    const result = finalizeHistoryLoad({ end: "end-of-history", rows: [], issueCount: 12, cache, collectedAt: S });
    expect(result).toMatchObject({ complete: false, lastFullSyncAt: cache.lastFullSyncAt, retainedCachedEntryCount: 4 });
    expect(result.watches.map((entry) => entry.videoSn)).toEqual([30, 20, 10, 11]);
  });

  it("lets watches near the page's retention expire at the end of the history", () => {
    const old = cacheRecord([
      watch(1, before((HISTORY_PAGE_RETENTION_FLOOR_DAYS + 1) * DAY)),
      watch(2, before(200 * DAY))
    ]);
    const result = finalizeHistoryLoad({
      end: "end-of-history",
      rows: [row(2, before(200 * DAY))],
      issueCount: 0,
      cache: old,
      collectedAt: S
    });
    expect(result).toMatchObject({ complete: true, lastFullSyncAt: S, retainedCachedEntryCount: 0 });
    expect(result.watches.map((entry) => entry.videoSn)).toEqual([2]);
    // A window stop has loaded past every saved watch the window can show.
    const windowStop = finalizeHistoryLoad({
      end: "window-stop",
      rows: [row(2, before(200 * DAY)), row(3, before(370 * DAY))],
      issueCount: 0,
      cache: old,
      collectedAt: S
    });
    expect(windowStop).toMatchObject({ complete: true, retainedCachedEntryCount: 0 });
  });

  it("keeps the cached time when a relative label merely re-describes the same watch", () => {
    const now = new Date(S.getTime() + 20 * MINUTE);
    const result = finalizeHistoryLoad({
      end: "incremental-stop",
      rows: [
        // "5 小時前" again, 20 minutes later: same watch, coarser and drifting.
        row(11, before(5 * HOUR, now), "hour", true),
        // An exact label replaces a coarse cached time.
        row(10, before(2 * DAY + 30 * MINUTE)),
        // A relative label far from the cached time is a rewatch.
        row(20, before(3 * HOUR, now), "hour", true)
      ],
      issueCount: 0,
      cache: cacheRecord([...cache.entries.filter((entry) => entry.videoSn !== 10), watch(10, before(2 * DAY), "hour")]),
      collectedAt: now
    });
    const byVideoSn = new Map(result.watches.map((entry) => [entry.videoSn, entry]));
    expect(byVideoSn.get(11)).toMatchObject({ watchedAt: before(5 * HOUR), precision: "hour" });
    expect(byVideoSn.get(10)).toMatchObject({ watchedAt: before(2 * DAY + 30 * MINUTE), precision: "minute" });
    expect(byVideoSn.get(20)).toMatchObject({ watchedAt: before(3 * HOUR, now), precision: "hour" });
  });

  it("keeps one watch per videoSn with the newest loaded time", () => {
    const merged = mergeIncrementalHistory(
      [watch(1, before(2 * HOUR)), watch(1, before(HOUR)), watch(2, before(3 * HOUR))],
      [watch(1, before(DAY)), watch(3, before(DAY))]
    );
    expect(merged.map((entry) => [entry.videoSn, entry.watchedAt.getTime()])).toEqual([
      [3, before(DAY).getTime()],
      [2, before(3 * HOUR).getTime()],
      [1, before(HOUR).getTime()]
    ]);
  });

  it("compares shown entries by videoSn and watch time only", () => {
    const entries = watchEntriesFromHistory([watch(1, before(HOUR)), watch(2, before(2 * HOUR))], "calendar", S);
    const renamed = entries.map((entry) => ({ ...entry, title: "改名" }));
    expect(watchEntriesDiffer(entries, renamed)).toBe(false);
    expect(watchEntriesDiffer(entries, entries.slice(1))).toBe(true);
    expect(watchEntriesDiffer(entries, [{ ...entries[0]!, watchedAt: before(3 * HOUR) }, entries[1]!])).toBe(true);
  });
});
