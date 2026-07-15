import type {
  AnimeMetadata,
  AnimePlatformSnapshot,
  EpisodeMetadata,
  EpisodeRef,
  MetadataBundle
} from "./model";

const TAIPEI_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1000;
const UNAVAILABLE_MESSAGE = "目前無此動畫或動畫授權已到期！";
const MAX_GENERAL_STRING_LENGTH = 2_048;
const MAX_URL_LENGTH = 4_096;
const MAX_TAG_COUNT = 100;
const MAX_TAG_LENGTH = 256;
const MAX_EPISODE_REF_COUNT = 10_000;
const MAX_GROUP_KEY_LENGTH = 128;

type JsonRecord = Record<string, unknown>;

export class MetadataUnavailableError extends Error {
  readonly videoSn: number;

  constructor(videoSn: number, message = UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = "MetadataUnavailableError";
    this.videoSn = videoSn;
  }
}

export const parseMetadataResponse = (
  value: unknown,
  requestedVideoSn: number,
  fetchedAt = new Date()
): MetadataBundle => {
  assertPositiveSafeInteger(requestedVideoSn, "requestedVideoSn");
  assertValidDate(fetchedAt, "fetchedAt");

  const response = requireRecord(value, "API response");
  const hasData = Object.hasOwn(response, "data");
  const hasError = Object.hasOwn(response, "error");
  if (hasData === hasError) {
    throw new Error("API response 必須恰有 data 或 error");
  }

  if (hasError) {
    const error = requireRecord(response.error, "API error");
    if (error.message === UNAVAILABLE_MESSAGE) {
      throw new MetadataUnavailableError(requestedVideoSn);
    }
    throw new Error("API 回傳未識別的錯誤格式");
  }

  const data = requireRecord(response.data, "API data");
  const video = requireRecord(data.video, "API data.video");
  const anime = requireRecord(data.anime, "API data.anime");
  const videoSn = requirePositiveSafeInteger(video.videoSn, "data.video.videoSn");
  const videoAnimeSn = requirePositiveSafeInteger(video.animeSn, "data.video.animeSn");
  const animeSn = requirePositiveSafeInteger(anime.animeSn, "data.anime.animeSn");

  if (videoSn !== requestedVideoSn) {
    throw new Error("API videoSn 與請求不一致");
  }
  if (videoAnimeSn !== animeSn) {
    throw new Error("API video/anime 的 animeSn 不一致");
  }

  const episodeRefs = parseEpisodeRefs(anime.episodes);
  const matchingRefs = episodeRefs.filter((reference) => reference.videoSn === videoSn);
  if (matchingRefs.length !== 1) {
    throw new Error("data.anime.episodes 必須恰有一筆符合請求 videoSn");
  }
  const matchingRef = matchingRefs[0];
  if (!matchingRef) {
    throw new Error("data.anime.episodes 缺少請求 videoSn");
  }

  const observedAt = cloneDate(fetchedAt);
  const platformSnapshot: AnimePlatformSnapshot = {
    score: requireFiniteNumberInRange(anime.score, "data.anime.score", 0, 5),
    reviewCount: requireNonNegativeSafeInteger(anime.reviewCount, "data.anime.reviewCount"),
    popular: requireNonNegativeSafeInteger(anime.popular, "data.anime.popular"),
    observedAt: cloneDate(observedAt)
  };
  const episode: EpisodeMetadata = {
    videoSn,
    animeSn,
    groupKey: matchingRef.groupKey,
    episodeIndex: requireNonNegativeSafeInteger(anime.episodeIndex, "data.anime.episodeIndex"),
    episodeNumber: matchingRef.episodeNumber,
    availableFrom: parseTaipeiDateTime(
      requireString(video.upTime, "data.video.upTime", MAX_GENERAL_STRING_LENGTH),
      "data.video.upTime"
    ),
    availableUntil: parseNullableTaipeiDateTime(video.downTime, "data.video.downTime"),
    durationMinutes: requireNonNegativeSafeInteger(video.duration, "data.video.duration"),
    coverUrl: parseNullableHttpsUrl(video.cover, "data.video.cover"),
    videoType: requireNonNegativeSafeInteger(video.type, "data.video.type"),
    fetchedAt: cloneDate(observedAt)
  };
  const animeMetadata: AnimeMetadata = {
    animeSn,
    apiTitle: requireNonBlankString(anime.title, "data.anime.title", MAX_GENERAL_STRING_LENGTH),
    totalEpisode: requireNonNegativeSafeInteger(anime.totalEpisode, "data.anime.totalEpisode"),
    seasonStartDateKey: parseNullableTaipeiDateKey(anime.seasonStart, "data.anime.seasonStart"),
    seasonEndDateKey: parseNullableTaipeiDateKey(anime.seasonEnd, "data.anime.seasonEnd"),
    coverUrl: parseNullableHttpsUrl(anime.cover, "data.anime.cover"),
    tags: parseTags(anime.tags),
    maker: parseNullableText(anime.maker, "data.anime.maker"),
    director: parseNullableText(anime.director, "data.anime.director"),
    publisher: parseNullableText(anime.publisher, "data.anime.publisher"),
    episodeRefs,
    platformSnapshot,
    fetchedAt: cloneDate(observedAt)
  };

  if (
    episode.availableUntil !== null
    && episode.availableUntil.getTime() < episode.availableFrom.getTime()
  ) {
    throw new Error("data.video.downTime 不可早於 data.video.upTime");
  }
  if (
    animeMetadata.seasonStartDateKey !== null
    && animeMetadata.seasonEndDateKey !== null
    && animeMetadata.seasonEndDateKey < animeMetadata.seasonStartDateKey
  ) {
    throw new Error("data.anime.seasonEnd 不可早於 seasonStart");
  }

  return { episode, anime: animeMetadata };
};

