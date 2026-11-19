import assert from "node:assert/strict";
import { test } from "vitest";
import {
  INVALID_RESPONSE_CACHE_TTL_MILLISECONDS,
  UNAVAILABLE_CACHE_BASE_TTL_MILLISECONDS,
  UNAVAILABLE_CACHE_JITTER_RATIO,
  UNAVAILABLE_CACHE_MAX_TTL_MILLISECONDS,
  animeMetadataCacheKey,
  clearMetadataCache,
  createInvalidMetadata,
  createUnavailableMetadata,
  episodeMetadataCacheKey,
  invalidMetadataCacheKey,
  isInvalidMetadataFresh,
  isMetadataV1CacheKey,
  isUnavailableMetadataFresh,
  metadataBundleCacheItems,
  metadataBundleToWire,
  parseMetadataBundleWire,
  parseStoredInvalidMetadata,
  parseStoredUnavailableMetadata,
  readMetadataCache,
  unavailableCacheJitter,
  unavailableCacheTtlMilliseconds,
  unavailableMetadataCacheKey,
  type MetadataCacheStorage
} from "./metadata-cache";
import { METADATA_PARSER_VERSION } from "./metadata-schema";
import type { MetadataBundle } from "./model";

const HOUR = 60 * 60 * 1_000;

const bundle = (): MetadataBundle => ({
  episode: {
    videoSn: 49054,
    animeSn: 114010,
    groupKey: "0",
    episodeIndex: 8,
    episodeNumber: 9,
    availableFrom: new Date("2026-05-20T17:00:00.000Z"),
    availableUntil: null,
    durationMinutes: 23,
    coverUrl: "https://p2.bahamut.com.tw/episode.JPG",
    videoType: 0,
    fetchedAt: new Date("2026-07-14T00:00:00.000Z")
  },
  anime: {
    animeSn: 114010,
    apiTitle: "API title [9]",
    totalEpisode: 13,
    isOngoing: false,
    seasonStartDateKey: "2026-04-02",
    seasonEndDateKey: "2026-07-02",
    coverUrl: "https://p2.bahamut.com.tw/anime.JPG",
    tags: ["校園", "喜劇"],
    maker: "Drive",
    director: "梅木葵",
    publisher: "Ani-One",
    episodeRefs: [
      { videoSn: 49053, episodeNumber: 8, groupKey: "0", coverUrl: null },
      {
        videoSn: 49054,
        episodeNumber: 9,
        groupKey: "0",
        coverUrl: "https://p2.bahamut.com.tw/ref.JPG"
      }
    ],
    platformSnapshot: {
      score: 4.8,
      reviewCount: 5224,
      popular: 28221,
      observedAt: new Date("2026-07-14T00:00:00.000Z")
    },
    fetchedAt: new Date("2026-07-14T00:00:00.000Z")
  }
});

class MemoryStorage implements MetadataCacheStorage {
  readonly values: Record<string, unknown>;
  readonly writes: Record<string, unknown>[] = [];
  readonly removals: string[][] = [];

  constructor(initial: Record<string, unknown> = {}) {
    this.values = structuredClone(initial) as Record<string, unknown>;
  }

  async get(keys: string[]): Promise<Record<string, unknown>> {
    return Object.fromEntries(
      keys.filter((key) => Object.hasOwn(this.values, key)).map((key) => [key, this.values[key]])
    );
  }

  async getAll(): Promise<Record<string, unknown>> {
    return { ...this.values };
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.writes.push(structuredClone(items) as Record<string, unknown>);
    Object.assign(this.values, structuredClone(items));
  }

  async remove(keys: string[]): Promise<void> {
    this.removals.push([...keys]);
    for (const key of keys) delete this.values[key];
  }
}

test("v1 keys accept only exact typed positive safe integer identities", () => {
  assert.equal(episodeMetadataCacheKey(1), "ani-gamer-heatmap:metadata:v1:episode:1");
  assert.equal(animeMetadataCacheKey(2), "ani-gamer-heatmap:metadata:v1:anime:2");
  assert.equal(unavailableMetadataCacheKey(3), "ani-gamer-heatmap:metadata:v1:unavailable:3");
  assert.equal(invalidMetadataCacheKey(4), "ani-gamer-heatmap:metadata:v1:invalid:4");
  for (const key of [
    episodeMetadataCacheKey(1),
    animeMetadataCacheKey(2),
    unavailableMetadataCacheKey(3),
    invalidMetadataCacheKey(4)
  ]) {
    assert.equal(isMetadataV1CacheKey(key), true);
  }
  for (const key of [
    "ani-gamer-heatmap:metadata:v1:episode:0",
    "ani-gamer-heatmap:metadata:v1:episode:01",
    "ani-gamer-heatmap:metadata:v1:episode:1:extra",
    "ani-gamer-heatmap:metadata:v1:other:1",
    "ani-gamer-heatmap:metadata:future:episode:1"
  ]) {
    assert.equal(isMetadataV1CacheKey(key), false, key);
  }
  assert.throws(() => episodeMetadataCacheKey(0));
});

