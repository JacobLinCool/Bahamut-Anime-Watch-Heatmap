import type { HistoryCoverage } from "./analytics";
import {
  HISTORY_CACHE_RETENTION_DAYS,
  HISTORY_FULL_SYNC_INTERVAL_MILLISECONDS,
  type HistoryLoadDiagnostics
} from "./history-cache";
import {
  INVALID_RESPONSE_CACHE_TTL_MILLISECONDS,
  isMetadataV1CacheKey,
  serializeAnimeMetadata,
  serializeEpisodeMetadata,
  UNAVAILABLE_CACHE_BACKOFF_FACTOR,
  UNAVAILABLE_CACHE_BASE_TTL_MILLISECONDS,
  UNAVAILABLE_CACHE_JITTER_RATIO,
  UNAVAILABLE_CACHE_MAX_TTL_MILLISECONDS,
  type StoredAnimeMetadata,
  type StoredEpisodeMetadata
} from "./metadata-cache";
import { MAX_METADATA_REQUESTS_PER_SECOND } from "./metadata-coordinator";
import { METADATA_PARSER_VERSION } from "./metadata-schema";
import type { HistoryParseIssue } from "./history";
import type {
  DayBoundaryMode,
  MetadataIssue,
  MetadataProgress,
  MetadataState,
  WatchEntry
} from "./model";

export const DEBUG_EXPORT_FORMAT = "ani-gamer-heatmap-debug";
export const DEBUG_EXPORT_FORMAT_VERSION = 2;

export const CACHE_EPOCH_SESSION_KEY = "ani-gamer-heatmap:metadata-cache-epoch:v1";
export const REQUEST_STARTS_SESSION_KEY = "ani-gamer-heatmap:metadata-request-starts:v1";
/** Recent network request starts (epoch ms), kept only for diagnostics. */
export const REQUEST_LOG_SESSION_KEY = "ani-gamer-heatmap:metadata-request-log:v1";
export const MAX_REQUEST_LOG_ENTRIES = 2_000;

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type MetadataDebugCacheEntry = {
  readonly key: string;
  readonly value: JsonValue;
};

export type MetadataDebugSnapshotWire = {
  readonly capturedAt: string;
  readonly extensionVersion: string;
  readonly cacheEntries: readonly MetadataDebugCacheEntry[];
  readonly coordination: {
    readonly cacheEpoch: JsonValue;
    readonly requestStarts: JsonValue;
    readonly requestLog: JsonValue;
  };
};

/** Network request starts that fell inside one metadata collection, across all tabs. */
export type MetadataCollectionDiagnostics = {
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly networkRequests: {
    readonly scope: "extension-wide";
    readonly count: number | null;
    readonly firstStartedAt: string | null;
    readonly lastStartedAt: string | null;
    readonly spanMilliseconds: number | null;
  };
};

export type DebugWatchEntry = Omit<WatchEntry, "watchedAt"> & {
  readonly watchedAt: string;
};

export type AniGamerDebugExport = {
  readonly format: typeof DEBUG_EXPORT_FORMAT;
  readonly formatVersion: typeof DEBUG_EXPORT_FORMAT_VERSION;
  readonly generatedAt: string;
  readonly extensionVersion: string;
  readonly analysisInput: {
    readonly dayBoundaryMode: DayBoundaryMode;
    readonly watchEntries: readonly DebugWatchEntry[];
    readonly episodes: readonly StoredEpisodeMetadata[];
    readonly anime: readonly StoredAnimeMetadata[];
  };
  readonly diagnostics: {
    readonly history: {
      readonly status: "loading" | "ready" | "error";
      readonly error: string | null;
      readonly collectedAt: string | null;
      readonly loadedCompleteHistory: boolean;
      readonly coverage: {
        readonly coveredFrom: string;
        readonly coveredThrough: string;
        readonly complete: boolean;
      };
      readonly parseIssues: readonly HistoryParseIssue[];
      readonly load: HistoryLoadDiagnostics;
      readonly policy: {
        readonly cacheRetentionDays: number;
        readonly fullSyncIntervalMilliseconds: number;
      };
    };
    readonly metadata: {
      readonly progress: MetadataProgress;
      readonly issues: readonly MetadataIssue[];
      readonly collection: MetadataCollectionDiagnostics;
      readonly policy: {
        readonly parserVersion: number;
        readonly unavailableCacheBaseTtlMilliseconds: number;
        readonly unavailableCacheBackoffFactor: number;
        readonly unavailableCacheMaxTtlMilliseconds: number;
        readonly unavailableCacheJitterRatio: number;
        readonly invalidResponseCacheTtlMilliseconds: number;
        readonly maxRequestStartsPerRollingSecond: number;
      };
      readonly cacheCapturedAt: string;
      readonly cacheEntries: readonly MetadataDebugCacheEntry[];
      readonly coordination: MetadataDebugSnapshotWire["coordination"];
    };
  };
};

