import type {
  AnimeMetadata,
  AnimePlatformSnapshot,
  EpisodeMetadata,
  EpisodeRef,
  MetadataBundle
} from "./model";
import { cloneMetadataBundle, METADATA_PARSER_VERSION } from "./metadata-schema";

const CACHE_SCHEMA_VERSION = 1;
const ANIME_CACHE_SCHEMA_VERSION = 2;
const CACHE_ROOT_PREFIX = "ani-gamer-heatmap:metadata:v1:";
const EPISODE_CACHE_PREFIX = `${CACHE_ROOT_PREFIX}episode:`;
const ANIME_CACHE_PREFIX = `${CACHE_ROOT_PREFIX}anime:`;
const UNAVAILABLE_CACHE_PREFIX = `${CACHE_ROOT_PREFIX}unavailable:`;
const INVALID_CACHE_PREFIX = `${CACHE_ROOT_PREFIX}invalid:`;
const MAX_STRING_LENGTH = 4_096;
const MAX_TAG_COUNT = 100;
const MAX_EPISODE_REF_COUNT = 10_000;

/**
 * An unavailable answer is reused for BASE × FACTOR^confirmations, capped at
 * MAX, then spread by a deterministic per-videoSn jitter of ±JITTER_RATIO so
 * records observed together do not all expire on the same visit. The answer
 * means the license ended, which rarely reverses within a day, so BASE is one
 * day: a daily revisit does not re-confirm every delisted episode in the
 * foreground while the analysis waits.
 */
export const UNAVAILABLE_CACHE_BASE_TTL_MILLISECONDS = 24 * 60 * 60 * 1_000;
export const UNAVAILABLE_CACHE_BACKOFF_FACTOR = 4;
export const UNAVAILABLE_CACHE_MAX_TTL_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;
export const UNAVAILABLE_CACHE_JITTER_RATIO = 0.2;
/** A schema-rejected payload is reused only while the parser version is unchanged. */
export const INVALID_RESPONSE_CACHE_TTL_MILLISECONDS = 24 * 60 * 60 * 1_000;
/** The mutable catalog (including current episode count and airing status) is rechecked daily. */
export const ANIME_METADATA_CACHE_TTL_MILLISECONDS = 24 * 60 * 60 * 1_000;

export type MetadataCacheStorage = {
  readonly get: (keys: string[]) => Promise<Record<string, unknown>>;
  readonly getAll: () => Promise<Record<string, unknown>>;
  readonly set: (items: Record<string, unknown>) => Promise<void>;
  readonly remove: (keys: string[]) => Promise<void>;
};

export type StoredEpisodeMetadata = {
  readonly schemaVersion: 1;
  readonly kind: "episode";
  readonly videoSn: number;
  readonly animeSn: number;
  readonly groupKey: string;
  readonly episodeIndex: number;
  readonly episodeNumber: number;
  readonly availableFrom: string;
  readonly availableUntil: string | null;
  readonly durationMinutes: number;
  readonly coverUrl: string | null;
  readonly videoType: number;
  readonly fetchedAt: string;
};

export type StoredEpisodeRef = {
  readonly videoSn: number;
  readonly episodeNumber: number;
  readonly groupKey: string;
  readonly coverUrl: string | null;
};

export type StoredAnimePlatformSnapshot = {
  readonly score: number;
  readonly reviewCount: number;
  readonly popular: number;
  readonly observedAt: string;
};

export type StoredAnimeMetadata = {
  readonly schemaVersion: 2;
  readonly kind: "anime";
  readonly animeSn: number;
  readonly apiTitle: string;
  readonly totalEpisode: number;
  readonly seasonStartDateKey: string | null;
  readonly seasonEndDateKey: string | null;
  readonly isOngoing: boolean;
  readonly coverUrl: string | null;
  readonly tags: readonly string[];
  readonly maker: string | null;
  readonly director: string | null;
  readonly publisher: string | null;
  readonly episodeRefs: readonly StoredEpisodeRef[];
  readonly platformSnapshot: StoredAnimePlatformSnapshot;
  readonly fetchedAt: string;
};

