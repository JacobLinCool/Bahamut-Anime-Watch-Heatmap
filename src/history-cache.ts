import type { HistoryCoverage } from "./analytics";
import {
  historyWindowStart,
  watchEntriesFromHistory,
  type HistoryRow,
  type HistoryWatch,
  type WatchTimePrecision
} from "./history";
import type { DayBoundaryMode, WatchEntry } from "./model";

/** Outside the metadata prefix, so clearing the metadata cache keeps it. */
export const HISTORY_CACHE_STORAGE_KEY = "ani-gamer-heatmap:history:v1";
export const HISTORY_CACHE_RETENTION_DAYS = 400;
/** A cache whose last authoritative load is older than this is reloaded in full. */
export const HISTORY_FULL_SYNC_INTERVAL_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
/**
 * The page keeps about a year of rows and users cannot delete them, so a saved
 * watch younger than this cannot have left the page yet.
 */
export const HISTORY_PAGE_RETENTION_FLOOR_DAYS = 330;

const HISTORY_CACHE_SCHEMA_VERSION = 1;
const ACCOUNT_HASH_PREFIX = "ani-gamer-heatmap:history-account:v1:";
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const MAX_HISTORY_CACHE_ENTRIES = 20_000;
const MAX_TEXT_LENGTH = 2_048;
const DAY_BOUNDARY_MODES: readonly DayBoundaryMode[] = ["calendar", "thirty-hour"];

const WATCH_TIME_TOLERANCE_MILLISECONDS: Readonly<Record<WatchTimePrecision, number>> = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000
};

export type HistoryCacheRecord = {
  readonly accountHash: string;
  /** When the page was read; cached coverage never extends past it. */
  readonly collectedAt: Date;
  /** Last load that reached the end of the page's history or of the window. */
  readonly lastFullSyncAt: Date;
  readonly complete: boolean;
  readonly entries: readonly HistoryWatch[];
};

export type StoredHistoryCacheEntry = {
  readonly videoSn: number;
  readonly watchedAt: string;
  readonly title: string;
  readonly episode: string;
  readonly precision: WatchTimePrecision;
};

export type StoredHistoryCacheRecord = {
  readonly schemaVersion: 1;
  readonly accountHash: string;
  readonly collectedAt: string;
  readonly lastFullSyncAt: string;
  readonly complete: boolean;
  readonly entries: readonly StoredHistoryCacheEntry[];
};

export type IncrementalStopRejection =
  | "empty-page"
  | "row-after-cache"
  | "row-not-cached"
  | "row-time-mismatch"
  | "ordering-violation"
  | "hour-row-not-reloaded";

export type IncrementalStopDecision =
  | { readonly stop: true }
  | { readonly stop: false; readonly reason: IncrementalStopRejection };

export type HistoryPageOutcome =
  | { readonly kind: "incremental-stop" }
  | { readonly kind: "window-stop" }
  | { readonly kind: "continue"; readonly incrementalRejection: IncrementalStopRejection | null };

export type HistoryLoadEnd = "incremental-stop" | "window-stop" | "end-of-history";

export type HistoryLoadResult = {
  readonly source: "incremental" | "full";
  readonly watches: readonly HistoryWatch[];
  readonly complete: boolean;
  readonly lastFullSyncAt: Date;
  /** Saved watches kept because the page's history ended before reaching them. */
  readonly retainedCachedEntryCount: number;
};

export type HistoryCacheStatus =
  | "no-account"
  | "absent"
  | "invalid"
  | "account-mismatch"
  | "read-failed"
  | "loaded";

