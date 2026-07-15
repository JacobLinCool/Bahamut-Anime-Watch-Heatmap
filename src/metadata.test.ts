import assert from "node:assert/strict";
import { test } from "vitest";
import {
  collectEpisodeMetadata,
  parseVideoSn,
  type MetadataResolver
} from "./metadata";
import { MetadataUnavailableError } from "./metadata-schema";
import { MetadataServiceError } from "./metadata-service";
import type { MetadataBundle, MetadataState, WatchEntry } from "./model";

const BASE_URL = "https://ani.gamer.com.tw/viewList.php";

const watchEntry = (videoSn: number): WatchEntry => ({
  videoSn,
  dateKey: "2026-05-21",
  watchedAt: new Date("2026-05-21T18:00:00.000Z"),
  title: `動畫 ${videoSn}`,
  episode: "第 1 集"
});

const bundle = (
  videoSn: number,
  animeSn = 1001,
  fetchedAt = new Date("2026-07-14T00:00:00.000Z")
): MetadataBundle => ({
  episode: {
    videoSn,
    animeSn,
    groupKey: "0",
    episodeIndex: videoSn - 1,
    episodeNumber: videoSn,
    availableFrom: new Date("2026-05-20T17:00:00.000Z"),
    availableUntil: null,
    durationMinutes: 23,
    coverUrl: `https://p2.bahamut.com.tw/${videoSn}.JPG`,
    videoType: 0,
    fetchedAt: new Date(fetchedAt.getTime())
  },
  anime: {
    animeSn,
    apiTitle: `API 動畫 ${animeSn}`,
    totalEpisode: 13,
    seasonStartDateKey: "2026-04-01",
    seasonEndDateKey: "2026-06-30",
    coverUrl: `https://p2.bahamut.com.tw/anime-${animeSn}.JPG`,
    tags: ["動畫"],
    maker: "Studio",
    director: "Director",
    publisher: "Publisher",
    episodeRefs: [{
      videoSn,
      episodeNumber: videoSn,
      groupKey: "0",
      coverUrl: null
    }],
    platformSnapshot: {
      score: 4.5,
      reviewCount: 100,
      popular: 1000,
      observedAt: new Date(fetchedAt.getTime())
    },
    fetchedAt: new Date(fetchedAt.getTime())
  }
});

type CatalogRef = {
  readonly videoSn: number;
  readonly episodeNumber: number;
  readonly groupKey: string;
};

const catalogBundle = (
  videoSn: number,
  animeSn: number,
  refs: readonly CatalogRef[],
  fetchedAt = new Date("2026-07-14T00:00:00.000Z")
): MetadataBundle => {
  const matching = refs.find((reference) => reference.videoSn === videoSn);
  if (!matching) throw new Error(`test catalog missing videoSn ${videoSn}`);
  const value = bundle(videoSn, animeSn, fetchedAt);
  return {
    episode: {
      ...value.episode,
      groupKey: matching.groupKey,
      episodeIndex: matching.episodeNumber - 1,
      episodeNumber: matching.episodeNumber
    },
    anime: {
      ...value.anime,
      episodeRefs: refs.map((reference) => ({ ...reference, coverUrl: null }))
    }
  };
};

const ref = (videoSn: number, episodeNumber = videoSn, groupKey = "0"): CatalogRef => ({
  videoSn,
  episodeNumber,
  groupKey
});

test("parseVideoSn accepts only the exact Anime Gamer episode endpoint", () => {
  assert.equal(parseVideoSn("/animeVideo.php?sn=49054", BASE_URL), 49054);
  assert.equal(parseVideoSn("https://ani.gamer.com.tw/animeVideo.php?sn=1", BASE_URL), 1);
  for (const href of [
    "http://ani.gamer.com.tw/animeVideo.php?sn=1",
    "https://example.com/animeVideo.php?sn=1",
    "https://ani.gamer.com.tw/AnimeVideo.php?sn=1",
    "https://ani.gamer.com.tw/animeVideo.php",
    "https://ani.gamer.com.tw/animeVideo.php?sn=1&sn=2",
    "https://ani.gamer.com.tw/animeVideo.php?sn=0",
    "https://ani.gamer.com.tw/animeVideo.php?sn=-1",
    "https://ani.gamer.com.tw/animeVideo.php?sn=1.5",
    `https://ani.gamer.com.tw/animeVideo.php?sn=${Number.MAX_SAFE_INTEGER + 1}`
  ]) {
    assert.throws(() => parseVideoSn(href, BASE_URL), href);
  }
});

