import { metadataBundleToWire, parseMetadataBundleWire } from "./metadata-cache";
import { MAX_METADATA_REQUESTS_PER_SECOND } from "./metadata-coordinator";
import {
  MetadataUnavailableError,
  cloneAnimeMetadata,
  cloneEpisodeMetadata
} from "./metadata-schema";
import type {
  AnimeMetadata,
  EpisodeMetadata,
  EpisodeRef,
  MetadataBundle,
  MetadataIssue,
  MetadataIssueKind,
  MetadataProgress,
  MetadataState,
  WatchEntry
} from "./model";

export { MAX_METADATA_REQUESTS_PER_SECOND };
export { METADATA_API_URL } from "./metadata-service";
export { MetadataUnavailableError } from "./metadata-schema";

const ANIME_ORIGIN = "https://ani.gamer.com.tw";
const ANIME_VIDEO_PATH = "/animeVideo.php";
const MAX_CONCURRENCY = 4;

export type MetadataResolver = (
  videoSn: number,
  signal?: AbortSignal
) => Promise<MetadataBundle>;

export type CollectEpisodeMetadataOptions = {
  readonly resolver: MetadataResolver;
  readonly signal?: AbortSignal;
  readonly concurrency?: number;
  readonly onProgress?: (state: MetadataState) => void;
};

type CompletionKind = "available" | "unavailable" | "failed";
type ResolutionStatus = "queued" | "inflight" | CompletionKind;

type ExpectedEpisodeIdentity = {
  readonly animeSn: number;
  readonly groupKey: string;
  readonly episodeNumber: number;
};

type KnownCatalogGroup = {
  readonly animeSn: number;
  readonly groupKey: string;
  readonly references: EpisodeRef[];
  readonly referenceFingerprints: Set<string>;
  registeredCount: number;
};

export const parseVideoSn = (href: string, baseUrl: string): number => {
  let url: URL;
  try {
    url = new URL(href, baseUrl);
  } catch {
    throw new Error("觀看紀錄連結不是有效 URL");
  }
  if (
    url.origin !== ANIME_ORIGIN
    || url.pathname !== ANIME_VIDEO_PATH
    || url.username !== ""
    || url.password !== ""
  ) {
    throw new Error("觀看紀錄連結不是動畫瘋單集網址");
  }
  const values = url.searchParams.getAll("sn");
  if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0] ?? "")) {
    throw new Error("觀看紀錄連結必須包含恰一個正整數 sn");
  }
  const videoSn = Number(values[0]);
  if (!Number.isSafeInteger(videoSn)) {
    throw new Error("觀看紀錄 sn 超出安全整數範圍");
  }
  return videoSn;
};

