import assert from "node:assert/strict";
import { test } from "vitest";
import {
  METADATA_RUNTIME_MESSAGE,
  MetadataRuntimeError,
  isMetadataRuntimeRequest,
  metadataRuntimeFailure,
  metadataRuntimeSuccess,
  unwrapMetadataRuntimeResponse
} from "./metadata-protocol";
import { MetadataUnavailableError } from "./metadata-schema";
import { MetadataServiceError } from "./metadata-service";

test("runtime protocol accepts only the three exact metadata requests", () => {
  assert.equal(isMetadataRuntimeRequest({
    type: METADATA_RUNTIME_MESSAGE.resolveEpisode,
    videoSn: 49054
  }), true);
  assert.equal(isMetadataRuntimeRequest({ type: METADATA_RUNTIME_MESSAGE.clearCache }), true);
  assert.equal(isMetadataRuntimeRequest({
    type: METADATA_RUNTIME_MESSAGE.exportDebugSnapshot
  }), true);

  for (const request of [
    null,
    [],
    { type: METADATA_RUNTIME_MESSAGE.resolveEpisode },
    { type: METADATA_RUNTIME_MESSAGE.resolveEpisode, videoSn: 0 },
    { type: METADATA_RUNTIME_MESSAGE.resolveEpisode, videoSn: 1.5 },
    { type: METADATA_RUNTIME_MESSAGE.resolveEpisode, videoSn: 1, extra: true },
    { type: METADATA_RUNTIME_MESSAGE.clearCache, extra: true },
    { type: METADATA_RUNTIME_MESSAGE.exportDebugSnapshot, extra: true },
    { type: "ani-gamer-heatmap:metadata:fetch-episode", videoSn: 1 },
    { type: "ani-gamer-heatmap:metadata:write-cache", epoch: "x", items: {} },
    { type: "unknown" }
  ]) {
    assert.equal(isMetadataRuntimeRequest(request), false);
  }
});

test("runtime protocol unwraps exact successful responses", () => {
  const value = { episode: true };
  assert.deepEqual(unwrapMetadataRuntimeResponse(metadataRuntimeSuccess(value)), value);
  for (const response of [
    null,
    { ok: true },
    { ok: true, value, extra: true },
    { ok: false },
    { ok: false, error: "failed" }
  ]) {
    assert.throws(() => unwrapMetadataRuntimeResponse(response));
  }
});

test("runtime protocol preserves typed unavailable and service failures", () => {
  assert.throws(
    () => unwrapMetadataRuntimeResponse(metadataRuntimeFailure(new MetadataUnavailableError(20219))),
    (error) => error instanceof MetadataUnavailableError && error.videoSn === 20219
  );
  assert.throws(
    () => unwrapMetadataRuntimeResponse(metadataRuntimeFailure(
      new MetadataServiceError("http", 49054, "HTTP 503")
    )),
    (error) => error instanceof MetadataRuntimeError
      && error.kind === "http"
      && error.videoSn === 49054
  );
  assert.throws(
    () => unwrapMetadataRuntimeResponse(metadataRuntimeFailure(new Error("worker failed"))),
    (error) => error instanceof MetadataRuntimeError
      && error.kind === "internal"
      && error.videoSn === null
  );
});

test("runtime protocol rejects malformed error payloads", () => {
  for (const response of [
    { ok: false, error: { kind: "unknown", message: "x", videoSn: 1 } },
    { ok: false, error: { kind: "network", message: "", videoSn: 1 } },
    { ok: false, error: { kind: "network", message: "x", videoSn: 0 } },
    { ok: false, error: { kind: "network", message: "x", videoSn: null, extra: true } },
    { ok: false, error: { kind: "unavailable", message: "x", videoSn: null } },
    { ok: false, error: { kind: "network", message: "x" }, extra: true }
  ]) {
    assert.throws(() => unwrapMetadataRuntimeResponse(response));
  }
});