test("collector deduplicates videoSn, limits concurrency, and emits isolated snapshots", async () => {
  let active = 0;
  let maximumActive = 0;
  const calls: number[] = [];
  const resolver: MetadataResolver = async (videoSn) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    calls.push(videoSn);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return bundle(videoSn, 1000 + videoSn);
  };
  const snapshots: MetadataState[] = [];
  const result = await collectEpisodeMetadata(
    [1, 2, 3, 4, 5, 6, 1].map(watchEntry),
    { resolver, concurrency: 4, onProgress: (state) => snapshots.push(state) }
  );

  assert.equal(maximumActive, 4);
  assert.deepEqual(calls.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  assert.equal(result.episodes.size, 6);
  assert.equal(result.anime.size, 6);
  assert.deepEqual(result.progress, {
    phase: "complete",
    total: 6,
    completed: 6,
    available: 6,
    unavailable: 0,
    failed: 0
  });
  assert.equal(snapshots[0]?.episodes.size, 0);
  assert.equal(snapshots.at(-1)?.episodes.size, 6);
  const snapshotEpisode = snapshots.at(-1)?.episodes.get(1);
  assert.notEqual(snapshotEpisode, result.episodes.get(1));
  assert.notEqual(snapshotEpisode?.availableFrom, result.episodes.get(1)?.availableFrom);
});

test("collector expands one watched seed to a fixed point within its observed playback group", async () => {
  const refs = [ref(101, 1), ref(102, 2), ref(103, 3)];
  const calls: number[] = [];
  const result = await collectEpisodeMetadata([watchEntry(101)], {
    resolver: async (videoSn) => {
      calls.push(videoSn);
      return catalogBundle(videoSn, 5001, refs);
    }
  });

  assert.deepEqual(calls.sort((left, right) => left - right), [101, 102, 103]);
  assert.deepEqual([...result.episodes.keys()].sort((left, right) => left - right), [101, 102, 103]);
  assert.deepEqual(result.progress, {
    phase: "complete",
    total: 3,
    completed: 3,
    available: 3,
    unavailable: 0,
    failed: 0
  });
});

test("collector never fetches an unstarted playback group from the same anime index", async () => {
  const refs = [
    ref(1, 1, "main"),
    ref(2, 2, "main"),
    ref(10, 1, "special"),
    ref(11, 2, "special")
  ];
  const calls: number[] = [];
  const result = await collectEpisodeMetadata([watchEntry(1)], {
    concurrency: 1,
    resolver: async (videoSn) => {
      calls.push(videoSn);
      return catalogBundle(videoSn, 5006, refs);
    }
  });

  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual([...result.episodes.keys()].sort((left, right) => left - right), [1, 2]);
  assert.equal(result.progress.total, 2);
  assert.equal(result.progress.completed, 2);
});

test("collector expands every observed playback group while keeping all watched seeds first", async () => {
  const refs = [
    ref(1, 1, "main"),
    ref(2, 2, "main"),
    ref(10, 1, "special"),
    ref(11, 2, "special")
  ];
  const calls: number[] = [];
  const result = await collectEpisodeMetadata([watchEntry(1), watchEntry(10)], {
    concurrency: 1,
    resolver: async (videoSn) => {
      calls.push(videoSn);
      return catalogBundle(videoSn, 5007, refs);
    }
  });

  assert.deepEqual(calls, [1, 10, 2, 11]);
  assert.deepEqual([...result.episodes.keys()].sort((left, right) => left - right), [1, 2, 10, 11]);
  assert.equal(result.progress.total, 4);
  assert.equal(result.progress.completed, 4);
});

