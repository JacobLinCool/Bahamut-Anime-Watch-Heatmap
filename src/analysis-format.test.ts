import assert from "node:assert/strict";
import { test } from "vitest";
import { formatBingeElapsed, formatEpisodesPerDay } from "./analysis-format";

test("binge elapsed time retains days, hours and minutes without treating it as content length", () => {
  assert.equal(formatBingeElapsed(0), "0 分鐘");
  assert.equal(formatBingeElapsed(36 * 60 + 29), "1 天 12 小時 29 分鐘");
  assert.equal(formatBingeElapsed(13 * 24 * 60), "13 天");
  assert.equal(formatBingeElapsed(24 * 60 - 0.1), "1 天");
  assert.throws(() => formatBingeElapsed(-1), RangeError);
});

test("daily episode rates remain nonzero when a slow season averages below one tenth", () => {
  assert.equal(formatEpisodesPerDay(12 / 5), "2.4 集／日");
  assert.equal(formatEpisodesPerDay(24 / 8), "3 集／日");
  assert.equal(formatEpisodesPerDay(4 / 365), "不到 0.1 集／日");
  assert.throws(() => formatEpisodesPerDay(Number.NaN), RangeError);
});
