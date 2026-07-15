import { describe, expect, it } from "vitest";
import {
  buildDebugExport,
  CACHE_EPOCH_SESSION_KEY,
  createMetadataDebugSnapshot,
  debugExportFilename,
  DEBUG_EXPORT_FORMAT,
  parseMetadataDebugSnapshotWire,
  REQUEST_STARTS_SESSION_KEY
} from "./debug-export";
import { unavailableMetadataCacheKey } from "./metadata-cache";
import type { AnimeMetadata, EpisodeMetadata, MetadataState, WatchEntry } from "./model";

describe("metadata debug snapshot", () => {
  it("exports only metadata cache records and preserves unavailable evidence", () => {
    const unavailableKey = unavailableMetadataCacheKey(20219);
    const snapshot = createMetadataDebugSnapshot({
      extensionVersion: "0.2.0",
      capturedAt: new Date("2026-07-14T12:00:00.000Z"),
      localValues: {
        "ani-gamer-heatmap-day-boundary-mode": "calendar",
        [unavailableKey]: {
          schemaVersion: 1,
          kind: "unavailable",
          videoSn: 20219,
          observedAt: "2026-07-14T11:30:00.000Z"
        }
      },
      sessionValues: {
        [CACHE_EPOCH_SESSION_KEY]: "epoch-1",
        [REQUEST_STARTS_SESSION_KEY]: [100, 200]
      }
    });

    expect(snapshot.cacheEntries).toEqual([{
      key: unavailableKey,
      value: {
        schemaVersion: 1,
        kind: "unavailable",
        videoSn: 20219,
        observedAt: "2026-07-14T11:30:00.000Z"
      }
    }]);
    expect(snapshot.coordination).toEqual({
      cacheEpoch: "epoch-1",
      requestStarts: [100, 200]
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
    expect(snapshot.coordination).toEqual({ cacheEpoch: null, requestStarts: null });

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
      sessionValues: {}
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
      historyParseIssues: []
    });

    expect(report.format).toBe(DEBUG_EXPORT_FORMAT);
    expect(report.analysisInput.watchEntries[0]?.watchedAt).toBe("2026-07-14T10:00:00.000Z");
    expect(report.analysisInput.episodes[0]?.availableFrom).toBe("2026-01-07T15:00:00.000Z");
    expect(report.analysisInput.anime[0]?.platformSnapshot.observedAt).toBe(
      "2026-07-14T12:00:00.000Z"
    );
    expect(report.diagnostics.metadata.policy).toEqual({
      unavailableCacheTtlMilliseconds: 3_600_000,
      maxRequestStartsPerRollingSecond: 10
    });
    expect(report.diagnostics.metadata.cacheEntries).toEqual(cacheSnapshot.cacheEntries);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    expect(debugExportFilename(generatedAt)).toBe(
      "ani-gamer-heatmap-debug-2026-07-14T12-34-56-789Z.json"
    );
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