test("collector globally deduplicates two watched seeds and keeps watched work ahead of discoveries", async () => {
  const refs = [ref(1), ref(2), ref(3)];
  const calls: number[] = [];
  const result = await collectEpisodeMetadata([watchEntry(1), watchEntry(2), watchEntry(1)], {
    concurrency: 1,
    resolver: async (videoSn) => {
      calls.push(videoSn);
      return catalogBundle(videoSn, 5002, refs);
    }
  });

  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(new Set(calls).size, 3);
  assert.equal(result.progress.total, 3);
  assert.equal(result.progress.completed, 3);
});

test("collector reaches a fixed point when a newer catalog grows during discovery", async () => {
  const firstRefs = [ref(1), ref(2)];
  const grownRefs = [...firstRefs, ref(3)];
  const firstFetchedAt = new Date("2026-07-14T00:00:00.000Z");
  const grownFetchedAt = new Date("2026-07-14T00:01:00.000Z");
  const calls: number[] = [];
  const result = await collectEpisodeMetadata([watchEntry(1)], {
    concurrency: 1,
    resolver: async (videoSn) => {
      calls.push(videoSn);
      return videoSn === 1
        ? catalogBundle(videoSn, 5003, firstRefs, firstFetchedAt)
        : catalogBundle(videoSn, 5003, grownRefs, grownFetchedAt);
    }
  });

  assert.deepEqual(calls, [1, 2, 3]);
  assert.deepEqual(result.progress, {
    phase: "complete",
    total: 3,
    completed: 3,
    available: 3,
    unavailable: 0,
    failed: 0
  });
  assert.deepEqual(
    result.anime.get(5003)?.episodeRefs.map((reference) => reference.videoSn),
    [1, 2, 3]
  );
});

test("collector quarantines a discovered response whose anime/group/episode identity mismatches", async () => {
  const expectedRefs = [ref(1, 1, "main"), ref(2, 2, "main")];
  const conflictingRefs = [ref(1, 1, "main"), ref(2, 2, "special")];
  const result = await collectEpisodeMetadata([watchEntry(1)], {
    concurrency: 1,
    resolver: async (videoSn) => videoSn === 1
      ? catalogBundle(videoSn, 5004, expectedRefs)
      : catalogBundle(
        videoSn,
        5004,
        conflictingRefs,
        new Date("2026-07-14T00:01:00.000Z")
      )
  });

  assert.equal(result.episodes.has(1), true);
  assert.equal(result.episodes.has(2), false);
  assert.equal(result.progress.available, 1);
  assert.equal(result.progress.failed, 1);
  assert.equal(result.issues.find((issue) => issue.videoSn === 2)?.kind, "invalid-response");
  assert.match(result.issues.find((issue) => issue.videoSn === 2)?.message ?? "", /identity 不一致/);
});

test("collector accepts duplicate episode numbers in different exact groups", async () => {
  const refs = [ref(1, 1, "main"), ref(2, 1, "special")];
  const result = await collectEpisodeMetadata([watchEntry(1), watchEntry(2)], {
    resolver: async (videoSn) => catalogBundle(videoSn, 5005, refs)
  });

  assert.equal(result.progress.failed, 0);
  assert.equal(result.episodes.get(1)?.groupKey, "main");
  assert.equal(result.episodes.get(2)?.groupKey, "special");
  assert.equal(result.episodes.get(1)?.episodeNumber, 1);
  assert.equal(result.episodes.get(2)?.episodeNumber, 1);
});

