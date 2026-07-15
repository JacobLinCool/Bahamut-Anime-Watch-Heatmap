import type {
  AnimeMetadata,
  AnimePlatformSnapshot,
  EpisodeMetadata,
  EpisodeRef,
  MetadataBundle
} from "./model";
import { cloneMetadataBundle } from "./metadata-schema";

const CACHE_SCHEMA_VERSION = 1;
const CACHE_ROOT_PREFIX = "ani-gamer-heatmap:metadata:v1:";
const EPISODE_CACHE_PREFIX = `${CACHE_ROOT_PREFIX}episode:`;
const ANIME_CACHE_PREFIX = `${CACHE_ROOT_PREFIX}anime:`;
const UNAVAILABLE_CACHE_PREFIX = `${CACHE_ROOT_PREFIX}unavailable:`;
const MAX_STRING_LENGTH = 4_096;
const MAX_TAG_COUNT = 100;
const MAX_EPISODE_REF_COUNT = 10_000;

export const UNAVAILABLE_CACHE_TTL_MILLISECONDS = 60 * 60 * 1_000;

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
  readonly schemaVersion: 1;
  readonly kind: "anime";
  readonly animeSn: number;
  readonly apiTitle: string;
  readonly totalEpisode: number;
  readonly seasonStartDateKey: string | null;
  readonly seasonEndDateKey: string | null;
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
};

export type UnavailableMetadata = {
  readonly videoSn: number;
  readonly observedAt: Date;
};

export type MetadataCacheLookup =
  | { readonly kind: "hit"; readonly bundle: MetadataBundle }
  | { readonly kind: "unavailable"; readonly record: UnavailableMetadata }
  | { readonly kind: "miss" }
  | { readonly kind: "invalid"; readonly message: string };

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

export const isMetadataV1CacheKey = (key: string): boolean => {
  return parsePositiveIntegerSuffix(key, EPISODE_CACHE_PREFIX) !== null
    || parsePositiveIntegerSuffix(key, ANIME_CACHE_PREFIX) !== null
    || parsePositiveIntegerSuffix(key, UNAVAILABLE_CACHE_PREFIX) !== null;
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
    episodeNumber: requirePositiveSafeInteger(stored.episodeNumber, "cache.episode.episodeNumber"),
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
  requireCacheHeader(stored, "anime");
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
  observedAt = new Date()
): StoredUnavailableMetadata => {
  assertPositiveSafeInteger(videoSn, "videoSn");
  assertValidDate(observedAt, "observedAt");
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    kind: "unavailable",
    videoSn,
    observedAt: observedAt.toISOString()
  };
};

export const parseStoredUnavailableMetadata = (
  value: unknown,
  expectedVideoSn: number
): UnavailableMetadata => {
  const stored = requireExactRecord(value, [
    "kind", "observedAt", "schemaVersion", "videoSn"
  ], "cached unavailable metadata");
  requireCacheHeader(stored, "unavailable");
  const videoSn = requirePositiveSafeInteger(stored.videoSn, "cache.unavailable.videoSn");
  assertPositiveSafeInteger(expectedVideoSn, "expectedVideoSn");
  if (videoSn !== expectedVideoSn) {
    throw new Error("cache unavailable videoSn 與 key 不一致");
  }
  return {
    videoSn,
    observedAt: parseCanonicalIsoDate(stored.observedAt, "cache.unavailable.observedAt")
  };
};

export const isUnavailableMetadataFresh = (
  record: UnavailableMetadata,
  now = new Date()
): boolean => {
  assertValidDate(record.observedAt, "record.observedAt");
  assertValidDate(now, "now");
  const age = now.getTime() - record.observedAt.getTime();
  return age >= 0 && age < UNAVAILABLE_CACHE_TTL_MILLISECONDS;
};

export const readMetadataCache = async (
  storage: Pick<MetadataCacheStorage, "get">,
  videoSn: number
): Promise<MetadataCacheLookup> => {
  assertPositiveSafeInteger(videoSn, "videoSn");
  const episodeKey = episodeMetadataCacheKey(videoSn);
  const unavailableKey = unavailableMetadataCacheKey(videoSn);
  const first = requireRecord(
    await storage.get([episodeKey, unavailableKey]),
    "chrome.storage.local.get episode result"
  );

  if (Object.hasOwn(first, episodeKey)) {
    let episode: EpisodeMetadata;
    try {
      episode = parseStoredEpisodeMetadata(first[episodeKey], videoSn);
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
  }

  if (Object.hasOwn(first, unavailableKey)) {
    try {
      return {
        kind: "unavailable",
        record: parseStoredUnavailableMetadata(first[unavailableKey], videoSn)
      };
    } catch (error) {
      return { kind: "invalid", message: errorMessage(error) };
    }
  }

  return { kind: "miss" };
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
  schemaVersion: CACHE_SCHEMA_VERSION,
  kind: "anime",
  animeSn: metadata.animeSn,
  apiTitle: metadata.apiTitle,
  totalEpisode: metadata.totalEpisode,
  seasonStartDateKey: metadata.seasonStartDateKey,
  seasonEndDateKey: metadata.seasonEndDateKey,
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
      episodeNumber: requirePositiveSafeInteger(
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

const requireCacheHeader = (stored: JsonRecord, kind: string): void => {
  if (stored.schemaVersion !== CACHE_SCHEMA_VERSION || stored.kind !== kind) {
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

const requireExactRecord = (value: unknown, expectedKeys: readonly string[], label: string): JsonRecord => {
  const record = requireRecord(value, label);
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} 欄位不符合 schema v1`);
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