export const parseTaipeiDateTime = (raw: string, label = "台北日期時間"): Date => {
  const match = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/.exec(raw);
  if (!match) {
    throw new Error(`${label} 格式必須為 YYYY/MM/DD HH:mm`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const wallClock = createValidatedUtcWallClock(year, month, day, hour, minute, label);
  return new Date(wallClock.getTime() - TAIPEI_OFFSET_MILLISECONDS);
};

export const parseTaipeiDateKey = (raw: string, label = "台北日期"): string => {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(raw);
  if (!match) {
    throw new Error(`${label} 格式必須為 YYYY/MM/DD`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  createValidatedUtcWallClock(year, month, day, 0, 0, label);
  return `${match[1]}-${match[2]}-${match[3]}`;
};

export const cloneMetadataBundle = (bundle: MetadataBundle): MetadataBundle => ({
  episode: cloneEpisodeMetadata(bundle.episode),
  anime: cloneAnimeMetadata(bundle.anime)
});

export const cloneEpisodeMetadata = (metadata: EpisodeMetadata): EpisodeMetadata => ({
  ...metadata,
  availableFrom: cloneDate(metadata.availableFrom),
  availableUntil: metadata.availableUntil === null ? null : cloneDate(metadata.availableUntil),
  fetchedAt: cloneDate(metadata.fetchedAt)
});

export const cloneAnimeMetadata = (metadata: AnimeMetadata): AnimeMetadata => ({
  ...metadata,
  tags: [...metadata.tags],
  episodeRefs: metadata.episodeRefs.map((reference) => ({ ...reference })),
  platformSnapshot: {
    ...metadata.platformSnapshot,
    observedAt: cloneDate(metadata.platformSnapshot.observedAt)
  },
  fetchedAt: cloneDate(metadata.fetchedAt)
});

const parseEpisodeRefs = (value: unknown): readonly EpisodeRef[] => {
  const groups = requireRecord(value, "data.anime.episodes");
  const references: EpisodeRef[] = [];
  const seenVideoSns = new Set<number>();

  for (const [groupKey, rawEntries] of Object.entries(groups)) {
    if (
      groupKey.length < 1
      || groupKey.length > MAX_GROUP_KEY_LENGTH
      || groupKey.trim().length === 0
    ) {
      throw new Error("data.anime.episodes group key 長度無效");
    }
    if (!Array.isArray(rawEntries)) {
      throw new Error(`data.anime.episodes.${groupKey} 必須是 array`);
    }

    for (const [index, rawEntry] of rawEntries.entries()) {
      if (references.length >= MAX_EPISODE_REF_COUNT) {
        throw new Error(`data.anime.episodes 不可超過 ${MAX_EPISODE_REF_COUNT} 筆`);
      }
      const entry = requireRecord(rawEntry, `data.anime.episodes.${groupKey}[${index}]`);
      const videoSn = requirePositiveSafeInteger(
        entry.videoSn,
        `data.anime.episodes.${groupKey}[${index}].videoSn`
      );
      if (seenVideoSns.has(videoSn)) {
        throw new Error(`data.anime.episodes 有重複 videoSn：${videoSn}`);
      }
      seenVideoSns.add(videoSn);
      references.push({
        videoSn,
        episodeNumber: requirePositiveSafeInteger(
          entry.episode,
          `data.anime.episodes.${groupKey}[${index}].episode`
        ),
        groupKey,
        coverUrl: parseNullableHttpsUrl(
          entry.cover,
          `data.anime.episodes.${groupKey}[${index}].cover`
        )
      });
    }
  }

  return references;
};

const parseTags = (value: unknown): readonly string[] => {
  if (!Array.isArray(value) || value.length > MAX_TAG_COUNT) {
    throw new Error(`data.anime.tags 必須是最多 ${MAX_TAG_COUNT} 筆的 array`);
  }
  return value.map((tag, index) => requireNonBlankString(
    tag,
    `data.anime.tags[${index}]`,
    MAX_TAG_LENGTH
  ));
};

const parseNullableTaipeiDateTime = (value: unknown, label: string): Date | null => {
  const raw = requireString(value, label, MAX_GENERAL_STRING_LENGTH);
  return raw === "" ? null : parseTaipeiDateTime(raw, label);
};

const parseNullableTaipeiDateKey = (value: unknown, label: string): string | null => {
  const raw = requireString(value, label, MAX_GENERAL_STRING_LENGTH);
  return raw === "" ? null : parseTaipeiDateKey(raw, label);
};

const parseNullableText = (value: unknown, label: string): string | null => {
  const raw = requireString(value, label, MAX_GENERAL_STRING_LENGTH);
  if (raw === "") return null;
  if (raw.trim().length === 0) {
    throw new Error(`${label} 不可只有空白`);
  }
  return raw;
};

const parseNullableHttpsUrl = (value: unknown, label: string): string | null => {
  const raw = requireString(value, label, MAX_URL_LENGTH);
  if (raw === "") return null;
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

const createValidatedUtcWallClock = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  label: string
): Date => {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, 0, 0);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute
  ) {
    throw new Error(`${label} 不是有效日期時間`);
  }
  return date;
};

const requireRecord = (value: unknown, label: string): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} 必須是 object`);
  }
  return value as JsonRecord;
};

const requireString = (value: unknown, label: string, maxLength: number): string => {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`${label} 必須是長度不超過 ${maxLength} 的字串`);
  }
  return value;
};

const requireNonBlankString = (value: unknown, label: string, maxLength: number): string => {
  const text = requireString(value, label, maxLength);
  if (text.trim().length === 0) {
    throw new Error(`${label} 不可為空字串或只有空白`);
  }
  return text;
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

const cloneDate = (value: Date): Date => new Date(value.getTime());