test("metadata bundle wire round-trips strict schemas and deep dates", () => {
  const source = bundle();
  const wire = metadataBundleToWire(source);
  assert.equal(wire.episode.schemaVersion, 1);
  assert.equal(wire.episode.groupKey, "0");
  assert.equal(wire.anime.kind, "anime");
  const parsed = parseMetadataBundleWire(wire);
  assert.deepEqual(parsed, source);
  assert.notEqual(parsed.episode.availableFrom, source.episode.availableFrom);
  assert.notEqual(parsed.anime.tags, source.anime.tags);
  assert.notEqual(parsed.anime.episodeRefs, source.anime.episodeRefs);

  const extra = structuredClone(wire) as unknown as {
    episode: Record<string, unknown>;
  };
  extra.episode.extra = true;
  assert.throws(() => parseMetadataBundleWire(extra), /schema/);

  const wrongIdentity = structuredClone(wire) as unknown as {
    anime: { animeSn: number };
  };
  wrongIdentity.anime.animeSn = 999;
  assert.throws(() => parseMetadataBundleWire(wrongIdentity), /identity 不一致/);

  const invalidAvailability = structuredClone(wire) as unknown as {
    episode: { availableUntil: string };
  };
  invalidAvailability.episode.availableUntil = "2026-05-19T17:00:00.000Z";
  assert.throws(() => parseMetadataBundleWire(invalidAvailability), /不可早於/);

  const invalidSeason = structuredClone(wire) as unknown as {
    anime: { seasonStartDateKey: string; seasonEndDateKey: string };
  };
  invalidSeason.anime.seasonStartDateKey = "2026-07-02";
  invalidSeason.anime.seasonEndDateKey = "2026-04-02";
  assert.throws(() => parseMetadataBundleWire(invalidSeason), /不可早於/);

  const missingEpisodeGroup = structuredClone(wire) as unknown as {
    episode: Record<string, unknown>;
  };
  delete missingEpisodeGroup.episode.groupKey;
  assert.throws(() => parseMetadataBundleWire(missingEpisodeGroup), /schema/);

  const wrongEpisodeGroup = structuredClone(wire) as unknown as {
    episode: { groupKey: string };
  };
  wrongEpisodeGroup.episode.groupKey = "special";
  assert.throws(() => parseMetadataBundleWire(wrongEpisodeGroup), /缺少 episode 對應/);
});

test("readMetadataCache requires both exact episode and anime records", async () => {
  const source = bundle();
  const items = metadataBundleCacheItems(source);
  const storage = new MemoryStorage(items);
  const hit = await readMetadataCache(storage, source.episode.videoSn, source.anime.fetchedAt);
  assert.equal(hit.kind, "hit");
  if (hit.kind === "hit") {
    assert.deepEqual(hit.bundle, source);
    assert.notEqual(hit.bundle.episode, source.episode);
  }

  delete storage.values[animeMetadataCacheKey(source.anime.animeSn)];
  assert.deepEqual(
    await readMetadataCache(storage, source.episode.videoSn, source.anime.fetchedAt),
    { kind: "miss", previousUnavailable: null }
  );

  storage.values[episodeMetadataCacheKey(source.episode.videoSn)] = {
    schemaVersion: 1,
    kind: "episode",
    videoSn: source.episode.videoSn
  };
  const invalid = await readMetadataCache(storage, source.episode.videoSn, source.anime.fetchedAt);
  assert.equal(invalid.kind, "invalid");
});