test("collector quarantines contradictory identities discovered by separate seeds without fetching them", async () => {
  const firstCatalog = [ref(1, 1), ref(3, 3)];
  const secondCatalog = [ref(2, 1), ref(3, 3)];
  const calls: number[] = [];
  const result = await collectEpisodeMetadata([watchEntry(1), watchEntry(2)], {
    concurrency: 1,
    resolver: async (videoSn) => {
      calls.push(videoSn);
      if (videoSn === 1) return catalogBundle(videoSn, 5100, firstCatalog);
      if (videoSn === 2) return catalogBundle(videoSn, 5200, secondCatalog);
      throw new Error("quarantined discovery must not be fetched");
    }
  });

  assert.deepEqual(calls, [1, 2]);
  assert.equal(result.progress.total, 3);
  assert.equal(result.progress.completed, 3);
  assert.equal(result.progress.available, 2);
  assert.equal(result.progress.failed, 1);
  assert.equal(result.episodes.has(3), false);
  assert.match(result.issues.find((issue) => issue.videoSn === 3)?.message ?? "", /衝突 identity/);
});

test("collector isolates unavailable and typed resolution failures", async () => {
  const resolver: MetadataResolver = async (videoSn) => {
    if (videoSn === 1) throw new MetadataUnavailableError(videoSn);
    if (videoSn === 2) throw new MetadataServiceError("http", videoSn, "HTTP 503");
    if (videoSn === 3) throw new MetadataServiceError("cache-invalidated", videoSn, "cleared");
    return bundle(videoSn);
  };
  const result = await collectEpisodeMetadata([1, 2, 3, 4].map(watchEntry), { resolver });
  assert.equal(result.episodes.size, 1);
  assert.deepEqual(result.progress, {
    phase: "complete",
    total: 4,
    completed: 4,
    available: 1,
    unavailable: 1,
    failed: 2
  });
  assert.ok(result.issues.some((issue) => issue.videoSn === 1 && issue.kind === "unavailable"));
  assert.ok(result.issues.some((issue) => issue.videoSn === 2 && issue.kind === "http"));
  assert.ok(result.issues.some((issue) => issue.videoSn === 3 && issue.kind === "invalid-cache"));
});

test("collector rejects resolver identity and schema violations", async () => {
  const wrongIdentity: MetadataResolver = async (videoSn) => bundle(videoSn + 1);
  const first = await collectEpisodeMetadata([watchEntry(1)], { resolver: wrongIdentity });
  assert.equal(first.episodes.size, 0);
  assert.equal(first.progress.failed, 1);
  assert.equal(first.issues[0]?.kind, "invalid-response");

  const insecureCover: MetadataResolver = async (videoSn) => {
    const value = bundle(videoSn);
    return { ...value, episode: { ...value.episode, coverUrl: "http://example.com/x.jpg" } };
  };
  const second = await collectEpisodeMetadata([watchEntry(1)], { resolver: insecureCover });
  assert.equal(second.episodes.size, 0);
  assert.equal(second.progress.failed, 1);
});

test("collector chooses the newest anime snapshot independent of completion order", async () => {
  const older = new Date("2026-07-14T00:00:00.000Z");
  const newer = new Date("2026-07-14T01:00:00.000Z");
  const resolver: MetadataResolver = async (videoSn) => {
    return bundle(videoSn, 10, videoSn === 1 ? newer : older);
  };
  const result = await collectEpisodeMetadata([watchEntry(1), watchEntry(2)], { resolver });
  assert.equal(result.anime.get(10)?.fetchedAt.toISOString(), newer.toISOString());
  assert.equal(result.progress.available, 2);
});

test("collector accepts episode-specific raw API titles for the same anime snapshot", async () => {
  const resolver: MetadataResolver = async (videoSn) => {
    const value = bundle(videoSn, 10);
    return {
      ...value,
      anime: {
        ...value.anime,
        apiTitle: `conflict-${videoSn}`,
        // The real endpoint repeats the same complete episode index for every
        // video in an anime; isolate apiTitle as the only differing raw field.
        episodeRefs: [
          { videoSn: 1, episodeNumber: 1, groupKey: "0", coverUrl: null },
          { videoSn: 2, episodeNumber: 2, groupKey: "0", coverUrl: null }
        ]
      }
    };
  };
  const result = await collectEpisodeMetadata([watchEntry(1), watchEntry(2)], {
    resolver,
    concurrency: 1
  });
  assert.equal(result.episodes.size, 2);
  assert.equal(result.progress.available, 2);
  assert.equal(result.progress.failed, 0);
});