export const collectEpisodeMetadata = async (
  entries: readonly WatchEntry[],
  options: CollectEpisodeMetadataOptions
): Promise<MetadataState> => {
  const concurrency = options.concurrency ?? MAX_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new Error(`concurrency 必須是 1 到 ${MAX_CONCURRENCY} 的整數`);
  }
  if (typeof options.resolver !== "function") {
    throw new Error("metadata resolver 必須是 function");
  }

  const watchedVideoSns = [...new Set(entries.map((entry) => {
    assertPositiveSafeInteger(entry.videoSn, "WatchEntry.videoSn");
    return entry.videoSn;
  }))];
  const watchedVideoSnSet = new Set(watchedVideoSns);
  const episodes = new Map<number, MetadataBundle["episode"]>();
  const anime = new Map<number, AnimeMetadata>();
  const issues: MetadataIssue[] = [];
  const highPriorityQueue = [...watchedVideoSns];
  const lowPriorityQueue: number[] = [];
  const scheduled = new Set(watchedVideoSns);
  const statuses = new Map<number, ResolutionStatus>(
    watchedVideoSns.map((videoSn) => [videoSn, "queued"])
  );
  const terminalKinds = new Map<number, CompletionKind>();
  const expectedIdentities = new Map<number, ExpectedEpisodeIdentity>();
  const quarantineMessages = new Map<number, string>();
  const observedCatalogGroups = new Set<string>();
  const knownCatalogGroups = new Map<string, KnownCatalogGroup>();
  let progress: MetadataProgress = {
    phase: "resolving",
    total: watchedVideoSns.length,
    completed: 0,
    available: 0,
    unavailable: 0,
    failed: 0
  };

  const snapshot = (): MetadataState => ({
    episodes: new Map(Array.from(episodes, ([videoSn, metadata]) => [
      videoSn,
      cloneEpisodeMetadata(metadata)
    ])),
    anime: new Map(Array.from(anime, ([animeSn, metadata]) => [
      animeSn,
      cloneAnimeMetadata(metadata)
    ])),
    issues: issues.map((issue) => ({ ...issue })),
    progress: { ...progress }
  });
  const emit = (): void => options.onProgress?.(snapshot());
  const completeOne = (videoSn: number, kind: CompletionKind): void => {
    if (terminalKinds.has(videoSn)) {
      throw new Error(`videoSn ${videoSn} 不可重複完成`);
    }
    terminalKinds.set(videoSn, kind);
    statuses.set(videoSn, kind);
    progress = {
      ...progress,
      completed: progress.completed + 1,
      [kind]: progress[kind] + 1
    };
    emit();
  };

  emit();
  if (options.signal?.aborted) {
    progress = { ...progress, phase: "aborted" };
    emit();
    return snapshot();
  }

  const quarantine = (videoSn: number, message: string): void => {
    if (quarantineMessages.has(videoSn)) return;
    quarantineMessages.set(videoSn, message);
    issues.push({ videoSn, kind: "invalid-response", message });
    episodes.delete(videoSn);

    const terminalKind = terminalKinds.get(videoSn);
    if (terminalKind !== undefined) {
      if (terminalKind !== "failed") {
        terminalKinds.set(videoSn, "failed");
        statuses.set(videoSn, "failed");
        progress = {
          ...progress,
          [terminalKind]: progress[terminalKind] - 1,
          failed: progress.failed + 1
        };
        emit();
      }
      return;
    }

    if (statuses.get(videoSn) === "queued") {
      completeOne(videoSn, "failed");
    }
  };

  const registerDiscoveredEpisode = (
    animeSn: number,
    reference: EpisodeRef
  ): void => {
    const expected: ExpectedEpisodeIdentity = {
      animeSn,
      groupKey: reference.groupKey,
      episodeNumber: reference.episodeNumber
    };

    if (!scheduled.has(reference.videoSn)) {
      scheduled.add(reference.videoSn);
      statuses.set(reference.videoSn, "queued");
      lowPriorityQueue.push(reference.videoSn);
      progress = { ...progress, total: progress.total + 1 };
      emit();
    }

    const existingExpected = expectedIdentities.get(reference.videoSn);
    if (existingExpected !== undefined && !sameIdentity(existingExpected, expected)) {
      quarantine(
        reference.videoSn,
        `videoSn ${reference.videoSn} 在作品索引中出現衝突 identity：`
        + `${identityLabel(existingExpected)} / ${identityLabel(expected)}`
      );
      return;
    }
    expectedIdentities.set(reference.videoSn, expected);

    const resolvedEpisode = episodes.get(reference.videoSn);
    if (resolvedEpisode !== undefined && !episodeMatchesIdentity(resolvedEpisode, expected)) {
      quarantine(
        reference.videoSn,
        `videoSn ${reference.videoSn} 已取得的 episode identity 與作品索引不一致：`
        + `預期 ${identityLabel(expected)}，實際 ${episodeIdentityLabel(resolvedEpisode)}`
      );
    }
  };

  const flushKnownCatalogGroup = (group: KnownCatalogGroup): void => {
    while (group.registeredCount < group.references.length) {
      const reference = group.references[group.registeredCount];
      if (!reference) {
        throw new Error("catalog group reference index 無效");
      }
      registerDiscoveredEpisode(group.animeSn, reference);
      group.registeredCount += 1;
    }
  };

  const rememberAnimeReferences = (metadata: AnimeMetadata): void => {
    const touchedGroups = new Set<string>();
    for (const reference of metadata.episodeRefs) {
      const key = catalogGroupKey(metadata.animeSn, reference.groupKey);
      let group = knownCatalogGroups.get(key);
      if (!group) {
        group = {
          animeSn: metadata.animeSn,
          groupKey: reference.groupKey,
          references: [],
          referenceFingerprints: new Set(),
          registeredCount: 0
        };
        knownCatalogGroups.set(key, group);
      }
      const fingerprint = catalogReferenceFingerprint(reference);
      if (!group.referenceFingerprints.has(fingerprint)) {
        group.referenceFingerprints.add(fingerprint);
        group.references.push({ ...reference });
      }
      touchedGroups.add(key);
    }

    for (const key of touchedGroups) {
      if (!observedCatalogGroups.has(key)) continue;
      const group = knownCatalogGroups.get(key);
      if (!group) throw new Error("observed catalog group 缺少 reference index");
      flushKnownCatalogGroup(group);
    }
  };

  const observeWatchedCatalogGroup = (episode: EpisodeMetadata): void => {
    const key = catalogGroupKey(episode.animeSn, episode.groupKey);
    observedCatalogGroups.add(key);
    const group = knownCatalogGroups.get(key);
    if (!group) {
      throw new Error("watched episode 的 catalog group 缺少 API reference");
    }
    flushKnownCatalogGroup(group);
  };

  const processVideoSn = async (videoSn: number): Promise<void> => {
    if (options.signal?.aborted) return;
    let rawBundle: MetadataBundle;
    try {
      rawBundle = await resolveWithAbort(options.resolver, videoSn, options.signal);
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) return;
      if (quarantineMessages.has(videoSn)) {
        completeOne(videoSn, "failed");
        return;
      }
      const issue = issueFromResolutionError(videoSn, error);
      issues.push(issue);
      completeOne(videoSn, issue.kind === "unavailable" ? "unavailable" : "failed");
      return;
    }
    if (options.signal?.aborted) return;

    let bundle: MetadataBundle;
    try {
      bundle = parseMetadataBundleWire(metadataBundleToWire(rawBundle));
      if (bundle.episode.videoSn !== videoSn) {
        throw new Error("resolver episode videoSn 與請求不一致");
      }
      const expected = expectedIdentities.get(videoSn);
      if (expected !== undefined && !episodeMatchesIdentity(bundle.episode, expected)) {
        throw new Error(
          `discovered episode identity 不一致：預期 ${identityLabel(expected)}，`
          + `實際 ${episodeIdentityLabel(bundle.episode)}`
        );
      }
    } catch (error) {
      issues.push({
        videoSn,
        kind: "invalid-response",
        message: `metadata resolver 回傳格式無效：${errorMessage(error)}`
      });
      completeOne(videoSn, "failed");
      return;
    }

    if (quarantineMessages.has(videoSn)) {
      completeOne(videoSn, "failed");
      return;
    }

    const existingAnime = anime.get(bundle.anime.animeSn);
    if (existingAnime) {
      const timeDifference = bundle.anime.fetchedAt.getTime() - existingAnime.fetchedAt.getTime();
      if (timeDifference > 0) {
        anime.set(bundle.anime.animeSn, cloneAnimeMetadata(bundle.anime));
      } else if (
        timeDifference === 0
        && animeFingerprint(bundle.anime) !== animeFingerprint(existingAnime)
      ) {
        issues.push({
          videoSn,
          kind: "invalid-response",
          message: "同一 animeSn 在相同 fetchedAt 出現不一致 metadata"
        });
        completeOne(videoSn, "failed");
        return;
      }
    } else {
      anime.set(bundle.anime.animeSn, cloneAnimeMetadata(bundle.anime));
    }

    rememberAnimeReferences(bundle.anime);
    if (watchedVideoSnSet.has(videoSn)) {
      observeWatchedCatalogGroup(bundle.episode);
    }
    if (quarantineMessages.has(videoSn)) {
      completeOne(videoSn, "failed");
      return;
    }
    episodes.set(videoSn, cloneEpisodeMetadata(bundle.episode));
    completeOne(videoSn, "available");
  };

  const takeNextQueuedVideoSn = (): number | undefined => {
    for (const queue of [highPriorityQueue, lowPriorityQueue]) {
      while (queue.length > 0) {
        const videoSn = queue.shift();
        if (videoSn !== undefined && statuses.get(videoSn) === "queued") return videoSn;
      }
    }
    return undefined;
  };

  await new Promise<void>((resolve) => {
    let active = 0;
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", pump);
      resolve();
    };
    const onTaskSettled = (videoSn: number, error?: unknown): void => {
      if (
        error !== undefined
        && !options.signal?.aborted
        && !terminalKinds.has(videoSn)
      ) {
        issues.push({
          videoSn,
          kind: "invalid-response",
          message: `metadata collector 內部處理失敗：${errorMessage(error)}`
        });
        completeOne(videoSn, "failed");
      }
      active -= 1;
      pump();
    };
    function pump(): void {
      if (settled) return;
      if (options.signal?.aborted) {
        if (active === 0) finish();
        return;
      }

      while (active < concurrency) {
        const videoSn = takeNextQueuedVideoSn();
        if (videoSn === undefined) break;
        statuses.set(videoSn, "inflight");
        active += 1;
        void processVideoSn(videoSn).then(
          () => onTaskSettled(videoSn),
          (error: unknown) => onTaskSettled(videoSn, error)
        );
      }
      if (active === 0) finish();
    }

    options.signal?.addEventListener("abort", pump, { once: true });
    pump();
  });
  if (!options.signal?.aborted && progress.completed !== progress.total) {
    throw new Error("metadata collector 在所有 catalog 項目 terminal 前不可完成");
  }
  progress = { ...progress, phase: options.signal?.aborted ? "aborted" : "complete" };
  emit();
  return snapshot();
};