test("cache preserves prologue and fractional episode labels", () => {

  const special = bundle();
  const relaxed: MetadataBundle = {
    episode: { ...special.episode, episodeNumber: 9.5 },
    anime: {
      ...special.anime,
      episodeRefs: [
        { videoSn: 49053, episodeNumber: 0, groupKey: "0", coverUrl: null },
        { videoSn: 49054, episodeNumber: 9.5, groupKey: "0", coverUrl: null }
      ]
    }
  };
  assert.deepEqual(parseMetadataBundleWire(metadataBundleToWire(relaxed)), relaxed);

  for (const episodeNumber of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const wire = structuredClone(metadataBundleToWire(bundle())) as unknown as {
      episode: { episodeNumber: number };
    };
    wire.episode.episodeNumber = episodeNumber;
    assert.throws(() => parseMetadataBundleWire(wire), /非負有限數字/);
  }
});

test("unavailable TTL grows fourfold per confirmation up to the cap, then gets a stable jitter", () => {
  for (const videoSn of [1, 20219, 44916, 9_007_199_254_740_991]) {
    const jitter = unavailableCacheJitter(videoSn);
    assert.equal(unavailableCacheJitter(videoSn), jitter);
    assert.ok(Math.abs(jitter) <= UNAVAILABLE_CACHE_JITTER_RATIO, String(videoSn));
    const ttl = (confirmations: number): number => unavailableCacheTtlMilliseconds({ videoSn, confirmations });
    // 一天、四天，之後封頂七天。
    assert.equal(ttl(0), Math.round(24 * HOUR * (1 + jitter)));
    assert.equal(ttl(1), Math.round(96 * HOUR * (1 + jitter)));
    assert.equal(ttl(2), Math.round(UNAVAILABLE_CACHE_MAX_TTL_MILLISECONDS * (1 + jitter)));
    assert.equal(ttl(1_000), ttl(2));
  }
  const jitters = new Set([20219, 20220, 20221, 44916, 30725].map(unavailableCacheJitter));
  assert.equal(jitters.size, 5);
  assert.throws(() => unavailableCacheTtlMilliseconds({ videoSn: 1, confirmations: -1 }));
  assert.equal(UNAVAILABLE_CACHE_BASE_TTL_MILLISECONDS, 24 * HOUR);
});

test("unavailable records keep their first observation and count confirmations", () => {
  const observedAt = new Date("2026-07-14T00:00:00.000Z");
  const first = createUnavailableMetadata(20219, observedAt);
  assert.deepEqual(first, {
    schemaVersion: 1,
    kind: "unavailable",
    videoSn: 20219,
    observedAt: "2026-07-14T00:00:00.000Z",
    firstObservedAt: "2026-07-14T00:00:00.000Z",
    confirmations: 0
  });
  const parsedFirst = parseStoredUnavailableMetadata(first, 20219);
  const renewedAt = new Date("2026-07-15T00:00:00.000Z");
  const renewed = parseStoredUnavailableMetadata(
    createUnavailableMetadata(20219, renewedAt, parsedFirst),
    20219
  );
  assert.deepEqual(renewed, { videoSn: 20219, observedAt: renewedAt, firstObservedAt: observedAt, confirmations: 1 });
  assert.throws(() => createUnavailableMetadata(1, renewedAt, parsedFirst), /不一致/);

  const ttl = unavailableCacheTtlMilliseconds(parsedFirst);
  assert.equal(isUnavailableMetadataFresh(parsedFirst, observedAt), true);
  assert.equal(isUnavailableMetadataFresh(parsedFirst, new Date(observedAt.getTime() + ttl - 1)), true);
  assert.equal(isUnavailableMetadataFresh(parsedFirst, new Date(observedAt.getTime() + ttl)), false);
  assert.equal(isUnavailableMetadataFresh(parsedFirst, new Date(observedAt.getTime() - 1)), false);
});

test("legacy unavailable records parse as the first observation; partial upgrades do not", () => {
  const legacy = {
    schemaVersion: 1,
    kind: "unavailable",
    videoSn: 20219,
    observedAt: "2026-07-14T11:30:00.000Z"
  };
  const observedAt = new Date(legacy.observedAt);
  assert.deepEqual(parseStoredUnavailableMetadata(legacy, 20219), {
    videoSn: 20219,
    observedAt,
    firstObservedAt: observedAt,
    confirmations: 0
  });
  const current = createUnavailableMetadata(20219, observedAt);
  for (const malformed of [
    { ...legacy, confirmations: 0 },
    { ...current, confirmations: -1 },
    { ...current, confirmations: 1.5 },
    { ...current, firstObservedAt: "2026-07-15T00:00:00.000Z" },
    { ...current, extra: true }
  ]) {
    assert.throws(() => parseStoredUnavailableMetadata(malformed, 20219), JSON.stringify(malformed));
  }
});