export type MetadataBundleWire = {
  readonly episode: StoredEpisodeMetadata;
  readonly anime: StoredAnimeMetadata;
};

export type StoredUnavailableMetadata = {
  readonly schemaVersion: 1;
  readonly kind: "unavailable";
  readonly videoSn: number;
  readonly observedAt: string;
  readonly firstObservedAt: string;
  readonly confirmations: number;
};

export type UnavailableMetadata = {
  readonly videoSn: number;
  /** Latest unavailable response. */
  readonly observedAt: Date;
  /** First unavailable response of the current uninterrupted run. */
  readonly firstObservedAt: Date;
  /** Refetches that confirmed the run again; 0 for the first observation. */
  readonly confirmations: number;
};

export type StoredInvalidMetadata = {
  readonly schemaVersion: 1;
  readonly kind: "invalid";
  readonly videoSn: number;
  readonly observedAt: string;
  readonly parserVersion: number;
  readonly message: string;
};

export type InvalidMetadata = {
  readonly videoSn: number;
  readonly observedAt: Date;
  readonly parserVersion: number;
  readonly message: string;
};

/**
 * Lookup order: a usable episode plus anime record is a hit; otherwise a fresh
 * unavailable record, then a fresh invalid-response record of the current
 * parser version. Anything else must be fetched: `invalid` reports a corrupt
 * record, and both fetch outcomes carry the last unavailable record (even an
 * expired one) so a renewed unavailable answer extends its backoff.
 */
export type MetadataCacheLookup =
  | { readonly kind: "hit"; readonly bundle: MetadataBundle }
  | { readonly kind: "unavailable"; readonly record: UnavailableMetadata }
  | { readonly kind: "invalid-response"; readonly record: InvalidMetadata }
  | { readonly kind: "miss"; readonly previousUnavailable: UnavailableMetadata | null }
  | {
      readonly kind: "invalid";
      readonly message: string;
      readonly previousUnavailable: UnavailableMetadata | null;
    };

type JsonRecord = Record<string, unknown>;

export const episodeMetadataCacheKey = (videoSn: number): string => {
  assertPositiveSafeInteger(videoSn, "videoSn");
  return `${EPISODE_CACHE_PREFIX}${videoSn}`;
};

export const animeMetadataCacheKey = (animeSn: number): string => {
  assertPositiveSafeInteger(animeSn, "animeSn");
  return `${ANIME_CACHE_PREFIX}${animeSn}`;
};

export const unavailableMetadataCacheKey = (videoSn: number): string => {
  assertPositiveSafeInteger(videoSn, "videoSn");
  return `${UNAVAILABLE_CACHE_PREFIX}${videoSn}`;
};

export const invalidMetadataCacheKey = (videoSn: number): string => {
  assertPositiveSafeInteger(videoSn, "videoSn");
  return `${INVALID_CACHE_PREFIX}${videoSn}`;
};

export const isMetadataV1CacheKey = (key: string): boolean => {
  return parsePositiveIntegerSuffix(key, EPISODE_CACHE_PREFIX) !== null
    || parsePositiveIntegerSuffix(key, ANIME_CACHE_PREFIX) !== null
    || parsePositiveIntegerSuffix(key, UNAVAILABLE_CACHE_PREFIX) !== null
    || parsePositiveIntegerSuffix(key, INVALID_CACHE_PREFIX) !== null;
};

export const metadataBundleToWire = (bundle: MetadataBundle): MetadataBundleWire => {
  const wire: MetadataBundleWire = {
    episode: serializeEpisodeMetadata(bundle.episode),
    anime: serializeAnimeMetadata(bundle.anime)
  };
  // The same strict parser guards cache writes and runtime responses.
  parseMetadataBundleWire(wire);
  return wire;
};