test("collector rejects equal-timestamp conflicts in canonical anime facts", async () => {
  const resolver: MetadataResolver = async (videoSn) => {
    const value = bundle(videoSn, 10);
    return {
      ...value,
      anime: {
        ...value.anime,
        totalEpisode: videoSn === 1 ? 13 : 14
      }
    };
  };
  const result = await collectEpisodeMetadata([watchEntry(1), watchEntry(2)], {
    resolver,
    concurrency: 1
  });
  assert.equal(result.episodes.size, 1);
  assert.equal(result.progress.available, 1);
  assert.equal(result.progress.failed, 1);
  assert.match(result.issues[0]?.message ?? "", /不一致 metadata/);
});

test("collector stops dispatching after abort and resolves with aborted progress", async () => {
  const controller = new AbortController();
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  let callCount = 0;
  const resolver: MetadataResolver = async (_videoSn, signal) => {
    callCount += 1;
    markStarted?.();
    return new Promise((_resolve, reject) => {
      signal?.addEventListener(
        "abort",
        () => reject(signal.reason ?? new DOMException("aborted", "AbortError")),
        { once: true }
      );
    });
  };
  const collecting = collectEpisodeMetadata([1, 2, 3].map(watchEntry), {
    resolver,
    signal: controller.signal,
    concurrency: 1
  });
  await started;
  controller.abort(new DOMException("aborted", "AbortError"));
  const result = await collecting;
  assert.equal(callCount, 1);
  assert.equal(result.progress.phase, "aborted");
  assert.equal(result.progress.completed, 0);
  assert.equal(result.issues.length, 0);
});

test("collector aborts strictly after catalog growth even when the active resolver ignores its signal", async () => {
  const refs = [ref(1), ref(2), ref(3)];
  const controller = new AbortController();
  let markSecondStarted: (() => void) | undefined;
  const secondStarted = new Promise<void>((resolve) => { markSecondStarted = resolve; });
  const calls: number[] = [];
  const collecting = collectEpisodeMetadata([watchEntry(1)], {
    concurrency: 1,
    signal: controller.signal,
    resolver: async (videoSn) => {
      calls.push(videoSn);
      if (videoSn === 1) return catalogBundle(videoSn, 5300, refs);
      markSecondStarted?.();
      return new Promise<MetadataBundle>(() => undefined);
    }
  });

  await secondStarted;
  controller.abort(new DOMException("aborted", "AbortError"));
  const result = await collecting;
  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(result.progress, {
    phase: "aborted",
    total: 3,
    completed: 1,
    available: 1,
    unavailable: 0,
    failed: 0
  });
  assert.equal(result.issues.length, 0);
});

test("collector treats every discovered unavailable or failed request as terminal", async () => {
  const refs = [ref(1), ref(2), ref(3), ref(4)];
  const calls = new Map<number, number>();
  const result = await collectEpisodeMetadata([watchEntry(1)], {
    resolver: async (videoSn) => {
      calls.set(videoSn, (calls.get(videoSn) ?? 0) + 1);
      if (videoSn === 1) return catalogBundle(videoSn, 5400, refs);
      if (videoSn === 2) throw new MetadataUnavailableError(videoSn);
      if (videoSn === 3) throw new MetadataServiceError("http", videoSn, "HTTP 503");
      throw new TypeError("network down");
    }
  });

  assert.deepEqual([...calls.entries()].sort(([left], [right]) => left - right), [
    [1, 1], [2, 1], [3, 1], [4, 1]
  ]);
  assert.deepEqual(result.progress, {
    phase: "complete",
    total: 4,
    completed: 4,
    available: 1,
    unavailable: 1,
    failed: 2
  });
});
