import assert from "node:assert/strict";
import { test } from "vitest";
import { realApiResponse, type RealApiResponseName } from "./fixtures/metadata-api";
import {
  INVALID_RESPONSE_CACHE_TTL_MILLISECONDS,
  animeMetadataCacheKey,
  clearMetadataCache,
  createInvalidMetadata,
  episodeMetadataCacheKey,
  invalidMetadataCacheKey,
  metadataBundleCacheItems,
  metadataBundleToWire,
  parseStoredUnavailableMetadata,
  readMetadataCache,
  unavailableCacheTtlMilliseconds,
  unavailableMetadataCacheKey,
  type MetadataCacheStorage
} from "./metadata-cache";
import { MetadataCoordinator, type MetadataCoordinatorBackend } from "./metadata-coordinator";
import {
  METADATA_PARSER_VERSION,
  MetadataUnavailableError,
  parseMetadataResponse
} from "./metadata-schema";
import {
  MetadataService,
  MetadataServiceError,
  type MetadataFetcher
} from "./metadata-service";

const apiValue = (videoSn = 49054): unknown => ({
  data: {
    video: {
      videoSn,
      animeSn: 114010,
      duration: 23,
      type: 0,
      cover: "https://p2.bahamut.com.tw/episode.JPG",
      upTime: "2026/05/21 01:00",
      downTime: ""
    },
    anime: {
      animeSn: 114010,
      title: "API title [9]",
      totalEpisode: 13,
      flag: 0,
      seasonStart: "2026/04/02",
      seasonEnd: "2026/07/02",
      episodeIndex: 8,
      episodes: {
        "0": [{
          episode: 9,
          videoSn,
          state: 1,
          cover: "https://p2.bahamut.com.tw/ref.JPG"
        }]
      },
      cover: "https://p2.bahamut.com.tw/anime.JPG",
      tags: ["校園"],
      director: "梅木葵",
      publisher: "Ani-One",
      maker: "Drive",
      score: 4.8,
      reviewCount: 5224,
      popular: 28221
    }
  }
});

class MemoryStorage implements MetadataCacheStorage {
  readonly values: Record<string, unknown> = {};
  readonly writes: Record<string, unknown>[] = [];
  readonly removals: string[][] = [];