const issueFromResolutionError = (videoSn: number, error: unknown): MetadataIssue => {
  if (error instanceof MetadataUnavailableError) {
    return { videoSn, kind: "unavailable", message: error.message };
  }
  const kind = readErrorKind(error);
  return {
    videoSn,
    kind,
    message: `取得 metadata 失敗：${errorMessage(error)}`
  };
};

const readErrorKind = (error: unknown): MetadataIssueKind => {
  if (typeof error !== "object" || error === null || !("kind" in error)) return "network";
  const kind = (error as { kind?: unknown }).kind;
  if (kind === "network" || kind === "http" || kind === "invalid-response" || kind === "invalid-cache") {
    return kind;
  }
  if (kind === "cache-invalidated") return "invalid-cache";
  return "network";
};

const animeFingerprint = (metadata: AnimeMetadata): string => JSON.stringify({
  animeSn: metadata.animeSn,
  // The endpoint's anime.title is episode-specific in observed responses
  // (for example, the same anime returns "作品 [1]" and "作品 [9]").
  // Preserve it as a raw fact, but never treat it as a canonical series field.
  totalEpisode: metadata.totalEpisode,
  seasonStartDateKey: metadata.seasonStartDateKey,
  seasonEndDateKey: metadata.seasonEndDateKey,
  coverUrl: metadata.coverUrl,
  tags: metadata.tags,
  maker: metadata.maker,
  director: metadata.director,
  publisher: metadata.publisher,
  episodeRefs: metadata.episodeRefs,
  platformSnapshot: {
    ...metadata.platformSnapshot,
    observedAt: metadata.platformSnapshot.observedAt.toISOString()
  },
  fetchedAt: metadata.fetchedAt.toISOString()
});

