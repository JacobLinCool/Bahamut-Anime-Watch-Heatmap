import assert from "node:assert/strict";
import { test } from "vitest";
import {
  UNAVAILABLE_CACHE_TTL_MILLISECONDS,
  animeMetadataCacheKey,
  clearMetadataCache,
  createUnavailableMetadata,
  episodeMetadataCacheKey,
  isMetadataV1CacheKey,
  isUnavailableMetadataFresh,
  metadataBundleCacheItems,
  metadataBundleToWire,
  parseMetadataBundleWire,
  parseStoredUnavailableMetadata,
  readMetadataCache,
  unavailableMetadataCacheKey,
  type MetadataCacheStorage
} from "./metadata-cache";
import type { MetadataBundle } from "./model";

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
  for (const key of [
    episodeMetadataCacheKey(1),
    animeMetadataCacheKey(2),
    unavailableMetadataCacheKey(3)
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

test("metadata bundle wire round-trips exact v1 schema and deep dates", () => {
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
  assert.throws(() => parseMetadataBundleWire(extra), /schema v1/);

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
  assert.throws(() => parseMetadataBundleWire(missingEpisodeGroup), /schema v1/);

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
  const hit = await readMetadataCache(storage, source.episode.videoSn);
  assert.equal(hit.kind, "hit");
  if (hit.kind === "hit") {
    assert.deepEqual(hit.bundle, source);
    assert.notEqual(hit.bundle.episode, source.episode);
  }

  delete storage.values[animeMetadataCacheKey(source.anime.animeSn)];
  assert.deepEqual(await readMetadataCache(storage, source.episode.videoSn), { kind: "miss" });

  storage.values[episodeMetadataCacheKey(source.episode.videoSn)] = {
    schemaVersion: 1,
    kind: "episode",
    videoSn: source.episode.videoSn
  };
  const invalid = await readMetadataCache(storage, source.episode.videoSn);
  assert.equal(invalid.kind, "invalid");
});

test("typed unavailable records obey a half-open one-hour TTL", async () => {
  const observedAt = new Date("2026-07-14T00:00:00.000Z");
  const stored = createUnavailableMetadata(20219, observedAt);
  const parsed = parseStoredUnavailableMetadata(stored, 20219);
  assert.deepEqual(parsed, { videoSn: 20219, observedAt });
  assert.equal(isUnavailableMetadataFresh(parsed, new Date(observedAt.getTime())), true);
  assert.equal(isUnavailableMetadataFresh(
    parsed,
    new Date(observedAt.getTime() + UNAVAILABLE_CACHE_TTL_MILLISECONDS - 1)
  ), true);
  assert.equal(isUnavailableMetadataFresh(
    parsed,
    new Date(observedAt.getTime() + UNAVAILABLE_CACHE_TTL_MILLISECONDS)
  ), false);
  assert.equal(isUnavailableMetadataFresh(parsed, new Date(observedAt.getTime() - 1)), false);

  const storage = new MemoryStorage({ [unavailableMetadataCacheKey(20219)]: stored });
  const lookup = await readMetadataCache(storage, 20219);
  assert.equal(lookup.kind, "unavailable");
});

test("clearMetadataCache removes only owned v1 records and orphans", async () => {
  const owned = [
    episodeMetadataCacheKey(1),
    animeMetadataCacheKey(2),
    unavailableMetadataCacheKey(3),
    "ani-gamer-heatmap:metadata:v1:corrupt"
  ];
  const unrelated = "ani-gamer-heatmap:setting";
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