  constructor(initial: Record<string, unknown> = {}) {
    Object.assign(this.values, structuredClone(initial));
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

const createHarness = ({
  storage = new MemoryStorage(),
  fetcher,
  now = () => new Date("2026-07-14T00:00:00.000Z")
}: {
  storage?: MemoryStorage;
  fetcher: MetadataFetcher;
  now?: () => Date;
}) => {
  let epoch = "epoch-1";
  let starts: number[] = [];
  let throttleTime = 0;
  let epochCounter = 1;
  const backend: MetadataCoordinatorBackend = {
    readEpoch: async () => epoch,
    writeEpoch: async (value) => { epoch = value; },
    clearCache: () => clearMetadataCache(storage),
    readRequestStarts: async () => [...starts],
    writeRequestStarts: async (value) => { starts = [...value]; }
  };
  const coordinator = new MetadataCoordinator({
    backend,
    createEpoch: () => `epoch-${++epochCounter}`,
    requestClock: {
      now: () => throttleTime,
      sleep: async (milliseconds) => { throttleTime += milliseconds; }
    }
  });
  return {
    storage,
    coordinator,
    service: new MetadataService({ coordinator, storage, fetcher, now }),
    getEpoch: () => epoch,
    getStarts: () => [...starts]
  };
};

test("MetadataService returns a strict cache hit without a request", async () => {
  const fetchedAt = new Date("2026-07-14T00:00:00.000Z");
  const cached = parseMetadataResponse(apiValue(), 49054, fetchedAt);
  const storage = new MemoryStorage(metadataBundleCacheItems(cached));
  let fetchCount = 0;
  const harness = createHarness({
    storage,
    fetcher: async () => {
      fetchCount += 1;
      throw new Error("must not fetch");
    }
  });

  const resolved = await harness.service.resolveEpisode(49054);
  assert.deepEqual(resolved, cached);
  assert.notEqual(resolved, cached);
  assert.equal(fetchCount, 0);
  assert.deepEqual(harness.getStarts(), []);
});

test("MetadataService fetches, validates, and atomically persists episode plus anime", async () => {
  const requestUrls: string[] = [];
  const requestInits: RequestInit[] = [];
  const harness = createHarness({
    fetcher: async (url, init) => {
      requestUrls.push(url);
      requestInits.push(init);
      return new Response(JSON.stringify(apiValue()));
    }
  });
  harness.storage.values[unavailableMetadataCacheKey(49054)] = {
    schemaVersion: 1,
    kind: "unavailable",
    videoSn: 49054,
    observedAt: "2020-01-01T00:00:00.000Z"
  };

  const resolved = await harness.service.resolveEpisode(49054);
  assert.equal(resolved.episode.durationMinutes, 23);
  assert.equal(resolved.anime.episodeRefs[0]?.groupKey, "0");
  assert.equal(requestUrls.length, 1);
  assert.equal(new URL(requestUrls[0] ?? "").searchParams.get("videoSn"), "49054");
  assert.equal(requestInits[0]?.method, "GET");
  assert.equal(requestInits[0]?.credentials, "omit");
  assert.equal(new Headers(requestInits[0]?.headers).get("accept"), "application/json");
  assert.equal(harness.storage.writes.length, 1);
  assert.equal(Object.hasOwn(harness.storage.values, unavailableMetadataCacheKey(49054)), false);
  assert.equal((await readMetadataCache(harness.storage, 49054, new Date("2026-07-14T00:00:00.000Z"))).kind, "hit");
});

test("same epoch and videoSn share one in-flight request across callers", async () => {
  let fetchCount = 0;
  let releaseResponse: (() => void) | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const fetcher: MetadataFetcher = async () => {
    fetchCount += 1;
    markStarted?.();
    await new Promise<void>((resolve) => { releaseResponse = resolve; });
    return new Response(JSON.stringify(apiValue()));
  };
  const harness = createHarness({ fetcher });
  const first = harness.service.resolveEpisode(49054);
  const second = harness.service.resolveEpisode(49054);
  await started;
  assert.equal(fetchCount, 1);
  releaseResponse?.();
  const [left, right] = await Promise.all([first, second]);
  assert.deepEqual(left, right);
  assert.notEqual(left, right);
  assert.equal(fetchCount, 1);
});

test("known unavailable response is negatively cached until the exact TTL boundary", async () => {
  let clock = new Date("2026-07-14T00:00:00.000Z");
  let fetchCount = 0;
  let returnAvailable = false;
  const harness = createHarness({
    now: () => new Date(clock.getTime()),
    fetcher: async () => {
      fetchCount += 1;
      return new Response(JSON.stringify(returnAvailable
        ? apiValue()
        : { error: { message: "目前無此動畫或動畫授權已到期！" } }));
    }
  });

  await assert.rejects(
    harness.service.resolveEpisode(49054),
    (error) => error instanceof MetadataUnavailableError && error.videoSn === 49054
  );
  assert.equal(fetchCount, 1);
  assert.equal(Object.hasOwn(harness.storage.values, unavailableMetadataCacheKey(49054)), true);

  const ttl = unavailableCacheTtlMilliseconds({ videoSn: 49054, confirmations: 0 });
  clock = new Date(clock.getTime() + ttl - 1);
  await assert.rejects(harness.service.resolveEpisode(49054), MetadataUnavailableError);
  assert.equal(fetchCount, 1);

  clock = new Date(clock.getTime() + 1);
  returnAvailable = true;
  const result = await harness.service.resolveEpisode(49054);
  assert.equal(result.episode.videoSn, 49054);
  assert.equal(fetchCount, 2);
  assert.equal(Object.hasOwn(harness.storage.values, unavailableMetadataCacheKey(49054)), false);
});

test("clear rotates epoch before removal and rejects a late in-flight write", async () => {
  let releaseResponse: (() => void) | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const harness = createHarness({
    fetcher: async () => {
      markStarted?.();
      await new Promise<void>((resolve) => { releaseResponse = resolve; });
      return new Response(JSON.stringify(apiValue()));
    }
  });
  const resolving = harness.service.resolveEpisode(49054);
  await started;
  assert.equal(await harness.service.clearCache(), 0);
  assert.equal(harness.getEpoch(), "epoch-2");
  releaseResponse?.();
  await assert.rejects(
    resolving,
    (error) => error instanceof MetadataServiceError && error.kind === "cache-invalidated"
  );
  assert.equal(Object.hasOwn(harness.storage.values, episodeMetadataCacheKey(49054)), false);
});

test("invalid cache is replaced from the primary endpoint, while storage failure fails closed", async () => {
  let fetchCount = 0;
  const storage = new MemoryStorage({
    [episodeMetadataCacheKey(49054)]: { schemaVersion: 1, kind: "episode", videoSn: 49054 }
  });
  const harness = createHarness({
    storage,
    fetcher: async () => {
      fetchCount += 1;
      return new Response(JSON.stringify(apiValue()));
    }
  });
  assert.equal((await harness.service.resolveEpisode(49054)).episode.videoSn, 49054);
  assert.equal(fetchCount, 1);

  const failingStorage = new MemoryStorage();
  failingStorage.set = async () => { throw new Error("quota exceeded"); };
  const failing = createHarness({
    storage: failingStorage,
    fetcher: async () => new Response(JSON.stringify(apiValue()))
  });
  await assert.rejects(
    failing.service.resolveEpisode(49054),
    (error) => error instanceof MetadataServiceError && error.kind === "invalid-cache"
  );
});

test("network, HTTP, and malformed API failures retain typed service errors", async () => {
  const cases: Array<[MetadataServiceError["kind"], MetadataFetcher]> = [
    ["network", async () => { throw new Error("offline"); }],
    ["http", async () => new Response("no", { status: 503 })],
    ["invalid-response", async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } })],
    ["invalid-response", async () => new Response(JSON.stringify({ data: {} }))]
  ];
  for (const [expectedKind, fetcher] of cases) {
    const harness = createHarness({ fetcher });
    await assert.rejects(
      harness.service.resolveEpisode(49054),
      (error) => error instanceof MetadataServiceError && error.kind === expectedKind
    );
  }
});