test("invalid-response records live 24 hours and only for the current parser version", () => {
  const observedAt = new Date("2026-07-14T00:00:00.000Z");
  const stored = createInvalidMetadata(30725, "metadata API response 格式無效：x", observedAt);
  assert.deepEqual(stored, {
    schemaVersion: 1,
    kind: "invalid",
    videoSn: 30725,
    observedAt: "2026-07-14T00:00:00.000Z",
    parserVersion: METADATA_PARSER_VERSION,
    message: "metadata API response 格式無效：x"
  });
  const parsed = parseStoredInvalidMetadata(stored, 30725);
  assert.equal(isInvalidMetadataFresh(parsed, observedAt), true);
  assert.equal(isInvalidMetadataFresh(
    parsed,
    new Date(observedAt.getTime() + INVALID_RESPONSE_CACHE_TTL_MILLISECONDS - 1)
  ), true);
  assert.equal(isInvalidMetadataFresh(
    parsed,
    new Date(observedAt.getTime() + INVALID_RESPONSE_CACHE_TTL_MILLISECONDS)
  ), false);
  assert.equal(isInvalidMetadataFresh(parsed, new Date(observedAt.getTime() - 1)), false);
  assert.equal(isInvalidMetadataFresh(
    parseStoredInvalidMetadata(createInvalidMetadata(30725, "old", observedAt, METADATA_PARSER_VERSION - 1), 30725),
    observedAt
  ), false);

  assert.equal(createInvalidMetadata(1, "長".repeat(5_000), observedAt).message.length, 4_096);
  assert.throws(() => createInvalidMetadata(1, "   ", observedAt));
  assert.throws(() => parseStoredInvalidMetadata(stored, 30726), /不一致/);
  assert.throws(() => parseStoredInvalidMetadata({ ...stored, parserVersion: 0 }, 30725));
  assert.throws(() => parseStoredInvalidMetadata({ ...stored, extra: 1 }, 30725), /schema/);
});

test("lookup order: usable records, then fresh unavailable, then fresh invalid-response", async () => {
  const now = new Date("2026-07-14T12:00:00.000Z");
  const source = bundle();
  const videoSn = source.episode.videoSn;
  const freshUnavailable = createUnavailableMetadata(videoSn, new Date(now.getTime() - 1_000));
  const expiredUnavailable = createUnavailableMetadata(videoSn, new Date(now.getTime() - 2 * 24 * HOUR));
  const freshInvalid = createInvalidMetadata(videoSn, "cached schema failure", new Date(now.getTime() - 1_000));
  const outdatedInvalid = createInvalidMetadata(
    videoSn,
    "old parser",
    new Date(now.getTime() - 1_000),
    METADATA_PARSER_VERSION - 1
  );
  const items = metadataBundleCacheItems(source);
  const staleAnime = {
    ...metadataBundleToWire(source).anime,
    episodeRefs: [{ videoSn: 49053, episodeNumber: 8, groupKey: "0", coverUrl: null }]
  };
  const lookup = async (values: Record<string, unknown>) => readMetadataCache(new MemoryStorage(values), videoSn, now);
  const unavailableKey = unavailableMetadataCacheKey(videoSn);
  const invalidKey = invalidMetadataCacheKey(videoSn);
  const animeKey = animeMetadataCacheKey(source.anime.animeSn);
  const episodeKey = episodeMetadataCacheKey(videoSn);

  assert.equal((await lookup({ ...items, [unavailableKey]: freshUnavailable, [invalidKey]: freshInvalid })).kind, "hit");
  // An episode whose anime index no longer references it must not hide a fresh negative answer.
  assert.equal((await lookup({ ...items, [animeKey]: staleAnime, [unavailableKey]: freshUnavailable })).kind, "unavailable");
  assert.equal((await lookup({ [episodeKey]: items[episodeKey], [invalidKey]: freshInvalid })).kind, "invalid-response");
  assert.equal((await lookup({ [unavailableKey]: freshUnavailable, [invalidKey]: freshInvalid })).kind, "unavailable");

  const invalidAfterExpiry = await lookup({ [unavailableKey]: expiredUnavailable, [invalidKey]: freshInvalid });
  assert.deepEqual(invalidAfterExpiry, {
    kind: "invalid-response",
    record: parseStoredInvalidMetadata(freshInvalid, videoSn)
  });
  assert.deepEqual(await lookup({ [unavailableKey]: expiredUnavailable }), {
    kind: "miss",
    previousUnavailable: parseStoredUnavailableMetadata(expiredUnavailable, videoSn)
  });
  assert.deepEqual(await lookup({ [invalidKey]: outdatedInvalid }), { kind: "miss", previousUnavailable: null });

  const staleEpisode = await lookup({ ...items, [animeKey]: staleAnime, [unavailableKey]: expiredUnavailable });
  assert.equal(staleEpisode.kind, "invalid");
  if (staleEpisode.kind === "invalid") {
    assert.match(staleEpisode.message, /缺少 episode 對應/);
    assert.equal(staleEpisode.previousUnavailable?.confirmations, 0);
  }
  assert.equal((await lookup({ [unavailableKey]: { kind: "unavailable" } })).kind, "invalid");
  assert.equal((await lookup({ [invalidKey]: { kind: "invalid" }, [unavailableKey]: freshUnavailable })).kind, "unavailable");
});