export const metadataBundleCacheItems = (bundle: MetadataBundle): Record<string, unknown> => {
  const wire = metadataBundleToWire(bundle);
  return {
    [episodeMetadataCacheKey(bundle.episode.videoSn)]: wire.episode,
    [animeMetadataCacheKey(bundle.anime.animeSn)]: wire.anime
  };
};

export const parseMetadataBundleWire = (value: unknown): MetadataBundle => {
  const wire = requireExactRecord(value, ["anime", "episode"], "metadata bundle wire");
  const episodeRecord = requireRecord(wire.episode, "metadata bundle wire.episode");
  const animeRecord = requireRecord(wire.anime, "metadata bundle wire.anime");
  const episode = parseStoredEpisodeMetadata(episodeRecord, episodeRecord.videoSn);
  const anime = parseStoredAnimeMetadata(animeRecord, animeRecord.animeSn);
  if (episode.animeSn !== anime.animeSn) {
    throw new Error("metadata bundle 的 episode/anime identity 不一致");
  }
  if (!anime.episodeRefs.some((reference) =>
    reference.videoSn === episode.videoSn
    && reference.groupKey === episode.groupKey
    && reference.episodeNumber === episode.episodeNumber
  )) {
    throw new Error("metadata bundle anime 缺少 episode 對應 reference");
  }
  return { episode, anime };
};

export const parseStoredEpisodeMetadata = (
  value: unknown,
  expectedVideoSn: unknown
): EpisodeMetadata => {
  const stored = requireExactRecord(value, [
    "animeSn",
    "availableFrom",
    "availableUntil",
    "coverUrl",
    "durationMinutes",
    "episodeIndex",
    "episodeNumber",
    "fetchedAt",
    "groupKey",
    "kind",
    "schemaVersion",
    "videoSn",
    "videoType"
  ], "cached episode metadata");
  requireCacheHeader(stored, "episode");
  const videoSn = requirePositiveSafeInteger(stored.videoSn, "cache.episode.videoSn");
  const expected = requirePositiveSafeInteger(expectedVideoSn, "expectedVideoSn");
  if (videoSn !== expected) {
    throw new Error("cache episode videoSn 與 key 不一致");
  }
  const metadata: EpisodeMetadata = {
    videoSn,
    animeSn: requirePositiveSafeInteger(stored.animeSn, "cache.episode.animeSn"),
    groupKey: requireGroupKey(stored.groupKey, "cache.episode.groupKey"),
    episodeIndex: requireNonNegativeSafeInteger(stored.episodeIndex, "cache.episode.episodeIndex"),
    episodeNumber: requireNonNegativeFiniteNumber(stored.episodeNumber, "cache.episode.episodeNumber"),
    availableFrom: parseCanonicalIsoDate(stored.availableFrom, "cache.episode.availableFrom"),
    availableUntil: parseNullableCanonicalIsoDate(stored.availableUntil, "cache.episode.availableUntil"),
    durationMinutes: requireNonNegativeSafeInteger(stored.durationMinutes, "cache.episode.durationMinutes"),
    coverUrl: parseNullableHttpsUrl(stored.coverUrl, "cache.episode.coverUrl"),
    videoType: requireNonNegativeSafeInteger(stored.videoType, "cache.episode.videoType"),
    fetchedAt: parseCanonicalIsoDate(stored.fetchedAt, "cache.episode.fetchedAt")
  };
  if (
    metadata.availableUntil !== null
    && metadata.availableUntil.getTime() < metadata.availableFrom.getTime()
  ) {
    throw new Error("cache.episode.availableUntil 不可早於 availableFrom");
  }
  return metadata;
};