const UNAVAILABLE_RESPONSE = { error: { message: "目前無此動畫或動畫授權已到期！" } };

test("each renewed unavailable answer extends the backoff and keeps the first observation", async () => {
  const firstAt = new Date("2026-07-14T00:00:00.000Z");
  let clock = firstAt;
  let fetchCount = 0;
  const harness = createHarness({
    now: () => new Date(clock.getTime()),
    fetcher: async () => {
      fetchCount += 1;
      return new Response(JSON.stringify(UNAVAILABLE_RESPONSE));
    }
  });
  const stored = () => parseStoredUnavailableMetadata(
    harness.storage.values[unavailableMetadataCacheKey(49054)],
    49054
  );

  for (let confirmations = 0; confirmations < 3; confirmations += 1) {
    await assert.rejects(harness.service.resolveEpisode(49054), MetadataUnavailableError);
    assert.equal(fetchCount, confirmations + 1);
    assert.deepEqual(stored(), {
      videoSn: 49054,
      observedAt: clock,
      firstObservedAt: firstAt,
      confirmations
    });
    const ttl = unavailableCacheTtlMilliseconds({ videoSn: 49054, confirmations });
    clock = new Date(clock.getTime() + ttl - 1);
    await assert.rejects(harness.service.resolveEpisode(49054), MetadataUnavailableError);
    assert.equal(fetchCount, confirmations + 1);
    clock = new Date(clock.getTime() + 1);
  }
});

test("a schema failure is negatively cached for 24 hours with the same message", async () => {
  let clock = new Date("2026-07-14T00:00:00.000Z");
  let fetchCount = 0;
  const malformed = apiValue() as { data: { video: Record<string, unknown> } };
  malformed.data.video.duration = -1;
  let body: unknown = malformed;
  const harness = createHarness({
    now: () => new Date(clock.getTime()),
    fetcher: async () => {
      fetchCount += 1;
      return new Response(JSON.stringify(body));
    }
  });
  const rejectsWith = async (message: RegExp | string) => {
    await assert.rejects(harness.service.resolveEpisode(49054), (error) =>
      error instanceof MetadataServiceError
      && error.kind === "invalid-response"
      && (typeof message === "string" ? error.message === message : message.test(error.message)));
  };

  await rejectsWith(/metadata API response 格式無效：/);
  assert.equal(fetchCount, 1);
  const record = harness.storage.values[invalidMetadataCacheKey(49054)] as { message: string; parserVersion: number };
  assert.equal(record.parserVersion, METADATA_PARSER_VERSION);

  clock = new Date(clock.getTime() + INVALID_RESPONSE_CACHE_TTL_MILLISECONDS - 1);
  await rejectsWith(record.message);
  assert.equal(fetchCount, 1);

  clock = new Date(clock.getTime() + 1);
  body = apiValue();
  assert.equal((await harness.service.resolveEpisode(49054)).episode.videoSn, 49054);
  assert.equal(fetchCount, 2);
  assert.equal(Object.hasOwn(harness.storage.values, invalidMetadataCacheKey(49054)), false);
});

