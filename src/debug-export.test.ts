import { describe, expect, it } from "vitest";
import {
  appendRequestLog,
  buildDebugExport,
  CACHE_EPOCH_SESSION_KEY,
  createMetadataDebugSnapshot,
  debugExportFilename,
  DEBUG_EXPORT_FORMAT,
  MAX_REQUEST_LOG_ENTRIES,
  parseMetadataDebugSnapshotWire,
  REQUEST_LOG_SESSION_KEY,
  REQUEST_STARTS_SESSION_KEY
} from "./debug-export";
import { emptyHistoryLoadDiagnostics, HISTORY_CACHE_STORAGE_KEY } from "./history-cache";
import { createInvalidMetadata, invalidMetadataCacheKey, unavailableMetadataCacheKey } from "./metadata-cache";
import type { AnimeMetadata, EpisodeMetadata, MetadataState, WatchEntry } from "./model";

describe("metadata debug snapshot", () => {
  it("exports only metadata cache records and preserves negative evidence", () => {
    const unavailableKey = unavailableMetadataCacheKey(20219);
    const invalidKey = invalidMetadataCacheKey(30725);
    const invalid = createInvalidMetadata(30725, "格式無效", new Date("2026-07-14T11:00:00.000Z"));
    const snapshot = createMetadataDebugSnapshot({
      extensionVersion: "0.2.0",
      capturedAt: new Date("2026-07-14T12:00:00.000Z"),
      localValues: {
        "ani-gamer-heatmap-day-boundary-mode": "calendar",
        [HISTORY_CACHE_STORAGE_KEY]: { accountHash: "a".repeat(64) },
        [unavailableKey]: {
          schemaVersion: 1,
          kind: "unavailable",
          videoSn: 20219,
          observedAt: "2026-07-14T11:30:00.000Z"
        },
        [invalidKey]: invalid
      },
      sessionValues: {
        [CACHE_EPOCH_SESSION_KEY]: "epoch-1",
        [REQUEST_STARTS_SESSION_KEY]: [100, 200],
        [REQUEST_LOG_SESSION_KEY]: [50, 100, 200]
      }
    });

    expect(snapshot.cacheEntries).toEqual([
      { key: invalidKey, value: invalid },
      {
        key: unavailableKey,
        value: {
          schemaVersion: 1,
          kind: "unavailable",
          videoSn: 20219,
          observedAt: "2026-07-14T11:30:00.000Z"
        }
      }
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("accountHash");
    expect(snapshot.coordination).toEqual({
      cacheEpoch: "epoch-1",
      requestStarts: [100, 200],
      requestLog: [50, 100, 200]
    });
    expect(parseMetadataDebugSnapshotWire(snapshot)).toEqual(snapshot);
  });

  it("uses explicit nulls for absent session state and rejects unordered cache records", () => {
    const snapshot = createMetadataDebugSnapshot({
      extensionVersion: "0.2.0",
      capturedAt: new Date("2026-07-14T12:00:00.000Z"),
      localValues: {},
      sessionValues: {}
    });
    expect(snapshot.coordination).toEqual({ cacheEpoch: null, requestStarts: null, requestLog: null });

    expect(() => parseMetadataDebugSnapshotWire({
      ...snapshot,
      cacheEntries: [
        { key: "ani-gamer-heatmap:metadata:v1:unavailable:2", value: null },
        { key: "ani-gamer-heatmap:metadata:v1:unavailable:1", value: null }
      ]
    })).toThrow(/依 key 排序/);
  });
});

describe("debug export report", () => {
  it("provides analysis-ready rows plus cache and collection diagnostics", () => {
    const generatedAt = new Date("2026-07-14T12:34:56.789Z");
    const cacheSnapshot = createMetadataDebugSnapshot({
      extensionVersion: "0.2.0",
      capturedAt: new Date("2026-07-14T12:34:55.000Z"),
      localValues: {
        [unavailableMetadataCacheKey(20219)]: {
          schemaVersion: 1,
          kind: "unavailable",
          videoSn: 20219,
          observedAt: "2026-07-14T12:00:00.000Z"
        }
      },
      sessionValues: {
        [REQUEST_LOG_SESSION_KEY]: [
          Date.parse("2026-07-14T12:29:59.000Z"),
          Date.parse("2026-07-14T12:30:01.000Z"),
          Date.parse("2026-07-14T12:30:02.500Z"),
          Date.parse("2026-07-14T12:34:00.000Z")
        ]
      }
    });
    const episode = episodeMetadata();
    const anime = animeMetadata();
    const metadataState: MetadataState = {
      episodes: new Map([[episode.videoSn, episode]]),
      anime: new Map([[anime.animeSn, anime]]),
      issues: [{ videoSn: 20219, kind: "unavailable", message: "目前沒有公開資料" }],
      progress: {
        phase: "resolving",
        total: 2,
        completed: 1,
        available: 0,
        unavailable: 1,
        failed: 0
      }
    };
    const entries: WatchEntry[] = [{
      videoSn: 49054,
      dateKey: "2026-07-14",
      watchedAt: new Date("2026-07-14T10:00:00.000Z"),
      title: "測試作品",
      episode: "第 1 集"
    }];

    const report = buildDebugExport({
      generatedAt,
      cacheSnapshot,
      entries,
      metadataState,
      dayBoundaryMode: "thirty-hour",
      historyStatus: "ready",
      historyCollectedAt: new Date("2026-07-14T12:30:00.000Z"),
      loadedCompleteHistory: true,
      historyCoverage: {
        coveredFrom: new Date("2025-07-15T00:00:00.000Z"),
        coveredThrough: new Date("2026-07-14T12:30:00.000Z"),
        complete: true
      },
      historyParseIssues: [],
      historyLoad: {
        ...emptyHistoryLoadDiagnostics(),
        source: "incremental",
        cacheStatus: "loaded",
        cachedEntryCount: 1,
        end: "incremental-stop",
        clickCount: 1,
        rowsPerPage: [12, 30],
        durationMilliseconds: 840,
        incrementalStopFired: true,
        retainedCachedEntryCount: 0,
        refreshSkipped: null,
        cacheWrite: "written"
      },
      metadataCollectionStartedAt: new Date("2026-07-14T12:30:00.000Z"),
      metadataCollectionFinishedAt: new Date("2026-07-14T12:31:00.000Z")
    });

    expect(report.format).toBe(DEBUG_EXPORT_FORMAT);
    expect(report.analysisInput.watchEntries[0]?.watchedAt).toBe("2026-07-14T10:00:00.000Z");
    expect(report.analysisInput.episodes[0]?.availableFrom).toBe("2026-01-07T15:00:00.000Z");
    expect(report.analysisInput.anime[0]?.platformSnapshot.observedAt).toBe(
      "2026-07-14T12:00:00.000Z"
    );
    expect(report.formatVersion).toBe(2);
    expect(report.diagnostics.metadata.policy).toEqual({
      parserVersion: 3,
      animeCacheTtlMilliseconds: 86_400_000,
      unavailableCacheBaseTtlMilliseconds: 86_400_000,
      unavailableCacheBackoffFactor: 4,
      unavailableCacheMaxTtlMilliseconds: 604_800_000,
      unavailableCacheJitterRatio: 0.2,
      invalidResponseCacheTtlMilliseconds: 86_400_000,
      maxRequestStartsPerRollingSecond: 10
    });
    expect(report.diagnostics.metadata.collection).toEqual({
      startedAt: "2026-07-14T12:30:00.000Z",
      finishedAt: "2026-07-14T12:31:00.000Z",
      networkRequests: {
        scope: "extension-wide",
        count: 2,
        firstStartedAt: "2026-07-14T12:30:01.000Z",
        lastStartedAt: "2026-07-14T12:30:02.500Z",
        spanMilliseconds: 1_500
      }
    });
    expect(report.diagnostics.history.load).toMatchObject({
      source: "incremental",
      clickCount: 1,
      rowsPerPage: [12, 30],
      durationMilliseconds: 840,
      incrementalStopFired: true,
      retainedCachedEntryCount: 0,
      refreshSkipped: null
    });
    expect(report.diagnostics.history.policy).toEqual({
      cacheRetentionDays: 400,
      fullSyncIntervalMilliseconds: 604_800_000
    });
    expect(report.diagnostics.metadata.cacheEntries).toEqual(cacheSnapshot.cacheEntries);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    expect(debugExportFilename(generatedAt)).toBe(
      "ani-gamer-heatmap-debug-2026-07-14T12-34-56-789Z.json"
    );
  });
});

describe("metadata request log", () => {
  it("appends in order, restarts a malformed log, and keeps only the newest starts", () => {
    expect(appendRequestLog(undefined, 10)).toEqual([10]);
    expect(appendRequestLog([1, 2], 3)).toEqual([1, 2, 3]);
    expect(appendRequestLog([5], 3)).toEqual([5, 5]);
    expect(appendRequestLog([3, 1], 4)).toEqual([4]);
    expect(appendRequestLog("bad", 4)).toEqual([4]);
    const full = Array.from({ length: MAX_REQUEST_LOG_ENTRIES }, (_, index) => index);
    const next = appendRequestLog(full, MAX_REQUEST_LOG_ENTRIES);
    expect(next).toHaveLength(MAX_REQUEST_LOG_ENTRIES);
    expect(next[0]).toBe(1);
    expect(() => appendRequestLog([], Number.NaN)).toThrow();
  });
});

const episodeMetadata = (): EpisodeMetadata => ({
  videoSn: 49054,
  animeSn: 113583,
  groupKey: "0",
  episodeIndex: 0,
  episodeNumber: 1,
  availableFrom: new Date("2026-01-07T15:00:00.000Z"),
  availableUntil: null,
  durationMinutes: 47,
  coverUrl: "https://i2.bahamut.com.tw/anime/episode.jpg",
  videoType: 1,
  fetchedAt: new Date("2026-07-14T12:00:00.000Z")
});

const animeMetadata = (): AnimeMetadata => ({
  animeSn: 113583,
  apiTitle: "測試作品",
  totalEpisode: 12,
  isOngoing: false,
  seasonStartDateKey: "2026-01-07",
  seasonEndDateKey: "2026-07-27",
  coverUrl: "https://i2.bahamut.com.tw/anime/cover.jpg",
  tags: ["奇幻"],
  maker: "測試動畫公司",
  director: "測試導演",
  publisher: "測試代理商",
  episodeRefs: [{
    videoSn: 49054,
    episodeNumber: 1,
    groupKey: "0",
    coverUrl: "https://i2.bahamut.com.tw/anime/episode.jpg"
  }],
  platformSnapshot: {
    score: 4.8,
    reviewCount: 100,
    popular: 5000,
    observedAt: new Date("2026-07-14T12:00:00.000Z")
  },
  fetchedAt: new Date("2026-07-14T12:00:00.000Z")
});
