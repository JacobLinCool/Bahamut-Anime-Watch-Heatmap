import {
  createInvalidMetadata,
  createUnavailableMetadata,
  episodeMetadataCacheKey,
  invalidMetadataCacheKey,
  metadataBundleCacheItems,
  readMetadataCache,
  unavailableMetadataCacheKey,
  type MetadataCacheStorage,
  type UnavailableMetadata
} from "./metadata-cache";
import { MetadataCoordinator } from "./metadata-coordinator";
import {
  MetadataSchemaError,
  MetadataUnavailableError,
  cloneMetadataBundle,
  parseMetadataResponse
} from "./metadata-schema";
import type { MetadataBundle, MetadataIssueKind } from "./model";

export const METADATA_API_URL = "https://api.gamer.com.tw/anime/v1/video.php";

export type MetadataHttpResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
};

export type MetadataFetcher = (url: string, init: RequestInit) => Promise<MetadataHttpResponse>;

export type MetadataServiceErrorKind = Exclude<MetadataIssueKind, "unavailable"> | "cache-invalidated";

export class MetadataServiceError extends Error {
  readonly kind: MetadataServiceErrorKind;
  readonly videoSn: number;

  constructor(kind: MetadataServiceErrorKind, videoSn: number, message: string) {
    super(message);
    this.name = "MetadataServiceError";
    this.kind = kind;
    this.videoSn = videoSn;
  }
}

export type MetadataServiceOptions = {
  readonly coordinator: MetadataCoordinator;
  readonly storage: MetadataCacheStorage;
  readonly fetcher?: MetadataFetcher;
  readonly now?: () => Date;
};

export class MetadataService {
  readonly #coordinator: MetadataCoordinator;
  readonly #storage: MetadataCacheStorage;
  readonly #fetcher: MetadataFetcher;
  readonly #now: () => Date;
  readonly #inFlightByEpochAndVideoSn = new Map<string, Promise<MetadataBundle>>();

  constructor(options: MetadataServiceOptions) {
    this.#coordinator = options.coordinator;
    this.#storage = options.storage;
    this.#fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    this.#now = options.now ?? (() => new Date());
  }

  async resolveEpisode(videoSn: number): Promise<MetadataBundle> {
    assertPositiveSafeInteger(videoSn, "videoSn");
    const epoch = await this.#coordinator.getEpoch();
    const inFlightKey = `${epoch}:${videoSn}`;
    const existing = this.#inFlightByEpochAndVideoSn.get(inFlightKey);
    if (existing) return cloneMetadataBundle(await existing);

    const task = this.#resolveForEpoch(videoSn, epoch);
    this.#inFlightByEpochAndVideoSn.set(inFlightKey, task);
    void task.finally(() => {
      if (this.#inFlightByEpochAndVideoSn.get(inFlightKey) === task) {
        this.#inFlightByEpochAndVideoSn.delete(inFlightKey);
      }
    }).catch(() => undefined);
    return cloneMetadataBundle(await task);
  }

  clearCache(): Promise<number> {
    return this.#coordinator.clearCache();
  }