test("an invalid-response record from another parser version is refetched at once", async () => {
  let fetchCount = 0;
  const storage = new MemoryStorage({
    [invalidMetadataCacheKey(30725)]: createInvalidMetadata(
      30725,
      "metadata API response 格式無效：data.video.downTime 格式必須為 YYYY/MM/DD HH:mm",
      new Date("2026-07-14T00:00:00.000Z"),
      METADATA_PARSER_VERSION - 1
    )
  });
  const harness = createHarness({
    storage,
    fetcher: async () => {
      fetchCount += 1;
      return new Response(JSON.stringify(realApiResponse("dateOnlyDownTime")));
    }
  });
  const resolved = await harness.service.resolveEpisode(30725);
  assert.equal(resolved.episode.availableUntil?.toISOString(), "2026-10-30T16:00:00.000Z");
  assert.equal(fetchCount, 1);
  assert.equal(Object.hasOwn(storage.values, invalidMetadataCacheKey(30725)), false);
});

test("transient failures are never negatively cached", async () => {
  const cases: Array<[string, () => Promise<Awaited<ReturnType<MetadataFetcher>>>]> = [
    ["network", async () => { throw new Error("offline"); }],
    ["http 429", async () => new Response("slow down", { status: 429 })],
    ["http 503", async () => new Response("no", { status: 503 })],
    ["invalid json", async () => new Response("<html>maintenance</html>")],
    ["unknown error envelope", async () => new Response(JSON.stringify({ error: { message: "請稍後再試" } }))],
    ["data and error", async () => new Response(JSON.stringify({ data: {}, error: {} }))],
    ["null data", async () => new Response(JSON.stringify({ data: null }))],
    ["empty array data", async () => new Response(JSON.stringify({ data: [] }))],
    ["empty data", async () => new Response(JSON.stringify({ data: {} }))],
    ["empty video and anime", async () => new Response(JSON.stringify({ data: { video: {}, anime: {} } }))],
    ["another episode", async () => new Response(JSON.stringify(apiValue(49055)))]
  ];
  for (const [label, respond] of cases) {
    let fetchCount = 0;
    const harness = createHarness({
      fetcher: async () => {
        fetchCount += 1;
        return respond();
      }
    });
    await assert.rejects(harness.service.resolveEpisode(49054), MetadataServiceError, label);
    await assert.rejects(harness.service.resolveEpisode(49054), MetadataServiceError, label);
    assert.equal(fetchCount, 2, label);
    assert.deepEqual(Object.keys(harness.storage.values), [], label);
  }
});

test("a delisted episode whose anime index dropped it stops refetching", async () => {
  const cached = parseMetadataResponse(apiValue(), 49054, new Date("2026-07-01T00:00:00.000Z"));
  const wire = metadataBundleToWire(cached);
  const animeKey = animeMetadataCacheKey(cached.anime.animeSn);
  const storage = new MemoryStorage({
    [episodeMetadataCacheKey(49054)]: wire.episode,
    // A sibling's later fetch rewrote the shared anime record without this episode.
    [animeKey]: { ...wire.anime, episodeRefs: [] },
    [invalidMetadataCacheKey(49054)]: createInvalidMetadata(
      49054,
      "old failure",
      new Date("2026-07-01T00:00:00.000Z")
    )
  });
  let fetchCount = 0;
  const harness = createHarness({
    storage,
    fetcher: async () => {
      fetchCount += 1;
      return new Response(JSON.stringify(UNAVAILABLE_RESPONSE));
    }
  });

  await assert.rejects(harness.service.resolveEpisode(49054), MetadataUnavailableError);
  assert.equal(fetchCount, 1);
  assert.equal(Object.hasOwn(storage.values, episodeMetadataCacheKey(49054)), false);
  assert.equal(Object.hasOwn(storage.values, invalidMetadataCacheKey(49054)), false);
  assert.equal(Object.hasOwn(storage.values, animeKey), true);

  await assert.rejects(harness.service.resolveEpisode(49054), MetadataUnavailableError);
  assert.equal(fetchCount, 1);
});