const assertPositiveSafeInteger = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} 必須是正安全整數`);
  }
};

const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";

const resolveWithAbort = async (
  resolver: MetadataResolver,
  videoSn: number,
  signal: AbortSignal | undefined
): Promise<MetadataBundle> => {
  if (signal === undefined) return resolver(videoSn);
  if (signal.aborted) throw signal.reason ?? new DOMException("aborted", "AbortError");

  return new Promise<MetadataBundle>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => {
      finish(() => reject(signal.reason ?? new DOMException("aborted", "AbortError")));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(() => resolver(videoSn, signal))
      .then(
        (bundle) => finish(() => resolve(bundle)),
        (error: unknown) => finish(() => reject(error))
      );
  });
};

const sameIdentity = (
  left: ExpectedEpisodeIdentity,
  right: ExpectedEpisodeIdentity
): boolean => left.animeSn === right.animeSn
  && left.groupKey === right.groupKey
  && left.episodeNumber === right.episodeNumber;

const episodeMatchesIdentity = (
  episode: EpisodeMetadata,
  expected: ExpectedEpisodeIdentity
): boolean => episode.animeSn === expected.animeSn
  && episode.groupKey === expected.groupKey
  && episode.episodeNumber === expected.episodeNumber;

const identityLabel = (identity: ExpectedEpisodeIdentity): string => {
  return `animeSn=${identity.animeSn}, groupKey=${JSON.stringify(identity.groupKey)}, `
    + `episodeNumber=${identity.episodeNumber}`;
};

const episodeIdentityLabel = (episode: EpisodeMetadata): string => identityLabel({
  animeSn: episode.animeSn,
  groupKey: episode.groupKey,
  episodeNumber: episode.episodeNumber
});

const catalogGroupKey = (animeSn: number, groupKey: string): string => JSON.stringify([animeSn, groupKey]);

const catalogReferenceFingerprint = (reference: EpisodeRef): string => {
  return JSON.stringify([reference.videoSn, reference.episodeNumber]);
};

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