export const parseStoredAnimeMetadata = (
  value: unknown,
  expectedAnimeSn: unknown
): AnimeMetadata => {
  const stored = requireExactRecord(value, [
    "animeSn",
    "apiTitle",
    "coverUrl",
    "director",
    "episodeRefs",
    "fetchedAt",
    "isOngoing",
    "kind",
    "maker",
    "platformSnapshot",
    "publisher",
    "schemaVersion",
    "seasonEndDateKey",
    "seasonStartDateKey",
    "tags",
    "totalEpisode"
  ], "cached anime metadata");
  requireCacheHeader(stored, "anime", ANIME_CACHE_SCHEMA_VERSION);
  const animeSn = requirePositiveSafeInteger(stored.animeSn, "cache.anime.animeSn");
  const expected = requirePositiveSafeInteger(expectedAnimeSn, "expectedAnimeSn");
  if (animeSn !== expected) {
    throw new Error("cache anime animeSn 與 key 不一致");
  }
  const tags = parseStoredStringArray(stored.tags, "cache.anime.tags", MAX_TAG_COUNT);
  const episodeRefs = parseStoredEpisodeRefs(stored.episodeRefs);
  const platformSnapshot = parseStoredPlatformSnapshot(stored.platformSnapshot);
  const metadata: AnimeMetadata = {
    animeSn,
    apiTitle: requireNonBlankString(stored.apiTitle, "cache.anime.apiTitle"),
    totalEpisode: requireNonNegativeSafeInteger(stored.totalEpisode, "cache.anime.totalEpisode"),
    seasonStartDateKey: parseNullableDateKey(stored.seasonStartDateKey, "cache.anime.seasonStartDateKey"),
    seasonEndDateKey: parseNullableDateKey(stored.seasonEndDateKey, "cache.anime.seasonEndDateKey"),
    isOngoing: requireBoolean(stored.isOngoing, "cache.anime.isOngoing"),
    coverUrl: parseNullableHttpsUrl(stored.coverUrl, "cache.anime.coverUrl"),
    tags,
    maker: parseNullableNonBlankString(stored.maker, "cache.anime.maker"),
    director: parseNullableNonBlankString(stored.director, "cache.anime.director"),
    publisher: parseNullableNonBlankString(stored.publisher, "cache.anime.publisher"),
    episodeRefs,
    platformSnapshot,
    fetchedAt: parseCanonicalIsoDate(stored.fetchedAt, "cache.anime.fetchedAt")
  };
  if (
    metadata.seasonStartDateKey !== null
    && metadata.seasonEndDateKey !== null
    && metadata.seasonEndDateKey < metadata.seasonStartDateKey
  ) {
    throw new Error("cache.anime.seasonEndDateKey 不可早於 seasonStartDateKey");
  }
  return metadata;
};

export const createUnavailableMetadata = (
  videoSn: number,
  observedAt = new Date(),
  previous: UnavailableMetadata | null = null
): StoredUnavailableMetadata => {
  assertPositiveSafeInteger(videoSn, "videoSn");
  assertValidDate(observedAt, "observedAt");
  if (previous !== null && previous.videoSn !== videoSn) {
    throw new Error("previous unavailable record 的 videoSn 不一致");
  }
  const firstObservedAt = previous === null
    ? observedAt
    : new Date(Math.min(previous.firstObservedAt.getTime(), observedAt.getTime()));
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    kind: "unavailable",
    videoSn,
    observedAt: observedAt.toISOString(),
    firstObservedAt: firstObservedAt.toISOString(),
    confirmations: previous === null ? 0 : previous.confirmations + 1
  };
};

export const parseStoredUnavailableMetadata = (
  value: unknown,
  expectedVideoSn: number
): UnavailableMetadata => {
  const record = requireRecord(value, "cached unavailable metadata");
  // Records written before the backoff have neither field; they are the first
  // observation of their run.
  const legacy = !Object.hasOwn(record, "confirmations") && !Object.hasOwn(record, "firstObservedAt");
  const stored = requireExactRecord(record, legacy
    ? ["kind", "observedAt", "schemaVersion", "videoSn"]
    : ["confirmations", "firstObservedAt", "kind", "observedAt", "schemaVersion", "videoSn"],
  "cached unavailable metadata");
  requireCacheHeader(stored, "unavailable");
  const videoSn = requirePositiveSafeInteger(stored.videoSn, "cache.unavailable.videoSn");
  assertPositiveSafeInteger(expectedVideoSn, "expectedVideoSn");
  if (videoSn !== expectedVideoSn) {
    throw new Error("cache unavailable videoSn 與 key 不一致");
  }
  const observedAt = parseCanonicalIsoDate(stored.observedAt, "cache.unavailable.observedAt");
  if (legacy) {
    return { videoSn, observedAt, firstObservedAt: new Date(observedAt.getTime()), confirmations: 0 };
  }
  const firstObservedAt = parseCanonicalIsoDate(
    stored.firstObservedAt,
    "cache.unavailable.firstObservedAt"
  );
  if (firstObservedAt.getTime() > observedAt.getTime()) {
    throw new Error("cache.unavailable.firstObservedAt 不可晚於 observedAt");
  }
  return {
    videoSn,
    observedAt,
    firstObservedAt,
    confirmations: requireNonNegativeSafeInteger(stored.confirmations, "cache.unavailable.confirmations")
  };
};

