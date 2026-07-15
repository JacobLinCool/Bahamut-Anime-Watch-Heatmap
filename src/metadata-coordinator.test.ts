import assert from "node:assert/strict";
import { test } from "vitest";
import {
  MAX_METADATA_REQUESTS_PER_SECOND,
  MetadataCoordinator,
  type MetadataCoordinatorBackend
} from "./metadata-coordinator";

type BackendState = {
  epoch?: string;
  starts: number[];
  clearCount: number;
  events: string[];
};

const createBackend = (state: BackendState): MetadataCoordinatorBackend => ({
  readEpoch: async () => state.epoch,
  writeEpoch: async (epoch) => {
    state.events.push(`epoch:${epoch}`);
    state.epoch = epoch;
  },
  clearCache: async () => {
    state.events.push("clear");
    return state.clearCount;
  },
  readRequestStarts: async () => [...state.starts],
  writeRequestStarts: async (timestamps) => {
    state.events.push(`starts:${timestamps.join(",")}`);
    state.starts = [...timestamps];
  }
});

test("cache operations serialize with clear and reject stale epochs", async () => {
  const state: BackendState = { epoch: "epoch-1", starts: [], clearCount: 7, events: [] };
  let releaseWrite: (() => void) | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const coordinator = new MetadataCoordinator({
    backend: createBackend(state),
    createEpoch: () => "epoch-2"
  });
  const accepted = coordinator.runCacheOperation("epoch-1", async () => {
    state.events.push("write:start");
    markStarted?.();
    await new Promise<void>((resolve) => { releaseWrite = resolve; });
    state.events.push("write:end");
    return "value";
  });
  await started;
  const clear = coordinator.clearCache();
  const stale = coordinator.runCacheOperation("epoch-1", async () => "must-not-run");

  releaseWrite?.();
  assert.deepEqual(await accepted, { accepted: true, value: "value" });
  assert.equal(await clear, 7);
  assert.deepEqual(await stale, { accepted: false });
  assert.equal(await coordinator.getEpoch(), "epoch-2");
  assert.deepEqual(state.events, [
    "write:start",
    "write:end",
    "epoch:epoch-2",
    "clear"
  ]);
});

test("clear serializes behind lazy epoch initialization", async () => {
  let persistedEpoch: string | undefined;
  let releaseRead: (() => void) | undefined;
  let markReadStarted: (() => void) | undefined;
  let epochIndex = 0;
  const writes: string[] = [];
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
  const coordinator = new MetadataCoordinator({
    backend: {
      readEpoch: async () => {
        markReadStarted?.();
        await new Promise<void>((resolve) => { releaseRead = resolve; });
        return persistedEpoch;
      },
      writeEpoch: async (value) => {
        writes.push(value);
        persistedEpoch = value;
      },
      clearCache: async () => 0,
      readRequestStarts: async () => [],
      writeRequestStarts: async () => undefined
    },
    createEpoch: () => `epoch-${++epochIndex}`
  });

  const initialEpoch = coordinator.getEpoch();
  await readStarted;
  const clear = coordinator.clearCache();
  await Promise.resolve();
  assert.deepEqual(writes, []);
  releaseRead?.();

  assert.equal(await initialEpoch, "epoch-1");
  assert.equal(await clear, 0);
  assert.equal(await coordinator.getEpoch(), "epoch-2");
  assert.deepEqual(writes, ["epoch-1", "epoch-2"]);
});

test("persistent request timestamps enforce one rolling budget across worker restart", async () => {
  let time = 0;
  const starts: number[] = [];
  const state: BackendState = { epoch: "epoch", starts: [], clearCount: 0, events: [] };
  const options = {
    backend: createBackend(state),
    requestClock: {
      now: () => time,
      sleep: async (milliseconds: number) => { time += milliseconds; }
    }
  };
  const firstWorker = new MetadataCoordinator(options);
  await Promise.all(Array.from({ length: MAX_METADATA_REQUESTS_PER_SECOND }, () =>
    firstWorker.startRequest(() => { starts.push(time); })
  ));
  assert.deepEqual(state.starts, Array(MAX_METADATA_REQUESTS_PER_SECOND).fill(0));

  const restartedWorker = new MetadataCoordinator(options);
  await Promise.all(Array.from({ length: 3 }, () =>
    restartedWorker.startRequest(() => { starts.push(time); })
  ));
  assert.deepEqual(starts, [
    ...Array(MAX_METADATA_REQUESTS_PER_SECOND).fill(0),
    1000,
    1000,
    1000
  ]);
  assert.deepEqual(state.starts, [1000, 1000, 1000]);
});

test("request grant is persisted before operation and response completion is not serialized", async () => {
  const events: string[] = [];
  let persisted: number[] = [];
  let finishFirst: (() => void) | undefined;
  const coordinator = new MetadataCoordinator({
    backend: {
      readEpoch: async () => "epoch",
      writeEpoch: async () => undefined,
      clearCache: async () => 0,
      readRequestStarts: async () => [...persisted],
      writeRequestStarts: async (timestamps) => {
        persisted = [...timestamps];
        events.push(`persist:${timestamps.length}`);
      }
    },
    requestClock: {
      now: () => 100,
      sleep: async () => { throw new Error("must not sleep"); }
    }
  });
  const first = coordinator.startRequest(() => {
    events.push("first:start");
    return new Promise<void>((resolve) => { finishFirst = resolve; });
  });
  const second = coordinator.startRequest(() => {
    events.push("second:start");
    return "done";
  });

  assert.equal(await second, "done");
  assert.deepEqual(events, ["persist:1", "first:start", "persist:2", "second:start"]);
  finishFirst?.();
  await first;
});

test("aborted queued request never starts and invalid persisted state fails closed", async () => {
  const state: BackendState = {
    epoch: "epoch",
    starts: Array(MAX_METADATA_REQUESTS_PER_SECOND).fill(0),
    clearCount: 0,
    events: []
  };
  const coordinator = new MetadataCoordinator({
    backend: createBackend(state),
    requestClock: {
      now: () => 0,
      sleep: (_milliseconds, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      })
    }
  });
  const controller = new AbortController();
  let started = false;
  const queued = coordinator.startRequest(() => { started = true; }, controller.signal);
  await Promise.resolve();
  controller.abort(new DOMException("aborted", "AbortError"));
  await assert.rejects(queued, (error) => error instanceof DOMException && error.name === "AbortError");
  assert.equal(started, false);
  assert.deepEqual(state.starts, Array(MAX_METADATA_REQUESTS_PER_SECOND).fill(0));

  state.starts = [2, 1];
  const invalid = new MetadataCoordinator({ backend: createBackend(state) });
  await assert.rejects(invalid.startRequest(() => undefined), /非遞減排序/);
});
