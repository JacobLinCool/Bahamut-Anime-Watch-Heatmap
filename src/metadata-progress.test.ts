import { describe, expect, it } from "vitest";
import { MetadataProgressEstimator, formatEstimatedTime } from "./metadata-progress";
import type { MetadataProgress } from "./model";

describe("metadata loading presentation", () => {
  it("shows a percentage and uses the request ceiling before measured throughput is available", () => {
    let now = 0;
    const estimator = new MetadataProgressEstimator(() => now);
    const first = estimator.present(progress(20, 100));

    expect(first).toEqual({
      completed: 20,
      total: 100,
      percent: 20,
      detail: "20% · 20 / 100 · 約 10 秒完成",
      estimatedSecondsRemaining: 8
    });

    now = 2_000;
    const measured = estimator.present(progress(30, 100));
    expect(measured?.estimatedSecondsRemaining).toBe(14);
    expect(measured?.detail).toBe("30% · 30 / 100 · 約 15 秒完成");
  });

  it("recalculates when discovery expands the total and resets after completion", () => {
    let now = 0;
    const estimator = new MetadataProgressEstimator(() => now);
    estimator.present(progress(10, 20));
    now = 1_000;
    expect(estimator.present(progress(20, 40))?.percent).toBe(50);
    expect(estimator.present({ ...progress(40, 40), phase: "complete" })).toBeNull();

    now = 2_000;
    expect(estimator.present(progress(0, 100))?.estimatedSecondsRemaining).toBe(10);
  });

  it("supports the brief indeterminate discovery state", () => {
    const estimator = new MetadataProgressEstimator(() => 0);
    expect(estimator.present(progress(0, 0))).toEqual({
      completed: 0,
      total: 0,
      percent: null,
      detail: "正在確認需要整理的作品…",
      estimatedSecondsRemaining: null
    });
  });

  it("formats ETA without false second-level precision", () => {
    expect(formatEstimatedTime(0)).toBe("即將");
    expect(formatEstimatedTime(1)).toBe("約 5 秒");
    expect(formatEstimatedTime(61)).toBe("約 2 分鐘");
    expect(formatEstimatedTime(3_661)).toBe("約 1 小時 2 分鐘");
  });
});

const progress = (completed: number, total: number): MetadataProgress => ({
  phase: "resolving",
  total,
  completed,
  available: completed,
  unavailable: 0,
  failed: 0
});