/** Deterministic jitter in [-JITTER_RATIO, +JITTER_RATIO] from an FNV-1a hash of videoSn. */
export const unavailableCacheJitter = (videoSn: number): number => {
  assertPositiveSafeInteger(videoSn, "videoSn");
  let hash = 0x811c9dc5;
  for (const character of String(videoSn)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) / 0xffff_ffff * 2 - 1) * UNAVAILABLE_CACHE_JITTER_RATIO;
};

export const unavailableCacheTtlMilliseconds = (
  record: Pick<UnavailableMetadata, "videoSn" | "confirmations">
): number => {
  if (!Number.isSafeInteger(record.confirmations) || record.confirmations < 0) {
    throw new Error("record.confirmations 必須是非負安全整數");
  }
  const scheduled = Math.min(
    UNAVAILABLE_CACHE_BASE_TTL_MILLISECONDS * UNAVAILABLE_CACHE_BACKOFF_FACTOR ** record.confirmations,
    UNAVAILABLE_CACHE_MAX_TTL_MILLISECONDS
  );
  return Math.round(scheduled * (1 + unavailableCacheJitter(record.videoSn)));
};

export const isUnavailableMetadataFresh = (
  record: UnavailableMetadata,
  now = new Date()
): boolean => {
  assertValidDate(record.observedAt, "record.observedAt");
  assertValidDate(now, "now");
  const age = now.getTime() - record.observedAt.getTime();
  return age >= 0 && age < unavailableCacheTtlMilliseconds(record);
};

export const createInvalidMetadata = (
  videoSn: number,
  message: string,
  observedAt = new Date(),
  parserVersion = METADATA_PARSER_VERSION
): StoredInvalidMetadata => {
  assertPositiveSafeInteger(videoSn, "videoSn");
  assertValidDate(observedAt, "observedAt");
  assertPositiveSafeInteger(parserVersion, "parserVersion");
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    kind: "invalid",
    videoSn,
    observedAt: observedAt.toISOString(),
    parserVersion,
    message: requireNonBlankString(message.slice(0, MAX_STRING_LENGTH), "invalid metadata message")
  };
};

export const parseStoredInvalidMetadata = (
  value: unknown,
  expectedVideoSn: number
): InvalidMetadata => {
  const stored = requireExactRecord(value, [
    "kind", "message", "observedAt", "parserVersion", "schemaVersion", "videoSn"
  ], "cached invalid metadata");
  requireCacheHeader(stored, "invalid");
  const videoSn = requirePositiveSafeInteger(stored.videoSn, "cache.invalid.videoSn");
  assertPositiveSafeInteger(expectedVideoSn, "expectedVideoSn");
  if (videoSn !== expectedVideoSn) {
    throw new Error("cache invalid videoSn 與 key 不一致");
  }
  return {
    videoSn,
    observedAt: parseCanonicalIsoDate(stored.observedAt, "cache.invalid.observedAt"),
    parserVersion: requirePositiveSafeInteger(stored.parserVersion, "cache.invalid.parserVersion"),
    message: requireNonBlankString(stored.message, "cache.invalid.message")
  };
};

