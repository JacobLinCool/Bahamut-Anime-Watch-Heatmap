import { describe, expect, it } from "vitest";

import type { HistoryWatch } from "./history";
import {
  evaluateHistoryPage,
  finalizeHistoryLoad,
  type HistoryCacheRecord
} from "./history-cache";
import { HistoryPageSession } from "./history-session";

const BASE_URL = "https://ani.gamer.com.tw/viewList.php";
const HASH = "a".repeat(64);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A history row link as the parser reads it. */
const link = (videoSn: number, date: string, title = `作品 ${videoSn} [1]`): Element => ({
  getAttribute: (name: string) => name === "href" ? `/animeVideo.php?sn=${videoSn}` : null,
  querySelector: (selector: string) => selector === ".date"
    ? { textContent: date }
    : selector === ".history-list-anime-title"
      ? { textContent: title }
      : null
}) as unknown as Element;

const taipei = (local: string): Date => new Date(`${local}+08:00`);
const times = (watches: readonly HistoryWatch[]) =>
  watches.map((watch) => [watch.videoSn, watch.watchedAt.toISOString(), watch.precision]);

describe("history page session", () => {
  it("measures each page's relative labels from that page's fetch, not from a later read", () => {
    const snapshotAt = taipei("2026-10-15T23:50:00");
    const session = new HistoryPageSession(snapshotAt);
    const initial = [link(1, "1 小時前"), link(2, "昨天 03:08"), link(3, "5 分前"), link(4, "不明")];

    // The first read is the initial render, whatever time the caller passes.
    const first = session.read(initial, taipei("2026-10-15T23:50:02"), BASE_URL);
    expect(first.appendedRowCount).toBe(4);
    expect(first.pages.map(times)).toEqual([[
      [1, taipei("2026-10-15T22:50:00").toISOString(), "hour"],
      [2, taipei("2026-10-14T03:08:00").toISOString(), "minute"],
      [3, taipei("2026-10-15T23:45:00").toISOString(), "minute"]
    ]]);
    expect(first.issues).toHaveLength(1);

    // After midnight the user appends a page; the old rows keep their meaning.
    const appended = [link(5, "2 小時前"), link(6, "2026/10/01 10:00")];
    const later = session.read([...initial, ...appended], taipei("2026-10-16T00:35:00"), BASE_URL);
    expect(later.appendedRowCount).toBe(2);
    expect(later.pages.map(times)).toEqual([
      first.pages[0]!.map((row) => [row.videoSn, row.watchedAt.toISOString(), row.precision]),
      [
        [5, taipei("2026-10-15T22:35:00").toISOString(), "hour"],
        [6, taipei("2026-10-01T10:00:00").toISOString(), "minute"]
      ]
    ]);
    expect(later.rows.map((row) => row.videoSn)).toEqual([1, 2, 3, 5, 6]);
    expect(later.issues).toHaveLength(1);

    // Nothing new: the same pages, and nothing counts as appended.
    const again = session.read([...initial, ...appended], taipei("2026-10-16T09:00:00"), BASE_URL);
    expect(again.appendedRowCount).toBe(0);
    expect(again.pages.map(times)).toEqual(later.pages.map(times));
  });

  it("re-collects a user-appended page without clicking again or claiming unread coverage", () => {
    // The page was read at 23:50; a day-old cache knew everything except row 1.
    const snapshotAt = taipei("2026-10-15T23:50:00");
    const exact = (videoSn: number, local: string): HistoryWatch => ({
      videoSn,
      watchedAt: taipei(local),
      precision: "minute",
      title: `作品 ${videoSn}`,
      episode: "第 1 集"
    });
    const previous: HistoryCacheRecord = {
      accountHash: HASH,
      collectedAt: taipei("2026-10-14T20:00:00"),
      lastFullSyncAt: taipei("2026-10-12T20:00:00"),
      complete: true,
      entries: [
        exact(2, "2026-10-14T03:08:00"),
        exact(3, "2026-10-13T21:00:00"),
        exact(4, "2026-10-10T21:00:00"),
        exact(5, "2026-10-05T21:00:00"),
        exact(6, "2026-10-01T21:00:00")
      ]
    };
    const session = new HistoryPageSession(snapshotAt);
    const page1 = [link(1, "1 小時前"), link(2, "昨天 03:08"), link(3, "前天 21:00")];
    const page2 = [link(4, "2026/10/10 21:00")];
    const page3 = [link(5, "2026/10/05 21:00"), link(6, "2026/10/01 21:00")];

    // First collection: row 1 is new, so one click; page 2 is fully cached.
    const firstRead = session.read(page1, snapshotAt, BASE_URL);
    expect(evaluateHistoryPage({ cache: previous, incremental: true, pages: firstRead.pages, collectedAt: snapshotAt }))
      .toEqual({ kind: "continue", incrementalRejection: "row-after-cache" });
    const secondRead = session.read([...page1, ...page2], taipei("2026-10-15T23:50:03"), BASE_URL);
    expect(evaluateHistoryPage({ cache: previous, incremental: true, pages: secondRead.pages, collectedAt: snapshotAt }))
      .toEqual({ kind: "incremental-stop" });
    const first = finalizeHistoryLoad({
      end: "incremental-stop",
      rows: secondRead.rows,
      issueCount: 0,
      cache: previous,
      collectedAt: snapshotAt
    });
    const saved: HistoryCacheRecord = { ...previous, collectedAt: snapshotAt, entries: first.watches };

    // At 00:35 the user clicks "顯示更多". Only the appended page is judged.
    const recollected = session.read([...page1, ...page2, ...page3], taipei("2026-10-16T00:35:00"), BASE_URL);
    expect(evaluateHistoryPage({ cache: saved, incremental: true, pages: recollected.pages, collectedAt: snapshotAt }))
      .toEqual({ kind: "incremental-stop" });
    const second = finalizeHistoryLoad({
      end: "incremental-stop",
      rows: recollected.rows,
      issueCount: 0,
      cache: saved,
      collectedAt: snapshotAt
    });
    const byVideoSn = new Map(second.watches.map((watch) => [watch.videoSn, watch]));
    expect(byVideoSn.get(2)?.watchedAt).toEqual(taipei("2026-10-14T03:08:00"));
    expect(byVideoSn.get(1)?.watchedAt).toEqual(taipei("2026-10-15T22:50:00"));
    expect(times(second.watches)).toEqual(times(first.watches));
  });

  it("binds the account of its first collection and reports any later change", () => {
    const session = new HistoryPageSession(new Date());
    expect(session.bindAccount(HASH)).toBe("bound");
    expect(session.bindAccount(HASH)).toBe("same");
    expect(session.bindAccount("b".repeat(64))).toBe("changed");
    expect(session.bindAccount(null)).toBe("changed");

    // A page first read without an account never adopts one later.
    const anonymous = new HistoryPageSession(new Date());
    expect(anonymous.bindAccount(null)).toBe("bound");
    expect(anonymous.bindAccount(null)).toBe("same");
    expect(anonymous.bindAccount(HASH)).toBe("changed");
  });

  it("recognizes a saved read newer than its own page", () => {
    const snapshotAt = new Date("2026-10-16T02:00:00.000Z");
    const session = new HistoryPageSession(snapshotAt);
    expect(session.predates({ collectedAt: new Date(snapshotAt.getTime() + 1) })).toBe(true);
    expect(session.predates({ collectedAt: snapshotAt })).toBe(false);
    expect(session.predates({ collectedAt: new Date(snapshotAt.getTime() - DAY) })).toBe(false);
    expect(() => new HistoryPageSession(new Date(Number.NaN))).toThrow();
  });
});