/** Debug-export view of one history collection; never includes account data. */
export type HistoryLoadDiagnostics = {
  readonly source: "cache-only" | "incremental" | "full" | null;
  readonly cacheStatus: HistoryCacheStatus | null;
  readonly cachedEntryCount: number | null;
  readonly fullLoadReason: "no-cache" | "full-sync-due" | null;
  readonly end: HistoryLoadEnd | null;
  readonly clickCount: number;
  readonly rowsPerPage: readonly number[];
  readonly durationMilliseconds: number | null;
  readonly incrementalStopFired: boolean;
  /** Why the incremental stop rule last declined to stop. */
  readonly incrementalStopRejection: IncrementalStopRejection | null;
  /** Saved watches kept because a full load ended before reaching them. */
  readonly retainedCachedEntryCount: number;
  /** Why the page was not read: its rows may belong to another account, or another tab saved a newer read. */
  readonly refreshSkipped: "account-changed" | "newer-cache" | null;
  readonly cacheWrite:
    | "written"
    | "skipped-no-account"
    | "skipped-account-changed"
    | "skipped-newer-cache"
    | "failed"
    | null;
  readonly refreshError: string | null;
};

export const emptyHistoryLoadDiagnostics = (): HistoryLoadDiagnostics => ({
  source: null,
  cacheStatus: null,
  cachedEntryCount: null,
  fullLoadReason: null,
  end: null,
  clickCount: 0,
  rowsPerPage: [],
  durationMilliseconds: null,
  incrementalStopFired: false,
  incrementalStopRejection: null,
  retainedCachedEntryCount: 0,
  refreshSkipped: null,
  cacheWrite: null,
  refreshError: null
});

/**
 * Mirrors Bahamut's user_login.js getUserid(): the trimmed BAHAID cookie must
 * look like an account id, and "guest" means logged out.
 */
export const readBahamutUserId = (cookieHeader: string): string | null => {
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== "BAHAID") continue;
    let value = part.slice(separator + 1);
    if (value.startsWith("\"")) value = value.slice(1, -1);
    try {
      value = value.replace(/(%[0-9A-Z]{2})+/g, decodeURIComponent);
    } catch {
      continue;
    }
    const userId = value.trim();
    return /^[a-z][a-z0-9]{1,11}$/i.test(userId) && userId !== "guest" ? userId : null;
  }
  return null;
};