  async #resolveForEpoch(videoSn: number, epoch: string): Promise<MetadataBundle> {
    const lookupAt = validatedNow(this.#now);
    let cacheResult;
    try {
      cacheResult = await this.#coordinator.runCacheOperation(
        epoch,
        () => readMetadataCache(this.#storage, videoSn, lookupAt)
      );
    } catch (error) {
      throw new MetadataServiceError(
        "invalid-cache",
        videoSn,
        `無法讀取 metadata cache：${errorMessage(error)}`
      );
    }
    if (!cacheResult.accepted) throw cacheInvalidated(videoSn);

    const lookup = cacheResult.value;
    if (lookup.kind === "hit") return lookup.bundle;
    if (lookup.kind === "unavailable") throw new MetadataUnavailableError(videoSn);
    if (lookup.kind === "invalid-response") {
      throw new MetadataServiceError("invalid-response", videoSn, lookup.record.message);
    }

    const endpoint = new URL(METADATA_API_URL);
    endpoint.searchParams.set("videoSn", String(videoSn));
    let response: MetadataHttpResponse;
    try {
      response = await this.#coordinator.startRequest(() => this.#fetcher(endpoint.toString(), {
        method: "GET",
        credentials: "omit",
        headers: { Accept: "application/json" }
      }));
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new MetadataServiceError(
        "network",
        videoSn,
        `取得 metadata 失敗：${errorMessage(error)}`
      );
    }
    if (
      typeof response.ok !== "boolean"
      || !Number.isSafeInteger(response.status)
      || response.status < 100
      || response.status > 599
      || typeof response.json !== "function"
    ) {
      throw new MetadataServiceError("invalid-response", videoSn, "metadata HTTP response 格式無效");
    }
    if (!response.ok) {
      throw new MetadataServiceError("http", videoSn, `取得 metadata 失敗：HTTP ${response.status}`);
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      throw new MetadataServiceError(
        "invalid-response",
        videoSn,
        `metadata API 並未回傳有效 JSON：${errorMessage(error)}`
      );
    }

    const fetchedAt = validatedNow(this.#now);
    let bundle: MetadataBundle;
    try {
      bundle = parseMetadataResponse(value, videoSn, fetchedAt);
    } catch (error) {
      if (error instanceof MetadataUnavailableError) {
        await this.#persistUnavailable(epoch, videoSn, fetchedAt, lookup.previousUnavailable);
        throw error;
      }
      const message = `metadata API response 格式無效：${errorMessage(error)}`;
      // Only a well-formed data payload that fails the schema is deterministic
      // enough to cache; envelope and unknown error responses may be transient.
      if (error instanceof MetadataSchemaError) {
        await this.#persistInvalid(epoch, videoSn, fetchedAt, message);
      }
      throw new MetadataServiceError("invalid-response", videoSn, message);
    }

    await this.#persistBundle(epoch, bundle);
    return bundle;
  }

  async #persistBundle(epoch: string, bundle: MetadataBundle): Promise<void> {
    const videoSn = bundle.episode.videoSn;
    try {
      const result = await this.#coordinator.runCacheOperation(epoch, async () => {
        await this.#storage.set(metadataBundleCacheItems(bundle));
        await this.#storage.remove([
          unavailableMetadataCacheKey(videoSn),
          invalidMetadataCacheKey(videoSn)
        ]);
      });
      if (!result.accepted) throw cacheInvalidated(videoSn);
    } catch (error) {
      if (error instanceof MetadataServiceError) throw error;
      throw new MetadataServiceError(
        "invalid-cache",
        videoSn,
        `無法保存 metadata cache：${errorMessage(error)}`
      );
    }
  }

  async #persistUnavailable(
    epoch: string,
    videoSn: number,
    observedAt: Date,
    previous: UnavailableMetadata | null
  ): Promise<void> {
    await this.#persistNegative(epoch, videoSn, "unavailable", {
      [unavailableMetadataCacheKey(videoSn)]: createUnavailableMetadata(videoSn, observedAt, previous)
    }, [invalidMetadataCacheKey(videoSn)]);
  }

  async #persistInvalid(epoch: string, videoSn: number, observedAt: Date, message: string): Promise<void> {
    await this.#persistNegative(epoch, videoSn, "invalid-response", {
      [invalidMetadataCacheKey(videoSn)]: createInvalidMetadata(videoSn, message, observedAt)
    }, [unavailableMetadataCacheKey(videoSn)]);
  }

  /**
   * Keeps at most one negative record per videoSn and drops a stale episode
   * record, which would otherwise shadow the negative answer and refetch forever.
   */
  async #persistNegative(
    epoch: string,
    videoSn: number,
    label: string,
    items: Record<string, unknown>,
    supersededKeys: readonly string[]
  ): Promise<void> {
    try {
      const result = await this.#coordinator.runCacheOperation(epoch, async () => {
        await this.#storage.set(items);
        await this.#storage.remove([episodeMetadataCacheKey(videoSn), ...supersededKeys]);
      });
      if (!result.accepted) throw cacheInvalidated(videoSn);
    } catch (error) {
      if (error instanceof MetadataServiceError) throw error;
      throw new MetadataServiceError(
        "invalid-cache",
        videoSn,
        `無法保存 ${label} metadata cache：${errorMessage(error)}`
      );
    }
  }
}

const cacheInvalidated = (videoSn: number): MetadataServiceError => new MetadataServiceError(
  "cache-invalidated",
  videoSn,
  "metadata cache 已在請求期間被清除"
);

const validatedNow = (now: () => Date): Date => {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("metadata service now() 必須是有效 Date");
  }
  return new Date(value.getTime());
};

const assertPositiveSafeInteger = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} 必須是正安全整數`);
  }
};

const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