export const isInvalidMetadataFresh = (
  record: InvalidMetadata,
  now = new Date(),
  parserVersion = METADATA_PARSER_VERSION
): boolean => {
  assertValidDate(record.observedAt, "record.observedAt");
  assertValidDate(now, "now");
  if (record.parserVersion !== parserVersion) return false;
  const age = now.getTime() - record.observedAt.getTime();
  return age >= 0 && age < INVALID_RESPONSE_CACHE_TTL_MILLISECONDS;
};

export const readMetadataCache = async (
  storage: Pick<MetadataCacheStorage, "get">,
  videoSn: number,
  now = new Date()
): Promise<MetadataCacheLookup> => {
  assertPositiveSafeInteger(videoSn, "videoSn");
  assertValidDate(now, "now");
  const episodeKey = episodeMetadataCacheKey(videoSn);
  const unavailableKey = unavailableMetadataCacheKey(videoSn);
  const invalidKey = invalidMetadataCacheKey(videoSn);
  const first = requireRecord(
    await storage.get([episodeKey, unavailableKey, invalidKey]),
    "chrome.storage.local.get episode result"
  );

  let corruption: string | undefined;
  if (Object.hasOwn(first, episodeKey)) {
    const positive = await readPositiveMetadata(storage, first[episodeKey], videoSn, now);
    if (positive.kind === "hit") return positive;
    if (positive.kind === "invalid") corruption = positive.message;
  }

  // An unusable episode record never hides a fresh negative answer; otherwise a
  // delisted episode whose anime index dropped it would refetch on every visit.
  let unavailable: UnavailableMetadata | null = null;
  if (Object.hasOwn(first, unavailableKey)) {
    try {
      unavailable = parseStoredUnavailableMetadata(first[unavailableKey], videoSn);
    } catch (error) {
      corruption ??= errorMessage(error);
    }
  }
  if (unavailable !== null && isUnavailableMetadataFresh(unavailable, now)) {
    return { kind: "unavailable", record: unavailable };
  }

  if (Object.hasOwn(first, invalidKey)) {
    try {
      const invalid = parseStoredInvalidMetadata(first[invalidKey], videoSn);
      if (isInvalidMetadataFresh(invalid, now)) {
        return { kind: "invalid-response", record: invalid };
      }
    } catch (error) {
      corruption ??= errorMessage(error);
    }
  }

  return corruption === undefined
    ? { kind: "miss", previousUnavailable: unavailable }
    : { kind: "invalid", message: corruption, previousUnavailable: unavailable };
};

const readPositiveMetadata = async (
  storage: Pick<MetadataCacheStorage, "get">,
  value: unknown,
  videoSn: number,
  now: Date
): Promise<
  | { readonly kind: "hit"; readonly bundle: MetadataBundle }
  | { readonly kind: "miss" }
  | { readonly kind: "invalid"; readonly message: string }
> => {
  let episode: EpisodeMetadata;
  try {
    episode = parseStoredEpisodeMetadata(value, videoSn);
  } catch (error) {
    return { kind: "invalid", message: errorMessage(error) };
  }
  const animeKey = animeMetadataCacheKey(episode.animeSn);
  const second = requireRecord(
    await storage.get([animeKey]),
    "chrome.storage.local.get anime result"
  );
  if (!Object.hasOwn(second, animeKey)) {
    return { kind: "miss" };
  }
  try {
    const anime = parseStoredAnimeMetadata(second[animeKey], episode.animeSn);
    const age = now.getTime() - anime.fetchedAt.getTime();
    if (age < 0 || age >= ANIME_METADATA_CACHE_TTL_MILLISECONDS) return { kind: "miss" };
    if (!anime.episodeRefs.some((reference) =>
      reference.videoSn === episode.videoSn
      && reference.groupKey === episode.groupKey
      && reference.episodeNumber === episode.episodeNumber
    )) {
      throw new Error("cache anime 缺少 episode 對應 reference");
    }
    return { kind: "hit", bundle: cloneMetadataBundle({ episode, anime }) };
  } catch (error) {
    return { kind: "invalid", message: errorMessage(error) };
  }
};

