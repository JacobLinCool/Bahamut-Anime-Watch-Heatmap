import assert from "node:assert/strict";
import { test } from "vitest";
import {
  UNAVAILABLE_CACHE_TTL_MILLISECONDS,
  clearMetadataCache,
  episodeMetadataCacheKey,
  metadataBundleCacheItems,
  readMetadataCache,
  unavailableMetadataCacheKey,
  type MetadataCacheStorage
} from "./metadata-cache";
import { MetadataCoordinator, type MetadataCoordinatorBackend } from "./metadata-coordinator";
import { MetadataUnavailableError, parseMetadataResponse } from "./metadata-schema";
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
  assert.equal((await readMetadataCache(harness.storage, 49054)).kind, "hit");
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

  clock = new Date(clock.getTime() + UNAVAILABLE_CACHE_TTL_MILLISECONDS - 1);
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
