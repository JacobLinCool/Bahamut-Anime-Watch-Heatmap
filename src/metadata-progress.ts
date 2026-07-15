import { formatInteger } from "./analysis-format";
import { MAX_METADATA_REQUESTS_PER_SECOND } from "./metadata-coordinator";
import type { MetadataProgress } from "./model";

const SAMPLE_WINDOW_MILLISECONDS = 15_000;
const MIN_RATE_SAMPLE_MILLISECONDS = 1_000;

type CompletionSample = {
  readonly at: number;
  readonly completed: number;
};

export type MetadataProgressPresentation = {
  readonly completed: number;
  readonly total: number;
  readonly percent: number | null;
  readonly detail: string;
  readonly estimatedSecondsRemaining: number | null;
};

export class MetadataProgressEstimator {
  readonly #now: () => number;
  #samples: CompletionSample[] = [];

  constructor(now: () => number = () => performance.now()) {
    this.#now = now;
  }

  present(progress: MetadataProgress): MetadataProgressPresentation | null {
    assertProgress(progress);
    if (progress.phase !== "resolving") {
      this.reset();
      return null;
    }

    const at = this.#now();
    if (!Number.isFinite(at) || at < 0) {
      throw new Error("metadata ETA clock 必須是有限非負數");
    }
    this.#recordSample(progress.completed, at);

    if (progress.total === 0) {
      return {
        completed: 0,
        total: 0,
        percent: null,
        detail: "正在確認需要整理的作品…",
        estimatedSecondsRemaining: null
      };
    }

    const remaining = progress.total - progress.completed;
    const percent = Math.floor(progress.completed / progress.total * 100);
    const estimatedSecondsRemaining = remaining === 0
      ? 0
      : Math.ceil(remaining / this.#completionRatePerSecond());
    const eta = estimatedSecondsRemaining === 0
      ? "即將完成"
      : `${formatEstimatedTime(estimatedSecondsRemaining)}完成`;

    return {
      completed: progress.completed,
      total: progress.total,
      percent,
      detail: `${percent}% · ${formatInteger(progress.completed)} / ${formatInteger(progress.total)} · ${eta}`,
      estimatedSecondsRemaining
    };
  }

  reset(): void {
    this.#samples = [];
  }

  #recordSample(completed: number, at: number): void {
    const last = this.#samples.at(-1);
    if (last && (completed < last.completed || at < last.at)) this.reset();

    const currentLast = this.#samples.at(-1);
    if (!currentLast || completed !== currentLast.completed) {
      this.#samples.push({ completed, at });
    }

    const cutoff = at - SAMPLE_WINDOW_MILLISECONDS;
    const firstInsideWindow = this.#samples.findIndex((sample) => sample.at >= cutoff);
    if (firstInsideWindow > 1) {
      this.#samples.splice(0, firstInsideWindow - 1);
    }
  }

  #completionRatePerSecond(): number {
    const first = this.#samples[0];
    const last = this.#samples.at(-1);
    if (!first || !last) return MAX_METADATA_REQUESTS_PER_SECOND;

    const elapsed = last.at - first.at;
    const completed = last.completed - first.completed;
    if (elapsed < MIN_RATE_SAMPLE_MILLISECONDS || completed <= 0) {
      return MAX_METADATA_REQUESTS_PER_SECOND;
    }
    return completed / (elapsed / 1_000);
  }
}

export const formatEstimatedTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error("ETA seconds 必須是有限非負數");
  }
  if (seconds === 0) return "即將";
  if (seconds < 60) return `約 ${Math.max(5, Math.ceil(seconds / 5) * 5)} 秒`;
  if (seconds < 3_600) return `約 ${Math.ceil(seconds / 60)} 分鐘`;

  const roundedMinutes = Math.ceil(seconds / 60);
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  return minutes === 0 ? `約 ${hours} 小時` : `約 ${hours} 小時 ${minutes} 分鐘`;
};

const assertProgress = (progress: MetadataProgress): void => {
  for (const [label, value] of [
    ["total", progress.total],
    ["completed", progress.completed],
    ["available", progress.available],
    ["unavailable", progress.unavailable],
    ["failed", progress.failed]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`MetadataProgress.${label} 必須是非負安全整數`);
    }
  }
  if (progress.completed > progress.total) {
    throw new Error("MetadataProgress.completed 不可大於 total");
  }
  if (progress.available + progress.unavailable + progress.failed !== progress.completed) {
    throw new Error("MetadataProgress terminal counts 必須等於 completed");
  }
};