export const clearMetadataCache = async (
  storage: MetadataCacheStorage
): Promise<number> => {
  const values = requireRecord(await storage.getAll(), "chrome.storage.local.get(null) result");
  const keys = Object.keys(values).filter((key) => key.startsWith(CACHE_ROOT_PREFIX));
  if (keys.length === 0) return 0;
  await storage.remove(keys);
  return keys.length;
};

export const serializeEpisodeMetadata = (metadata: EpisodeMetadata): StoredEpisodeMetadata => ({
  schemaVersion: CACHE_SCHEMA_VERSION,
  kind: "episode",
  videoSn: metadata.videoSn,
  animeSn: metadata.animeSn,
  groupKey: metadata.groupKey,
  episodeIndex: metadata.episodeIndex,
  episodeNumber: metadata.episodeNumber,
  availableFrom: metadata.availableFrom.toISOString(),
  availableUntil: metadata.availableUntil?.toISOString() ?? null,
  durationMinutes: metadata.durationMinutes,
  coverUrl: metadata.coverUrl,
  videoType: metadata.videoType,
  fetchedAt: metadata.fetchedAt.toISOString()
});

export const serializeAnimeMetadata = (metadata: AnimeMetadata): StoredAnimeMetadata => ({
  schemaVersion: ANIME_CACHE_SCHEMA_VERSION,
  kind: "anime",
  animeSn: metadata.animeSn,
  apiTitle: metadata.apiTitle,
  totalEpisode: metadata.totalEpisode,
  seasonStartDateKey: metadata.seasonStartDateKey,
  seasonEndDateKey: metadata.seasonEndDateKey,
  isOngoing: metadata.isOngoing,
  coverUrl: metadata.coverUrl,
  tags: [...metadata.tags],
  maker: metadata.maker,
  director: metadata.director,
  publisher: metadata.publisher,
  episodeRefs: metadata.episodeRefs.map((reference): StoredEpisodeRef => ({ ...reference })),
  platformSnapshot: {
    score: metadata.platformSnapshot.score,
    reviewCount: metadata.platformSnapshot.reviewCount,
    popular: metadata.platformSnapshot.popular,
    observedAt: metadata.platformSnapshot.observedAt.toISOString()
  },
  fetchedAt: metadata.fetchedAt.toISOString()
});

const parseStoredEpisodeRefs = (value: unknown): readonly EpisodeRef[] => {
  if (!Array.isArray(value) || value.length > MAX_EPISODE_REF_COUNT) {
    throw new Error(`cache.anime.episodeRefs 必須是最多 ${MAX_EPISODE_REF_COUNT} 筆的 array`);
  }
  const seen = new Set<number>();
  return value.map((raw, index): EpisodeRef => {
    const reference = requireExactRecord(raw, [
      "coverUrl", "episodeNumber", "groupKey", "videoSn"
    ], `cache.anime.episodeRefs[${index}]`);
    const videoSn = requirePositiveSafeInteger(
      reference.videoSn,
      `cache.anime.episodeRefs[${index}].videoSn`
    );
    if (seen.has(videoSn)) {
      throw new Error(`cache.anime.episodeRefs 有重複 videoSn：${videoSn}`);
    }
    seen.add(videoSn);
    return {
      videoSn,
      episodeNumber: requireNonNegativeFiniteNumber(
        reference.episodeNumber,
        `cache.anime.episodeRefs[${index}].episodeNumber`
      ),
      groupKey: requireGroupKey(
        reference.groupKey,
        `cache.anime.episodeRefs[${index}].groupKey`
      ),
      coverUrl: parseNullableHttpsUrl(reference.coverUrl, `cache.anime.episodeRefs[${index}].coverUrl`)
    };
  });
};