export type CreateMetadataDebugSnapshotInput = {
  readonly extensionVersion: string;
  readonly capturedAt: Date;
  readonly localValues: Readonly<Record<string, unknown>>;
  readonly sessionValues: Readonly<Record<string, unknown>>;
};

export const createMetadataDebugSnapshot = (
  input: CreateMetadataDebugSnapshotInput
): MetadataDebugSnapshotWire => {
  assertNonBlankString(input.extensionVersion, "extensionVersion");
  const capturedAt = canonicalIso(input.capturedAt, "capturedAt");
  const cacheEntries = Object.keys(input.localValues)
    .filter(isMetadataV1CacheKey)
    .sort()
    .map((key): MetadataDebugCacheEntry => ({
      key,
      value: requireJsonValue(input.localValues[key], `localValues[${JSON.stringify(key)}]`)
    }));

  return {
    capturedAt,
    extensionVersion: input.extensionVersion,
    cacheEntries,
    coordination: {
      cacheEpoch: optionalStorageValue(input.sessionValues, CACHE_EPOCH_SESSION_KEY),
      requestStarts: optionalStorageValue(input.sessionValues, REQUEST_STARTS_SESSION_KEY),
      requestLog: optionalStorageValue(input.sessionValues, REQUEST_LOG_SESSION_KEY)
    }
  };
};

export const parseRequestLog = (value: unknown): number[] => {
  if (!Array.isArray(value) || value.length > MAX_REQUEST_LOG_ENTRIES) {
    throw new Error(`metadata request log 必須是最多 ${MAX_REQUEST_LOG_ENTRIES} 筆的 array`);
  }
  return value.map((timestamp, index) => {
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp < 0) {
      throw new Error("metadata request log timestamp 必須是有限非負數");
    }
    const previous = value[index - 1] as number | undefined;
    if (previous !== undefined && timestamp < previous) {
      throw new Error("metadata request log 必須是非遞減排序");
    }
    return timestamp;
  });
};

/** Appends one start; an absent or malformed log restarts, since it is diagnostics only. */
export const appendRequestLog = (value: unknown, timestamp: number): number[] => {
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new Error("metadata request log timestamp 必須是有限非負數");
  }
  let log: number[];
  try {
    log = value === undefined ? [] : parseRequestLog(value);
  } catch {
    log = [];
  }
  const next = [...log, Math.max(timestamp, log.at(-1) ?? 0)];
  return next.slice(Math.max(0, next.length - MAX_REQUEST_LOG_ENTRIES));
};

export const parseMetadataDebugSnapshotWire = (value: unknown): MetadataDebugSnapshotWire => {
  const snapshot = requireExactRecord(value, [
    "cacheEntries",
    "capturedAt",
    "coordination",
    "extensionVersion"
  ], "metadata debug snapshot");
  assertCanonicalIsoString(snapshot.capturedAt, "metadata debug snapshot.capturedAt");
  assertNonBlankString(snapshot.extensionVersion, "metadata debug snapshot.extensionVersion");

  if (!Array.isArray(snapshot.cacheEntries)) {
    throw new Error("metadata debug snapshot.cacheEntries 必須是 array");
  }
  const seen = new Set<string>();
  const cacheEntries = snapshot.cacheEntries.map((value, index): MetadataDebugCacheEntry => {
    const entry = requireExactRecord(value, ["key", "value"], `metadata debug cacheEntries[${index}]`);
    if (typeof entry.key !== "string" || !isMetadataV1CacheKey(entry.key)) {
      throw new Error(`metadata debug cacheEntries[${index}].key 無效`);
    }
    if (seen.has(entry.key)) {
      throw new Error(`metadata debug cacheEntries 有重複 key：${entry.key}`);
    }
    seen.add(entry.key);
    return {
      key: entry.key,
      value: requireJsonValue(entry.value, `metadata debug cacheEntries[${index}].value`)
    };
  });
  if (!cacheEntries.every((entry, index) => index === 0 || cacheEntries[index - 1]!.key < entry.key)) {
    throw new Error("metadata debug cacheEntries 必須依 key 排序");
  }

  const coordination = requireExactRecord(
    snapshot.coordination,
    ["cacheEpoch", "requestLog", "requestStarts"],
    "metadata debug snapshot.coordination"
  );
  return {
    capturedAt: snapshot.capturedAt as string,
    extensionVersion: snapshot.extensionVersion as string,
    cacheEntries,
    coordination: {
      cacheEpoch: requireJsonValue(coordination.cacheEpoch, "metadata debug coordination.cacheEpoch"),
      requestStarts: requireJsonValue(
        coordination.requestStarts,
        "metadata debug coordination.requestStarts"
      ),
      requestLog: requireJsonValue(coordination.requestLog, "metadata debug coordination.requestLog")
    }
  };
};