test("real payloads that the first parser rejected now resolve and cache", async () => {
  const cases: Array<[RealApiResponseName, number]> = [
    ["dateOnlyDownTime", 30725],
    ["prologueEpisode", 45534],
    ["fractionalRequestedEpisode", 48439],
    ["fractionalSiblingEpisode", 43990]
  ];
  for (const [name, videoSn] of cases) {
    let fetchCount = 0;
    const harness = createHarness({
      fetcher: async () => {
        fetchCount += 1;
        return new Response(JSON.stringify(realApiResponse(name)));
      }
    });
    const first = await harness.service.resolveEpisode(videoSn);
    assert.deepEqual(await harness.service.resolveEpisode(videoSn), first, name);
    assert.equal(fetchCount, 1, name);
    assert.equal((await readMetadataCache(harness.storage, videoSn, new Date("2026-07-14T00:00:00.000Z"))).kind, "hit", name);
  }
});

test("an expired anime catalog refreshes once and is shared by cached sibling episodes", async () => {
  const oldTime = new Date("2026-07-13T00:00:00.000Z");
  const now = new Date("2026-07-14T00:00:00.000Z");
  const valueFor = (videoSn: number, ongoing: boolean) => {
    const value = apiValue(videoSn) as { data: { anime: Record<string, unknown> } };
    if (ongoing) value.data.anime.seasonEnd = "2100/12/31";
    value.data.anime.episodes = {
      "0": [
        { episode: 9, videoSn: 49054, state: 0, cover: "" },
        { episode: 10, videoSn: 49055, state: 0, cover: "" }
      ]
    };
    return value;
  };
  const storage = new MemoryStorage({
    ...metadataBundleCacheItems(parseMetadataResponse(valueFor(49054, false), 49054, oldTime)),
    ...metadataBundleCacheItems(parseMetadataResponse(valueFor(49055, false), 49055, oldTime))
  });
  const requested: number[] = [];
  const harness = createHarness({
    storage,
    now: () => now,
    fetcher: async (url) => {
      const videoSn = Number(new URL(url).searchParams.get("videoSn"));
      requested.push(videoSn);
      return new Response(JSON.stringify(valueFor(videoSn, true)));
    }
  });
  assert.equal((await harness.service.resolveEpisode(49054)).anime.isOngoing, true);
  const sibling = await harness.service.resolveEpisode(49055);
  assert.equal(sibling.anime.isOngoing, true);
  assert.equal(sibling.anime.fetchedAt.getTime(), now.getTime());
  assert.equal(sibling.episode.fetchedAt.getTime(), oldTime.getTime());
  assert.deepEqual(requested, [49054]);
});

test("persisting a response cannot replace a newer official anime snapshot", async () => {
  const now = new Date("2026-07-14T00:00:00.000Z");
  const future = new Date("2026-07-14T01:00:00.000Z");
  const newerValue = apiValue() as { data: { anime: Record<string, unknown> } };
  newerValue.data.anime.seasonEnd = "2100/12/31";
  newerValue.data.anime.totalEpisode = 14;
  const newerBundle = parseMetadataResponse(newerValue, 49054, future);
  const storage = new MemoryStorage(metadataBundleCacheItems(newerBundle));
  const harness = createHarness({
    storage,
    now: () => now,
    fetcher: async () => new Response(JSON.stringify(apiValue()))
  });
  await harness.service.resolveEpisode(49054);
  const preserved = await readMetadataCache(storage, 49054, future);
  assert.equal(preserved.kind, "hit");
  if (preserved.kind === "hit") {
    assert.equal(preserved.bundle.anime.totalEpisode, 14);
    assert.equal(preserved.bundle.anime.isOngoing, true);
    assert.equal(preserved.bundle.anime.fetchedAt.getTime(), future.getTime());
  }
});