/** One-way account scope for the history cache; the id itself is never stored. */
export const historyAccountHash = async (
  userId: string,
  subtle: SubtleCrypto = crypto.subtle
): Promise<string> => {
  if (!/^[a-z][a-z0-9]{1,11}$/i.test(userId)) {
    throw new Error("Bahamut 帳號 ID 格式無效");
  }
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ACCOUNT_HASH_PREFIX}${userId.toLowerCase()}`)
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const parseStoredHistoryCache = (value: unknown): HistoryCacheRecord => {
  const stored = requireExactRecord(value, [
    "accountHash",
    "collectedAt",
    "complete",
    "entries",
    "lastFullSyncAt",
    "schemaVersion"
  ], "history cache");
  if (stored.schemaVersion !== HISTORY_CACHE_SCHEMA_VERSION) {
    throw new Error("history cache schema version 無效");
  }
  if (typeof stored.accountHash !== "string" || !/^[0-9a-f]{64}$/.test(stored.accountHash)) {
    throw new Error("history cache accountHash 必須是 64 位小寫十六進位");
  }
  if (typeof stored.complete !== "boolean") {
    throw new Error("history cache complete 必須是 boolean");
  }
  const collectedAt = parseCanonicalIsoDate(stored.collectedAt, "history cache collectedAt");
  const lastFullSyncAt = parseCanonicalIsoDate(stored.lastFullSyncAt, "history cache lastFullSyncAt");
  if (lastFullSyncAt.getTime() > collectedAt.getTime()) {
    throw new Error("history cache lastFullSyncAt 不可晚於 collectedAt");
  }
  if (!Array.isArray(stored.entries) || stored.entries.length > MAX_HISTORY_CACHE_ENTRIES) {
    throw new Error(`history cache entries 必須是最多 ${MAX_HISTORY_CACHE_ENTRIES} 筆的 array`);
  }

  const retainedFrom = retentionStart(collectedAt);
  const seen = new Set<number>();
  const entries = stored.entries.map((raw, index): HistoryWatch => {
    const label = `history cache entries[${index}]`;
    const entry = requireExactRecord(raw, ["episode", "precision", "title", "videoSn", "watchedAt"], label);
    const videoSn = entry.videoSn;
    if (typeof videoSn !== "number" || !Number.isSafeInteger(videoSn) || videoSn <= 0) {
      throw new Error(`${label}.videoSn 必須是正安全整數`);
    }
    if (seen.has(videoSn)) {
      throw new Error(`history cache entries 有重複 videoSn：${videoSn}`);
    }
    seen.add(videoSn);
    const watchedAt = parseCanonicalIsoDate(entry.watchedAt, `${label}.watchedAt`);
    if (watchedAt.getTime() < retainedFrom.getTime()) {
      throw new Error(`${label}.watchedAt 超出保存期間`);
    }
    if (entry.precision !== "minute" && entry.precision !== "hour") {
      throw new Error(`${label}.precision 必須是 minute 或 hour`);
    }
    return {
      videoSn,
      watchedAt,
      precision: entry.precision,
      title: requireNonBlankString(entry.title, `${label}.title`),
      episode: requireNonBlankString(entry.episode, `${label}.episode`)
    };
  });

  return {
    accountHash: stored.accountHash,
    collectedAt,
    lastFullSyncAt,
    complete: stored.complete,
    entries
  };
};

/** Drops entries older than the retention period and validates the result. */
export const serializeHistoryCache = (record: HistoryCacheRecord): StoredHistoryCacheRecord => {
  const retainedFrom = retentionStart(record.collectedAt);
  const stored: StoredHistoryCacheRecord = {
    schemaVersion: HISTORY_CACHE_SCHEMA_VERSION,
    accountHash: record.accountHash,
    collectedAt: record.collectedAt.toISOString(),
    lastFullSyncAt: record.lastFullSyncAt.toISOString(),
    complete: record.complete,
    entries: record.entries
      .filter((entry) => entry.watchedAt.getTime() >= retainedFrom.getTime())
      .slice()
      .sort(compareWatches)
      .map((entry): StoredHistoryCacheEntry => ({
        videoSn: entry.videoSn,
        watchedAt: entry.watchedAt.toISOString(),
        title: entry.title,
        episode: entry.episode,
        precision: entry.precision
      }))
  };
  // The same strict parser guards cache writes and reads.
  parseStoredHistoryCache(stored);
  return stored;
};

/** Picks the stored record for this account; anything unusable reads as no cache. */
export const selectHistoryCache = (
  value: unknown,
  accountHash: string,
  now: Date
): {
  readonly cache: HistoryCacheRecord | null;
  readonly status: Extract<HistoryCacheStatus, "absent" | "invalid" | "account-mismatch" | "loaded">;
} => {
  if (value === undefined) return { cache: null, status: "absent" };
  let cache: HistoryCacheRecord;
  try {
    cache = parseStoredHistoryCache(value);
  } catch {
    return { cache: null, status: "invalid" };
  }
  if (cache.accountHash !== accountHash) return { cache: null, status: "account-mismatch" };
  // A snapshot from the future would claim coverage that was never read.
  if (cache.collectedAt.getTime() > now.getTime()) return { cache: null, status: "invalid" };
  return { cache, status: "loaded" };
};

/**
 * Coverage of watches read at `collectedAt` (a saved cache's own snapshot time,
 * never now). The analysis measures its periods up to coveredThrough, so the
 * window starts from the same instant.
 */
export const historyCoverageFor = ({
  collectedAt,
  complete,
  mode
}: {
  readonly collectedAt: Date;
  readonly complete: boolean;
  readonly mode: DayBoundaryMode;
}): HistoryCoverage => ({
  coveredFrom: historyWindowStart(collectedAt, mode),
  coveredThrough: new Date(collectedAt.getTime()),
  complete
});

/**
 * The entries and coverage shown for watches read at `collectedAt`. The
 * 365-day window ends at the snapshot rather than now, so the entries, the
 * coverage and the analysis' as-of time all describe the same instant; the
 * heatmap grid still ends today and simply has no data past the snapshot.
 */
export const historySnapshotView = ({
  watches,
  collectedAt,
  complete,
  mode
}: {
  readonly watches: readonly HistoryWatch[];
  readonly collectedAt: Date;
  readonly complete: boolean;
  readonly mode: DayBoundaryMode;
}): { readonly entries: WatchEntry[]; readonly coverage: HistoryCoverage } => ({
  entries: watchEntriesFromHistory(watches, mode, collectedAt),
  coverage: historyCoverageFor({ collectedAt, complete, mode })
});

export const shouldForceFullHistoryLoad = (
  cache: HistoryCacheRecord | null,
  now: Date
): "no-cache" | "full-sync-due" | null => {
  if (cache === null) return "no-cache";
  const age = now.getTime() - cache.lastFullSyncAt.getTime();
  return age < 0 || age >= HISTORY_FULL_SYNC_INTERVAL_MILLISECONDS ? "full-sync-due" : null;
};

export const watchTimeTolerance = (precision: WatchTimePrecision): number =>
  WATCH_TIME_TOLERANCE_MILLISECONDS[precision];

/**
 * Decides whether the rows below `page` can be taken from the cache. With S =
 * cache.collectedAt, every row of the latest page must predate S beyond its
 * precision and match its cached time, and every cached entry provably newer
 * than the page must already be loaded. That check validates the assumed
 * newest-activity-first card order at runtime. Finally, a cached time known
 * only to the hour must have been read again, so an approximation is never
 * kept as a fact; such rows are less than a day old and near the top.
 */
export const evaluateIncrementalStop = ({
  cache,
  page,
  loaded
}: {
  readonly cache: Pick<HistoryCacheRecord, "collectedAt" | "entries">;
  readonly page: readonly HistoryWatch[];
  readonly loaded: readonly HistoryWatch[];
}): IncrementalStopDecision => {
  if (page.length === 0) return { stop: false, reason: "empty-page" };
  const snapshotAt = cache.collectedAt.getTime();
  if (page.some((row) => upperBound(row) >= snapshotAt)) {
    return { stop: false, reason: "row-after-cache" };
  }

  const cachedByVideoSn = new Map(cache.entries.map((entry) => [entry.videoSn, entry] as const));
  for (const row of page) {
    const cached = cachedByVideoSn.get(row.videoSn);
    if (!cached) return { stop: false, reason: "row-not-cached" };
    if (!sameWatchTime(cached, row)) return { stop: false, reason: "row-time-mismatch" };
  }

  const pageUpperBound = Math.max(...page.map(upperBound));
  const loadedVideoSns = new Set(loaded.map((row) => row.videoSn));
  if (cache.entries.some((entry) => lowerBound(entry) > pageUpperBound && !loadedVideoSns.has(entry.videoSn))) {
    return { stop: false, reason: "ordering-violation" };
  }
  if (cache.entries.some((entry) => entry.precision === "hour" && !loadedVideoSns.has(entry.videoSn))) {
    return { stop: false, reason: "hour-row-not-reloaded" };
  }
  return { stop: true };
};

/**
 * Evaluates the latest page. Both early stops assume newest-activity-first
 * pages, so a page whose newest row is provably newer than the previous page's
 * newest row disables them for the rest of the load.
 */
export const evaluateHistoryPage = ({
  cache,
  incremental,
  pages,
  collectedAt
}: {
  readonly cache: HistoryCacheRecord | null;
  readonly incremental: boolean;
  readonly pages: readonly (readonly HistoryWatch[])[];
  /** Snapshot time of the page; the shown window ends there. */
  readonly collectedAt: Date;
}): HistoryPageOutcome => {
  const page = pages.at(-1) ?? [];
  if (!pagesAreNewestFirst(pages)) {
    return { kind: "continue", incrementalRejection: incremental && cache ? "ordering-violation" : null };
  }

  let incrementalRejection: IncrementalStopRejection | null = null;
  if (incremental && cache) {
    const decision = evaluateIncrementalStop({ cache, page, loaded: pages.flat() });
    if (decision.stop) return { kind: "incremental-stop" };
    incrementalRejection = decision.reason;
  }

  // Rows before the window are discarded anyway. The earlier window start of
  // the two day-boundary modes keeps a later mode switch exact.
  const windowStart = Math.min(...DAY_BOUNDARY_MODES.map((mode) => historyWindowStart(collectedAt, mode).getTime()));
  if (page.length > 0 && page.every((row) => upperBound(row) < windowStart)) {
    return { kind: "window-stop" };
  }
  return { kind: "continue", incrementalRejection };
};

/**
 * Builds the watches shown after a load. An incremental stop keeps cached
 * entries below the verified page; any other end makes the loaded rows
 * authoritative. Either way a relative label that merely re-describes a cached
 * watch keeps the cached time, so revisits do not churn the shown entries.
 *
 * Rows cannot be deleted and only expire after about a year, so a full load
 * that ends before saved watches younger than the retention floor (the "顯示
 * 更多" button vanished early, or every row failed to parse) proves the page
 * ended early. Those watches are kept, and the load is neither complete nor a
 * full sync, so the next due full load retries.
 */
export const finalizeHistoryLoad = ({
  end,
  rows,
  issueCount,
  cache,
  collectedAt
}: {
  readonly end: HistoryLoadEnd;
  readonly rows: readonly HistoryRow[];
  readonly issueCount: number;
  readonly cache: HistoryCacheRecord | null;
  /** Snapshot time of the page; never earlier than cache.collectedAt. */
  readonly collectedAt: Date;
}): HistoryLoadResult => {
  const loaded = stabilizeHistoryRows(rows, cache?.entries ?? []);
  if (end === "incremental-stop") {
    if (!cache) throw new Error("incremental history load 缺少 cache");
    return {
      source: "incremental",
      watches: mergeIncrementalHistory(loaded, cache.entries),
      complete: cache.complete && issueCount === 0,
      lastFullSyncAt: new Date(cache.lastFullSyncAt.getTime()),
      retainedCachedEntryCount: 0
    };
  }

  const unreached = cache ? savedWatchesBeyondLoad(loaded, cache.entries, collectedAt) : [];
  if (cache && unreached.length > 0) {
    return {
      source: "full",
      watches: mergeIncrementalHistory(loaded, unreached),
      complete: false,
      lastFullSyncAt: new Date(cache.lastFullSyncAt.getTime()),
      retainedCachedEntryCount: unreached.length
    };
  }
  return {
    source: "full",
    watches: mergeIncrementalHistory(loaded, []),
    complete: issueCount === 0,
    lastFullSyncAt: new Date(collectedAt.getTime()),
    retainedCachedEntryCount: 0
  };
};

/** Saved watches older than every loaded row that the page cannot have expired yet. */
const savedWatchesBeyondLoad = (
  loaded: readonly HistoryWatch[],
  cached: readonly HistoryWatch[],
  collectedAt: Date
): HistoryWatch[] => {
  const loadedVideoSns = new Set(loaded.map((row) => row.videoSn));
  const oldestLoaded = loaded.reduce((oldest, row) => Math.min(oldest, lowerBound(row)), Number.POSITIVE_INFINITY);
  const retentionFloor = collectedAt.getTime() - HISTORY_PAGE_RETENTION_FLOOR_DAYS * DAY_MILLISECONDS;
  return cached.filter((entry) => !loadedVideoSns.has(entry.videoSn)
    && upperBound(entry) < oldestLoaded
    && entry.watchedAt.getTime() >= retentionFloor);
};

/** Loaded rows win; one watch per videoSn, keeping the newest loaded time. */
export const mergeIncrementalHistory = (
  loaded: readonly HistoryWatch[],
  cached: readonly HistoryWatch[]
): HistoryWatch[] => {
  const merged = new Map<number, HistoryWatch>();
  for (const row of loaded) {
    const existing = merged.get(row.videoSn);
    if (!existing || row.watchedAt.getTime() > existing.watchedAt.getTime()) {
      merged.set(row.videoSn, toWatch(row));
    }
  }
  for (const entry of cached) {
    if (!merged.has(entry.videoSn)) merged.set(entry.videoSn, toWatch(entry));
  }
  return [...merged.values()].sort(compareWatches);
};

export const stabilizeHistoryRows = (
  rows: readonly HistoryRow[],
  cached: readonly HistoryWatch[]
): HistoryWatch[] => {
  const cachedByVideoSn = new Map(cached.map((entry) => [entry.videoSn, entry] as const));
  return rows.map((row): HistoryWatch => {
    const previous = cachedByVideoSn.get(row.videoSn);
    if (row.relativeToNow && previous && sameWatchTime(previous, row)) {
      return { ...toWatch(row), watchedAt: new Date(previous.watchedAt.getTime()), precision: previous.precision };
    }
    return toWatch(row);
  });
};

/** Compares the shown (videoSn, watchedAt) sets. */
export const watchEntriesDiffer = (
  left: readonly WatchEntry[],
  right: readonly WatchEntry[]
): boolean => {
  const keys = (entries: readonly WatchEntry[]): Set<string> =>
    new Set(entries.map((entry) => `${entry.videoSn}|${entry.watchedAt.getTime()}`));
  const leftKeys = keys(left);
  const rightKeys = keys(right);
  return leftKeys.size !== rightKeys.size || [...leftKeys].some((key) => !rightKeys.has(key));
};

const pagesAreNewestFirst = (pages: readonly (readonly HistoryWatch[])[]): boolean => {
  let previousNewest = Number.POSITIVE_INFINITY;
  for (const page of pages) {
    if (page.length === 0) continue;
    if (Math.max(...page.map(lowerBound)) > previousNewest) return false;
    previousNewest = Math.max(...page.map(upperBound));
  }
  return true;
};

const sameWatchTime = (left: HistoryWatch, right: HistoryWatch): boolean =>
  Math.abs(left.watchedAt.getTime() - right.watchedAt.getTime())
    <= watchTimeTolerance(left.precision) + watchTimeTolerance(right.precision);

const upperBound = (watch: HistoryWatch): number => watch.watchedAt.getTime() + watchTimeTolerance(watch.precision);
const lowerBound = (watch: HistoryWatch): number => watch.watchedAt.getTime() - watchTimeTolerance(watch.precision);

const toWatch = (watch: HistoryWatch): HistoryWatch => ({
  videoSn: watch.videoSn,
  watchedAt: new Date(watch.watchedAt.getTime()),
  precision: watch.precision,
  title: watch.title,
  episode: watch.episode
});

const compareWatches = (left: HistoryWatch, right: HistoryWatch): number =>
  left.watchedAt.getTime() - right.watchedAt.getTime() || left.videoSn - right.videoSn;

const retentionStart = (collectedAt: Date): Date =>
  new Date(collectedAt.getTime() - HISTORY_CACHE_RETENTION_DAYS * DAY_MILLISECONDS);

const parseCanonicalIsoDate = (value: unknown, label: string): Date => {
  if (typeof value !== "string") {
    throw new Error(`${label} 必須是 ISO 字串`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${label} 必須是 canonical ISO instant`);
  }
  return date;
};

const requireNonBlankString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH || value.trim().length === 0) {
    throw new Error(`${label} 必須是非空且長度不超過 ${MAX_TEXT_LENGTH} 的字串`);
  }
  return value;
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
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} 欄位不符合 schema v1`);
  }
  return record;
};