export type BuildDebugExportInput = {
  readonly generatedAt: Date;
  readonly cacheSnapshot: MetadataDebugSnapshotWire;
  readonly entries: readonly WatchEntry[];
  readonly metadataState: MetadataState;
  readonly dayBoundaryMode: DayBoundaryMode;
  readonly historyStatus: "loading" | "ready" | "error";
  readonly historyError?: string;
  readonly historyCollectedAt?: Date;
  readonly loadedCompleteHistory: boolean;
  readonly historyCoverage: HistoryCoverage;
  readonly historyParseIssues: readonly HistoryParseIssue[];
  readonly historyLoad: HistoryLoadDiagnostics;
  readonly metadataCollectionStartedAt?: Date;
  readonly metadataCollectionFinishedAt?: Date;
};

export const buildDebugExport = (input: BuildDebugExportInput): AniGamerDebugExport => {
  const cacheSnapshot = parseMetadataDebugSnapshotWire(input.cacheSnapshot);
  const generatedAt = canonicalIso(input.generatedAt, "generatedAt");
  const watchEntries = input.entries
    .map((entry): DebugWatchEntry => ({
      videoSn: entry.videoSn,
      dateKey: entry.dateKey,
      watchedAt: canonicalIso(entry.watchedAt, `watchEntries[${entry.videoSn}].watchedAt`),
      title: entry.title,
      episode: entry.episode
    }))
    .sort((left, right) => left.watchedAt.localeCompare(right.watchedAt) || left.videoSn - right.videoSn);
  const episodes = [...input.metadataState.episodes.values()]
    .map(serializeEpisodeMetadata)
    .sort((left, right) => left.videoSn - right.videoSn);
  const anime = [...input.metadataState.anime.values()]
    .map(serializeAnimeMetadata)
    .sort((left, right) => left.animeSn - right.animeSn);

  return {
    format: DEBUG_EXPORT_FORMAT,
    formatVersion: DEBUG_EXPORT_FORMAT_VERSION,
    generatedAt,
    extensionVersion: cacheSnapshot.extensionVersion,
    analysisInput: {
      dayBoundaryMode: input.dayBoundaryMode,
      watchEntries,
      episodes,
      anime
    },
    diagnostics: {
      history: {
        status: input.historyStatus,
        error: input.historyError ?? null,
        collectedAt: input.historyCollectedAt
          ? canonicalIso(input.historyCollectedAt, "historyCollectedAt")
          : null,
        loadedCompleteHistory: input.loadedCompleteHistory,
        coverage: {
          coveredFrom: canonicalIso(input.historyCoverage.coveredFrom, "historyCoverage.coveredFrom"),
          coveredThrough: canonicalIso(
            input.historyCoverage.coveredThrough,
            "historyCoverage.coveredThrough"
          ),
          complete: input.historyCoverage.complete
        },
        parseIssues: input.historyParseIssues.map((issue) => ({ ...issue })),
        load: { ...input.historyLoad, rowsPerPage: [...input.historyLoad.rowsPerPage] },
        policy: {
          cacheRetentionDays: HISTORY_CACHE_RETENTION_DAYS,
          fullSyncIntervalMilliseconds: HISTORY_FULL_SYNC_INTERVAL_MILLISECONDS
        }
      },
      metadata: {
        progress: { ...input.metadataState.progress },
        issues: input.metadataState.issues.map((issue) => ({ ...issue })),
        collection: metadataCollectionDiagnostics(
          cacheSnapshot.coordination.requestLog,
          input.metadataCollectionStartedAt,
          input.metadataCollectionFinishedAt ?? new Date(cacheSnapshot.capturedAt)
        ),
        policy: {
          parserVersion: METADATA_PARSER_VERSION,
          unavailableCacheBaseTtlMilliseconds: UNAVAILABLE_CACHE_BASE_TTL_MILLISECONDS,
          unavailableCacheBackoffFactor: UNAVAILABLE_CACHE_BACKOFF_FACTOR,
          unavailableCacheMaxTtlMilliseconds: UNAVAILABLE_CACHE_MAX_TTL_MILLISECONDS,
          unavailableCacheJitterRatio: UNAVAILABLE_CACHE_JITTER_RATIO,
          invalidResponseCacheTtlMilliseconds: INVALID_RESPONSE_CACHE_TTL_MILLISECONDS,
          maxRequestStartsPerRollingSecond: MAX_METADATA_REQUESTS_PER_SECOND
        },
        cacheCapturedAt: cacheSnapshot.capturedAt,
        cacheEntries: cacheSnapshot.cacheEntries.map((entry) => ({ ...entry })),
        coordination: { ...cacheSnapshot.coordination }
      }
    }
  };
};