test("clearMetadataCache removes only owned v1 records and orphans", async () => {
  const owned = [
    episodeMetadataCacheKey(1),
    animeMetadataCacheKey(2),
    unavailableMetadataCacheKey(3),
    invalidMetadataCacheKey(4),
    "ani-gamer-heatmap:metadata:v1:corrupt"
  ];
  const unrelated = "ani-gamer-heatmap:history:v1";
  const similar = "ani-gamer-heatmap:metadata:future:episode:1";
  const storage = new MemoryStorage(Object.fromEntries([
    ...owned.map((key) => [key, true] as const),
    [unrelated, true],
    [similar, true]
  ]));

  assert.equal(await clearMetadataCache(storage), owned.length);
  assert.deepEqual(storage.removals, [owned]);
  assert.deepEqual(storage.values, { [unrelated]: true, [similar]: true });
  assert.equal(await clearMetadataCache(storage), 0);
  assert.equal(storage.removals.length, 1);
});

test("anime catalogs expire exactly after one day while episode facts remain reusable", async () => {
  const source = bundle();
  const storage = new MemoryStorage(metadataBundleCacheItems(source));
  const fetched = source.anime.fetchedAt.getTime();
  assert.equal((await readMetadataCache(storage, source.episode.videoSn, new Date(fetched + 24 * HOUR - 1))).kind, "hit");
  assert.equal((await readMetadataCache(storage, source.episode.videoSn, new Date(fetched + 24 * HOUR))).kind, "miss");
  assert.equal((await readMetadataCache(storage, source.episode.videoSn, new Date(fetched - 1))).kind, "miss");

  const refreshed = { ...source.anime, isOngoing: true, fetchedAt: new Date(fetched + 24 * HOUR) };
  Object.assign(storage.values, metadataBundleCacheItems({ ...source, anime: refreshed }));
  const lookup = await readMetadataCache(storage, source.episode.videoSn, refreshed.fetchedAt);
  assert.equal(lookup.kind, "hit");
  if (lookup.kind === "hit") {
    assert.equal(lookup.bundle.anime.isOngoing, true);
    assert.equal(lookup.bundle.episode.fetchedAt.getTime(), fetched);
  }
});

test("stale positive catalogs do not hide a fresh unavailable answer", async () => {
  const source = bundle();
  const now = new Date(source.anime.fetchedAt.getTime() + 24 * HOUR);
  const storage = new MemoryStorage({
    ...metadataBundleCacheItems(source),
    [unavailableMetadataCacheKey(source.episode.videoSn)]: createUnavailableMetadata(source.episode.videoSn, now)
  });
  assert.equal((await readMetadataCache(storage, source.episode.videoSn, now)).kind, "unavailable");
});

test("anime wire schema requires the official ongoing field and rejects obsolete records", () => {
  const wire = metadataBundleToWire(bundle());
  assert.equal(wire.anime.schemaVersion, 2);
  assert.equal(wire.anime.isOngoing, false);
  assert.throws(() => parseMetadataBundleWire({ ...wire, anime: { ...wire.anime, schemaVersion: 1 } }), /schema header/);
  assert.throws(() => parseMetadataBundleWire({ ...wire, anime: { ...wire.anime, isOngoing: 0 } }), /boolean/);
  const missing = { ...wire.anime } as Record<string, unknown>;
  delete missing.isOngoing;
  assert.throws(() => parseMetadataBundleWire({ ...wire, anime: missing }), /schema/);
});
