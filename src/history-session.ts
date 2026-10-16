import {
  parseHistoryRowLinks,
  type HistoryParseIssue,
  type HistoryRow
} from "./history";
import type { HistoryCacheRecord } from "./history-cache";

export type HistoryAccountBinding = "bound" | "same" | "changed";

export type HistorySessionRead = {
  /** Rows not seen by an earlier read; they form the newest page. */
  readonly appendedRowCount: number;
  /** Rows grouped by the append that brought them, oldest append first. */
  readonly pages: readonly (readonly HistoryRow[])[];
  readonly rows: readonly HistoryRow[];
  readonly issues: readonly HistoryParseIssue[];
};

type RowFetch = {
  readonly page: number;
  readonly fetchedAt: Date;
};

/**
 * What one mounted history page has shown. The page renders its first rows
 * once and only appends later ones, so a re-read must not measure old relative
 * labels ("5 分前", "昨天 03:08") from a later time: each row keeps the fetch
 * time of the append that brought it. Coverage never extends past the first
 * render, the oldest data on the page.
 */
export class HistoryPageSession {
  readonly snapshotAt: Date;
  readonly #rows = new WeakMap<Element, RowFetch>();
  #account: { readonly hash: string | null } | undefined;
  #pageCount = 0;

  constructor(snapshotAt: Date) {
    if (!(snapshotAt instanceof Date) || Number.isNaN(snapshotAt.getTime())) {
      throw new Error("history session snapshotAt 必須是有效 Date");
    }
    this.snapshotAt = new Date(snapshotAt.getTime());
  }

  /**
   * Binds the session to the account logged in at its first collection, whose
   * history the page rendered. Any later id, or none, means appended pages may
   * belong to another account.
   */
  bindAccount(hash: string | null): HistoryAccountBinding {
    if (this.#account === undefined) {
      this.#account = { hash };
      return "bound";
    }
    return this.#account.hash === hash ? "same" : "changed";
  }

  /** True when a saved record was read from a newer page, for example in another tab. */
  predates(cache: Pick<HistoryCacheRecord, "collectedAt">): boolean {
    return cache.collectedAt.getTime() > this.snapshotAt.getTime();
  }

  /**
   * Reads the history row links in DOM order. Links not seen before form a new
   * page fetched at `fetchedAt`; the first page is the initial render, fetched
   * at the snapshot time. Each page is parsed against its own fetch time.
   */
  read(links: readonly Element[], fetchedAt: Date, baseUrl: string): HistorySessionRead {
    let appendedPage: RowFetch | undefined;
    let appendedRowCount = 0;
    const linksByPage = new Map<number, { readonly fetchedAt: Date; readonly links: Element[] }>();
    for (const link of links) {
      let fetch = this.#rows.get(link);
      if (!fetch) {
        if (!appendedPage) {
          const page = this.#pageCount;
          this.#pageCount += 1;
          appendedPage = { page, fetchedAt: new Date((page === 0 ? this.snapshotAt : fetchedAt).getTime()) };
        }
        fetch = appendedPage;
        this.#rows.set(link, fetch);
        appendedRowCount += 1;
      }
      const group = linksByPage.get(fetch.page) ?? { fetchedAt: fetch.fetchedAt, links: [] };
      group.links.push(link);
      linksByPage.set(fetch.page, group);
    }

    const pages: HistoryRow[][] = [];
    const issues: HistoryParseIssue[] = [];
    for (const [, group] of [...linksByPage].sort(([left], [right]) => left - right)) {
      const parsed = parseHistoryRowLinks(group.links, group.fetchedAt, baseUrl);
      pages.push([...parsed.rows]);
      issues.push(...parsed.issues);
    }
    return { appendedRowCount, pages, rows: pages.flat(), issues };
  }
}
