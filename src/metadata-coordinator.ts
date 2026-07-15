export const MAX_METADATA_REQUESTS_PER_SECOND = 10;
const REQUEST_WINDOW_MILLISECONDS = 1_000;

export type MetadataCoordinatorBackend = {
  readonly readEpoch: () => Promise<string | undefined>;
  readonly writeEpoch: (epoch: string) => Promise<void>;
  readonly clearCache: () => Promise<number>;
  readonly readRequestStarts: () => Promise<unknown>;
  readonly writeRequestStarts: (timestamps: readonly number[]) => Promise<void>;
};

export type MetadataRequestClock = {
  readonly now: () => number;
  readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};

export type MetadataCoordinatorOptions = {
  readonly backend: MetadataCoordinatorBackend;
  readonly createEpoch?: () => string;
  readonly requestClock?: MetadataRequestClock;
};

export type MetadataCacheOperationResult<T> =
  | { readonly accepted: true; readonly value: T }
  | { readonly accepted: false };

const defaultRequestClock: MetadataRequestClock = {
  now: () => Date.now(),
  sleep: (milliseconds, signal) => abortableSleep(milliseconds, signal)
};

export class MetadataCoordinator {
  readonly #backend: MetadataCoordinatorBackend;
  readonly #createEpoch: () => string;
  readonly #requestClock: MetadataRequestClock;
  #epochTask: Promise<string> | undefined;
  #cacheOperationTail: Promise<unknown> = Promise.resolve();
  #requestStartTail: Promise<unknown> = Promise.resolve();

  constructor(options: MetadataCoordinatorOptions) {
    this.#backend = options.backend;
    this.#createEpoch = options.createEpoch ?? (() => crypto.randomUUID());
    this.#requestClock = options.requestClock ?? defaultRequestClock;
  }

  startRequest<T>(operation: () => T, signal?: AbortSignal): Promise<Awaited<T>> {
    const turn = this.#requestStartTail.then(async () => {
      throwIfAborted(signal);
      let timestamps = parsePersistedRequestStarts(await this.#backend.readRequestStarts());

      while (true) {
        throwIfAborted(signal);
        const now = readWallClock(this.#requestClock);
        timestamps = timestamps.filter((timestamp) => now - timestamp < REQUEST_WINDOW_MILLISECONDS);

        if (timestamps.length < MAX_METADATA_REQUESTS_PER_SECOND) {
          const next = [...timestamps, now].sort((left, right) => left - right);
          // Persisting the grant before invoking the operation preserves the budget
          // even when the MV3 service worker is restarted immediately afterwards.
          await this.#backend.writeRequestStarts(next);
          throwIfAborted(signal);
          return { result: operation() };
        }

        const oldest = timestamps[0];
        if (oldest === undefined) {
          throw new Error("metadata request throttle 狀態不一致");
        }
        const delay = oldest + REQUEST_WINDOW_MILLISECONDS - now;
        if (delay <= 0) {
          continue;
        }
        await this.#requestClock.sleep(delay, signal);
      }
    });
    this.#requestStartTail = turn.then(
      () => undefined,
      () => undefined
    );
    return turn.then(({ result }) => result) as Promise<Awaited<T>>;
  }

  getEpoch(): Promise<string> {
    if (this.#epochTask) return this.#epochTask;

    const task = (async (): Promise<string> => {
      const stored = await this.#backend.readEpoch();
      if (stored !== undefined) {
        assertEpoch(stored);
        return stored;
      }
      const created = this.#newEpoch();
      await this.#backend.writeEpoch(created);
      return created;
    })();
    this.#epochTask = task;
    void task.catch(() => {
      if (this.#epochTask === task) this.#epochTask = undefined;
    });
    return task;
  }

  runCacheOperation<T>(
    epoch: string,
    operation: () => Promise<T>
  ): Promise<MetadataCacheOperationResult<T>> {
    assertEpoch(epoch);
    return this.#withCacheLock(async () => {
      if (epoch !== await this.getEpoch()) {
        return { accepted: false };
      }
      return { accepted: true, value: await operation() };
    });
  }

  clearCache(): Promise<number> {
    return this.#withCacheLock(async () => {
      await this.getEpoch();
      const nextEpoch = this.#newEpoch();
      await this.#backend.writeEpoch(nextEpoch);
      this.#epochTask = Promise.resolve(nextEpoch);
      return this.#backend.clearCache();
    });
  }

  #newEpoch(): string {
    const value = this.#createEpoch();
    assertEpoch(value);
    return value;
  }

  #withCacheLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#cacheOperationTail.then(operation, operation);
    this.#cacheOperationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

const parsePersistedRequestStarts = (value: unknown): number[] => {
  if (!Array.isArray(value) || value.length > MAX_METADATA_REQUESTS_PER_SECOND) {
    throw new Error("metadata request timestamps 儲存格式無效");
  }
  const result = value.map((timestamp) => {
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp < 0) {
      throw new Error("metadata request timestamp 必須是有限非負數");
    }
    return timestamp;
  });
  for (let index = 1; index < result.length; index += 1) {
    const previous = result[index - 1];
    const current = result[index];
    if (previous === undefined || current === undefined || current < previous) {
      throw new Error("metadata request timestamps 必須是非遞減排序");
    }
  }
  return result;
};

const readWallClock = (clock: MetadataRequestClock): number => {
  const value = clock.now();
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("metadata request throttle clock 必須是有限非負數");
  }
  return value;
};

const assertEpoch = (value: string): void => {
  if (typeof value !== "string" || value.length < 1 || value.length > 128) {
    throw new Error("metadata cache epoch 必須是 1 到 128 字元的字串");
  }
};

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("aborted", "AbortError");
  }
};

const abortableSleep = (milliseconds: number, signal?: AbortSignal): Promise<void> => {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new Error("sleep milliseconds 必須是有限正數");
  }
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new DOMException("aborted", "AbortError"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
};
