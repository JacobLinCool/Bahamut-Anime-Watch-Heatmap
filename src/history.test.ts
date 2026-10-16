import { describe, expect, it } from "vitest";

import {
  dedupeEntries,
  historyWindowStart,
  parseHistoryRowsFromDom,
  parseWatchDate,
  parseWatchDatePrecise,
  parseWatchEntriesFromDom,
  watchEntriesFromHistory,
  type HistoryWatch
} from "./history";
import type { WatchEntry } from "./model";

const BASE_URL = "https://ani.gamer.com.tw/viewList.php";

type FakeRow = { readonly href: string; readonly title: string; readonly date: string };

const fakeHistoryRoot = (rows: readonly FakeRow[]): ParentNode => ({
  querySelectorAll: (selector: string) => {
    if (selector !== ".user-watchTime-list .user-watch-textlist a") throw new Error(selector);
    return rows.map((row) => ({
      getAttribute: (name: string) => name === "href" ? row.href : null,
      querySelector: (child: string) => child === ".date"
        ? { textContent: row.date }
        : child === ".history-list-anime-title"
          ? { textContent: row.title }
          : null
    }));
  }
}) as unknown as ParentNode;

const watch = (videoSn: number, watchedAt: string): HistoryWatch => ({
  videoSn,
  watchedAt: new Date(watchedAt),
  precision: "minute",
  title: `作品 ${videoSn}`,
  episode: "第 1 集"
});

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

  it("reports how precisely each label places the watch", () => {
    const now = new Date("2026-07-14T07:30:00.000Z");
    const precise = (text: string) => {
      const value = parseWatchDatePrecise(text, now);
      return value && { at: value.watchedAt.toISOString(), precision: value.precision, relative: value.relativeToNow };
    };
    expect(precise("2026/07/14 03:05")).toEqual({ at: "2026-07-13T19:05:00.000Z", precision: "minute", relative: false });
    expect(precise("昨天 23:10")).toEqual({ at: "2026-07-13T15:10:00.000Z", precision: "minute", relative: false });
    expect(precise("前天 00:00")).toEqual({ at: "2026-07-11T16:00:00.000Z", precision: "minute", relative: false });
    expect(precise("15 分前")).toEqual({ at: "2026-07-14T07:15:00.000Z", precision: "minute", relative: true });
    expect(precise("1 分內")).toEqual({ at: "2026-07-14T07:30:00.000Z", precision: "minute", relative: true });
    expect(precise("15 小時前")).toEqual({ at: "2026-07-13T16:30:00.000Z", precision: "hour", relative: true });
    expect(precise("昨天 24:00")).toBeNull();
    expect(precise("剛剛")).toBeNull();
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

  it("returns raw rows in DOM order with precision, before any window filtering", () => {
    const now = new Date("2026-07-14T07:30:00.000Z");
    const root = fakeHistoryRoot([
      { href: "https://ani.gamer.com.tw/animeVideo.php?sn=3", title: "作品 C [12]", date: "3 小時前" },
      { href: "https://ani.gamer.com.tw/animeVideo.php?sn=1", title: "作品 A [1]", date: "2024/01/01 10:00" },
      { href: "https://example.com/animeVideo.php?sn=9", title: "外部", date: "2026/07/01 10:00" },
      { href: "/animeVideo.php?sn=2", title: "作品 B [2]", date: "不明" },
      { href: "/animeVideo.php?sn=4", title: " ", date: "2026/07/01 10:00" }
    ]);
    const { rows, issues } = parseHistoryRowsFromDom(root, now, BASE_URL);
    expect(rows.map((row) => [row.videoSn, row.precision, row.relativeToNow, row.title, row.episode])).toEqual([
      [3, "hour", true, "作品 C", "第 12 集"],
      [1, "minute", false, "作品 A", "第 1 集"]
    ]);
    expect(issues.map((issue) => issue.message)).toEqual([
      "觀看紀錄連結不是動畫瘋單集網址",
      "無法辨識觀看時間",
      "觀看紀錄缺少作品名稱"
    ]);
    // The entry API keeps applying the window to the same rows.
    expect(parseWatchEntriesFromDom(root, "calendar", now, BASE_URL).entries.map((entry) => entry.videoSn)).toEqual([3]);
  });

  it("re-derives date keys and the 365-day window for each day-boundary mode", () => {
    const now = new Date("2026-07-14T01:00:00+08:00");
    // Calendar window starts 2025-07-15 00:00; the 30-hour window starts 2025-07-14 06:00.
    expect(historyWindowStart(now, "calendar").toISOString()).toBe("2025-07-14T16:00:00.000Z");
    expect(historyWindowStart(now, "thirty-hour").toISOString()).toBe("2025-07-13T22:00:00.000Z");
    const watches = [
      watch(1, "2025-07-14T05:59:00+08:00"),
      watch(2, "2025-07-14T07:00:00+08:00"),
      watch(3, "2026-07-14T00:30:00+08:00"),
      watch(4, "2026-07-14T03:00:00+08:00")
    ];
    const calendar = watchEntriesFromHistory(watches, "calendar", now);
    const thirtyHour = watchEntriesFromHistory(watches, "thirty-hour", now);
    expect(calendar.map((entry) => [entry.videoSn, entry.dateKey])).toEqual([[3, "2026-07-14"], [4, "2026-07-14"]]);
    expect(thirtyHour.map((entry) => [entry.videoSn, entry.dateKey])).toEqual([
      [2, "2025-07-14"],
      [3, "2026-07-13"],
      [4, "2026-07-13"]
    ]);
    expect(thirtyHour[0]?.watchedAt).not.toBe(watches[1]?.watchedAt);
  });
});