const metadataCollectionDiagnostics = (
  requestLog: JsonValue,
  startedAt: Date | undefined,
  finishedAt: Date
): MetadataCollectionDiagnostics => {
  const started = startedAt ? canonicalIso(startedAt, "metadataCollectionStartedAt") : null;
  const finished = startedAt ? canonicalIso(finishedAt, "metadataCollectionFinishedAt") : null;
  let starts: number[] | null = null;
  if (startedAt) {
    try {
      starts = (requestLog === null ? [] : parseRequestLog(requestLog)).filter((timestamp) =>
        timestamp >= startedAt.getTime() && timestamp <= finishedAt.getTime());
    } catch {
      starts = null;
    }
  }
  const first = starts?.[0];
  const last = starts?.at(-1);
  return {
    startedAt: started,
    finishedAt: finished,
    networkRequests: {
      scope: "extension-wide",
      count: starts?.length ?? null,
      firstStartedAt: first === undefined ? null : new Date(first).toISOString(),
      lastStartedAt: last === undefined ? null : new Date(last).toISOString(),
      spanMilliseconds: first === undefined || last === undefined ? null : last - first
    }
  };
};

export const debugExportFilename = (generatedAt: Date): string => {
  const timestamp = canonicalIso(generatedAt, "generatedAt").replace(/[:.]/g, "-");
  return `ani-gamer-heatmap-debug-${timestamp}.json`;
};

export const downloadDebugExport = (
  report: AniGamerDebugExport,
  documentRoot: Document = document
): string => {
  const generatedAt = new Date(report.generatedAt);
  const filename = debugExportFilename(generatedAt);
  const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], {
    type: "application/json;charset=utf-8"
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = documentRoot.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.hidden = true;
  anchor.dataset.aniHeatmapOwned = "true";
  anchor.addEventListener("click", (event) => event.stopPropagation());
  documentRoot.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  return filename;
};

const optionalStorageValue = (
  values: Readonly<Record<string, unknown>>,
  key: string
): JsonValue => Object.hasOwn(values, key)
  ? requireJsonValue(values[key], `sessionValues[${JSON.stringify(key)}]`)
  : null;

const requireJsonValue = (value: unknown, label: string, depth = 0): JsonValue => {
  if (depth > 100) {
    throw new Error(`${label} 的巢狀層級過深`);
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} 必須是有限數值`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => requireJsonValue(item, `${label}[${index}]`, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      requireJsonValue(item, `${label}.${key}`, depth + 1)
    ]));
  }
  throw new Error(`${label} 不是 JSON value`);
};

const canonicalIso = (value: Date, label: string): string => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label} 必須是有效日期`);
  }
  return value.toISOString();
};

const assertCanonicalIsoString = (value: unknown, label: string): void => {
  if (typeof value !== "string") throw new Error(`${label} 必須是 ISO 日期字串`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} 必須是 canonical ISO 日期字串`);
  }
};

const assertNonBlankString = (value: unknown, label: string): void => {
  if (typeof value !== "string" || value.trim() === "" || value.length > 256) {
    throw new Error(`${label} 必須是 1 到 256 字元的非空字串`);
  }
};

const requireExactRecord = (
  value: unknown,
  expectedKeys: readonly string[],
  label: string
): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} 必須是 object`);
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpected.length
    || !actualKeys.every((key, index) => key === sortedExpected[index])
  ) {
    throw new Error(`${label} 欄位無效`);
  }
  return record;
};