const parseStoredPlatformSnapshot = (value: unknown): AnimePlatformSnapshot => {
  const snapshot = requireExactRecord(value, [
    "observedAt", "popular", "reviewCount", "score"
  ], "cache.anime.platformSnapshot");
  return {
    score: requireFiniteNumberInRange(snapshot.score, "cache.anime.platformSnapshot.score", 0, 5),
    reviewCount: requireNonNegativeSafeInteger(
      snapshot.reviewCount,
      "cache.anime.platformSnapshot.reviewCount"
    ),
    popular: requireNonNegativeSafeInteger(snapshot.popular, "cache.anime.platformSnapshot.popular"),
    observedAt: parseCanonicalIsoDate(snapshot.observedAt, "cache.anime.platformSnapshot.observedAt")
  };
};

const parseStoredStringArray = (value: unknown, label: string, maximum: number): readonly string[] => {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${label} 必須是最多 ${maximum} 筆的 array`);
  }
  return value.map((item, index) => requireNonBlankString(item, `${label}[${index}]`));
};

const requireCacheHeader = (stored: JsonRecord, kind: string, version = CACHE_SCHEMA_VERSION): void => {
  if (stored.schemaVersion !== version || stored.kind !== kind) {
    throw new Error(`cache ${kind} schema header 無效`);
  }
};

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

const parseNullableCanonicalIsoDate = (value: unknown, label: string): Date | null => {
  return value === null ? null : parseCanonicalIsoDate(value, label);
};

const parseNullableDateKey = (value: unknown, label: string): string | null => {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} 必須是 YYYY-MM-DD 或 null`);
  }
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error(`${label} 不是有效日期`);
  }
  return value;
};

const parseNullableHttpsUrl = (value: unknown, label: string): string | null => {
  if (value === null) return null;
  const raw = requireNonBlankString(value, label);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} 必須是有效 URL`);
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new Error(`${label} 必須是無帳密的 HTTPS URL`);
  }
  return raw;
};

const parseNullableNonBlankString = (value: unknown, label: string): string | null => {
  return value === null ? null : requireNonBlankString(value, label);
};

const requireBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean") throw new Error(`${label} 必須是 boolean`);
  return value;
};

const requireExactRecord = (value: unknown, expectedKeys: readonly string[], label: string): JsonRecord => {
  const record = requireRecord(value, label);
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} 欄位不符合 schema`);
  }
  return record;
};

const requireRecord = (value: unknown, label: string): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} 必須是 object`);
  }
  return value as JsonRecord;
};

const requireNonBlankString = (value: unknown, label: string): string => {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > MAX_STRING_LENGTH
    || value.trim().length === 0
  ) {
    throw new Error(`${label} 必須是非空且長度不超過 ${MAX_STRING_LENGTH} 的字串`);
  }
  return value;
};

const requireGroupKey = (value: unknown, label: string): string => {
  const groupKey = requireNonBlankString(value, label);
  if (groupKey.length > 128) {
    throw new Error(`${label} 長度不可超過 128`);
  }
  return groupKey;
};

const requirePositiveSafeInteger = (value: unknown, label: string): number => {
  if (typeof value !== "number") {
    throw new Error(`${label} 必須是 number`);
  }
  assertPositiveSafeInteger(value, label);
  return value;
};

const requireNonNegativeSafeInteger = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} 必須是非負安全整數`);
  }
  return value;
};

const requireNonNegativeFiniteNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} 必須是非負有限數字`);
  }
  return value;
};

const requireFiniteNumberInRange = (
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} 必須是 ${minimum} 到 ${maximum} 的有限數字`);
  }
  return value;
};

const parsePositiveIntegerSuffix = (key: string, prefix: string): number | null => {
  if (!key.startsWith(prefix)) return null;
  const suffix = key.slice(prefix.length);
  if (!/^[1-9]\d*$/.test(suffix)) return null;
  const value = Number(suffix);
  return Number.isSafeInteger(value) ? value : null;
};

const assertPositiveSafeInteger = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} 必須是正安全整數`);
  }
};

const assertValidDate = (value: Date, label: string): void => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} 必須是有效 Date`);
  }
};

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
