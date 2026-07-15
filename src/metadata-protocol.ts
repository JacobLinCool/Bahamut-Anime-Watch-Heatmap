import { MetadataUnavailableError } from "./metadata-schema";
import { MetadataServiceError, type MetadataServiceErrorKind } from "./metadata-service";

export const METADATA_RUNTIME_MESSAGE = {
  resolveEpisode: "ani-gamer-heatmap:metadata:resolve-episode",
  clearCache: "ani-gamer-heatmap:metadata:clear-cache",
  exportDebugSnapshot: "ani-gamer-heatmap:metadata:export-debug-snapshot"
} as const;

export type MetadataRuntimeRequest =
  | {
      readonly type: typeof METADATA_RUNTIME_MESSAGE.resolveEpisode;
      readonly videoSn: number;
    }
  | { readonly type: typeof METADATA_RUNTIME_MESSAGE.clearCache }
  | { readonly type: typeof METADATA_RUNTIME_MESSAGE.exportDebugSnapshot };

export type MetadataRuntimeErrorKind = MetadataServiceErrorKind | "unavailable" | "internal";

export type MetadataRuntimeErrorPayload = {
  readonly kind: MetadataRuntimeErrorKind;
  readonly message: string;
  readonly videoSn: number | null;
};

export type MetadataRuntimeResponse =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: MetadataRuntimeErrorPayload };

export class MetadataRuntimeError extends Error {
  readonly kind: Exclude<MetadataRuntimeErrorKind, "unavailable">;
  readonly videoSn: number | null;

  constructor(
    kind: Exclude<MetadataRuntimeErrorKind, "unavailable">,
    message: string,
    videoSn: number | null
  ) {
    super(message);
    this.name = "MetadataRuntimeError";
    this.kind = kind;
    this.videoSn = videoSn;
  }
}

export const isMetadataRuntimeRequest = (value: unknown): value is MetadataRuntimeRequest => {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (
    value.type === METADATA_RUNTIME_MESSAGE.clearCache
    || value.type === METADATA_RUNTIME_MESSAGE.exportDebugSnapshot
  ) {
    return hasExactKeys(value, ["type"]);
  }
  return value.type === METADATA_RUNTIME_MESSAGE.resolveEpisode
    && hasExactKeys(value, ["type", "videoSn"])
    && typeof value.videoSn === "number"
    && Number.isSafeInteger(value.videoSn)
    && value.videoSn > 0;
};

export const metadataRuntimeSuccess = (value: unknown): MetadataRuntimeResponse => ({
  ok: true,
  value
});

export const metadataRuntimeFailure = (error: unknown): MetadataRuntimeResponse => {
  if (error instanceof MetadataUnavailableError) {
    return {
      ok: false,
      error: { kind: "unavailable", message: error.message, videoSn: error.videoSn }
    };
  }
  if (error instanceof MetadataServiceError) {
    return {
      ok: false,
      error: { kind: error.kind, message: error.message, videoSn: error.videoSn }
    };
  }
  if (error instanceof MetadataRuntimeError) {
    return {
      ok: false,
      error: { kind: error.kind, message: error.message, videoSn: error.videoSn }
    };
  }
  return {
    ok: false,
    error: {
      kind: "internal",
      message: error instanceof Error ? error.message : String(error),
      videoSn: null
    }
  };
};

export const unwrapMetadataRuntimeResponse = (value: unknown): unknown => {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    throw new Error("metadata service worker 回應格式無效");
  }
  if (value.ok) {
    if (!hasExactKeys(value, ["ok", "value"])) {
      throw new Error("metadata service worker 成功回應格式無效");
    }
    return value.value;
  }
  if (!hasExactKeys(value, ["error", "ok"])) {
    throw new Error("metadata service worker 失敗回應格式無效");
  }
  const payload = parseRuntimeErrorPayload(value.error);
  if (payload.kind === "unavailable") {
    if (payload.videoSn === null) {
      throw new Error("metadata unavailable error 缺少 videoSn");
    }
    throw new MetadataUnavailableError(payload.videoSn, payload.message);
  }
  throw new MetadataRuntimeError(payload.kind, payload.message, payload.videoSn);
};

const parseRuntimeErrorPayload = (value: unknown): MetadataRuntimeErrorPayload => {
  if (!isRecord(value) || !hasExactKeys(value, ["kind", "message", "videoSn"])) {
    throw new Error("metadata service worker error payload 格式無效");
  }
  if (!isRuntimeErrorKind(value.kind)) {
    throw new Error("metadata service worker error kind 無效");
  }
  if (typeof value.message !== "string" || value.message.length < 1 || value.message.length > 4_096) {
    throw new Error("metadata service worker error message 無效");
  }
  if (
    value.videoSn !== null
    && (typeof value.videoSn !== "number" || !Number.isSafeInteger(value.videoSn) || value.videoSn <= 0)
  ) {
    throw new Error("metadata service worker error videoSn 無效");
  }
  return {
    kind: value.kind,
    message: value.message,
    videoSn: value.videoSn
  };
};

const isRuntimeErrorKind = (value: unknown): value is MetadataRuntimeErrorKind => [
  "cache-invalidated",
  "http",
  "internal",
  "invalid-cache",
  "invalid-response",
  "network",
  "unavailable"
].includes(typeof value === "string" ? value : "");

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
};
