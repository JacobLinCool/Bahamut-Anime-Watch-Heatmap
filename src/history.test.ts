import { describe, expect, it } from "vitest";

import { dedupeEntries, parseWatchDate } from "./history";
import type { WatchEntry } from "./model";

describe("watch history parsing", () => {
  it("parses absolute and relative timestamps as Asia/Taipei", () => {
    const now = new Date("2026-07-14T07:30:00.000Z");
    expect(parseWatchDate("2026/07/14 03:05", now)?.toISOString()).toBe("2026-07-13T19:05:00.000Z");
    expect(parseWatchDate("昨天 23:10", now)?.toISOString()).toBe("2026-07-13T15:10:00.000Z");
    expect(parseWatchDate("2 小時前", now)?.toISOString()).toBe("2026-07-14T05:30:00.000Z");
    expect(parseWatchDate("2026/02/29 12:00", now)).toBeNull();
    expect(parseWatchDate("2026/07-14 12:00", now)).toBeNull();
    expect(parseWatchDate("更新於 2026/07/14 12:00", now)).toBeNull();
  });

  it("deduplicates by episode identity and exact viewing time", () => {
    const first: WatchEntry = {
      videoSn: 10,
      dateKey: "2026-07-14",
      watchedAt: new Date("2026-07-14T00:00:00.000Z"),
      title: "作品 A",
      episode: "第 1 集"
    };
    const repeated = { ...first };
    const later = { ...first, watchedAt: new Date("2026-07-14T01:00:00.000Z") };
    expect(dedupeEntries([later, first, repeated])).toEqual([first, later]);
  });
});
