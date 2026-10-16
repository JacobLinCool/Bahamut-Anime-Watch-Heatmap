import type { DayBoundaryMode, WatchEntry } from "./model";
import { parseVideoSn } from "./metadata";
import { addTaipeiCalendarDays, dateFromTaipeiParts, taipeiStartOfDate, toTaipeiDateKey } from "./time";

const THIRTY_HOUR_BOUNDARY_MILLISECONDS = 6 * 60 * 60 * 1000;

export const HISTORY_ROW_SELECTOR = ".user-watchTime-list .user-watch-textlist a";

export type HistoryParseIssue = {
  readonly href: string;
  readonly message: string;
};

export type HistoryParseResult = {
  readonly entries: readonly WatchEntry[];
  readonly issues: readonly HistoryParseIssue[];
};

/** "hour" labels such as "3 小時前" place the watch only within an hour. */
export type WatchTimePrecision = "minute" | "hour";

export type PreciseWatchDate = {
  readonly watchedAt: Date;
  readonly precision: WatchTimePrecision;
  /** True for labels measured from when the row was fetched ("N 分前", "1 分內", "N 小時前"). */
  readonly relativeToNow: boolean;
};

/** One watched episode, independent of the day-boundary mode and window. */
export type HistoryWatch = {
  readonly videoSn: number;
  readonly watchedAt: Date;
  readonly precision: WatchTimePrecision;
  readonly title: string;
  readonly episode: string;
};

export type HistoryRow = HistoryWatch & {
  readonly relativeToNow: boolean;
};

export type HistoryRowParseResult = {
  /** Parsed rows in DOM order, before window filtering or de-duplication. */
  readonly rows: readonly HistoryRow[];
  readonly issues: readonly HistoryParseIssue[];
};

export const parseWatchEntriesFromDom = (
  root: ParentNode,
  mode: DayBoundaryMode,
  now: Date = new Date(),
  baseUrl: string = location.href
): HistoryParseResult => {
  const { rows, issues } = parseHistoryRowsFromDom(root, now, baseUrl);
  return {
    entries: watchEntriesFromHistory(rows, mode, now),
    issues
  };
};

export const parseHistoryRowsFromDom = (
  root: ParentNode,
  now: Date = new Date(),
  baseUrl: string = location.href
): HistoryRowParseResult => parseHistoryRowLinks(
  Array.from(root.querySelectorAll<Element>(HISTORY_ROW_SELECTOR)),
  now,
  baseUrl
);

/**
 * Parses history row links (elements matching HISTORY_ROW_SELECTOR) in the
 * given order. Relative labels are measured from `now`, which must be when
 * these rows were fetched rather than when they are read.
 */
export const parseHistoryRowLinks = (
  links: readonly Element[],
  now: Date,
  baseUrl: string = location.href
): HistoryRowParseResult => {
  const rows: HistoryRow[] = [];
  const issues: HistoryParseIssue[] = [];

  for (const link of links) {
    const href = link.getAttribute("href") ?? "";
    const watched = parseWatchDatePrecise(cleanText(link.querySelector(".date")?.textContent ?? ""), now);
    const rawTitle = cleanText(link.querySelector(".history-list-anime-title")?.textContent ?? "");
    let videoSn: number;

    try {
      videoSn = parseVideoSn(href, baseUrl);
    } catch (error) {
      issues.push({ href, message: error instanceof Error ? error.message : "無法辨識單集連結" });
      continue;
    }

    if (!watched) {
      issues.push({ href, message: "無法辨識觀看時間" });
      continue;
    }

    if (!rawTitle) {
      issues.push({ href, message: "觀看紀錄缺少作品名稱" });
      continue;
    }

    const episode = extractEpisode(rawTitle);
    const title = cleanTitle(rawTitle, episode);
    rows.push({
      videoSn,
      watchedAt: watched.watchedAt,
      precision: watched.precision,
      relativeToNow: watched.relativeToNow,
      title: title || rawTitle,
      episode: episode || "集數未標示"
    });
  }

  return { rows, issues };
};

/** Applies the 365-day window of `mode` ending at `now` and derives each dateKey. */
export const watchEntriesFromHistory = (
  watches: readonly HistoryWatch[],
  mode: DayBoundaryMode,
  now: Date
): WatchEntry[] => {
  const todayKey = toTaipeiDateKey(now, mode);
  const firstDateKey = addTaipeiCalendarDays(todayKey, -364);
  const entries: WatchEntry[] = [];
  for (const watch of watches) {
    const dateKey = toTaipeiDateKey(watch.watchedAt, mode);
    if (dateKey < firstDateKey || dateKey > todayKey) {
      continue;
    }
    entries.push({
      videoSn: watch.videoSn,
      dateKey,
      watchedAt: new Date(watch.watchedAt.getTime()),
      title: watch.title,
      episode: watch.episode
    });
  }
  return dedupeEntries(entries);
};

/** First instant inside the 365-day window of `mode` ending at `now`. */
export const historyWindowStart = (now: Date, mode: DayBoundaryMode): Date => {
  const firstDateKey = addTaipeiCalendarDays(toTaipeiDateKey(now, mode), -364);
  const boundaryOffset = mode === "thirty-hour" ? THIRTY_HOUR_BOUNDARY_MILLISECONDS : 0;
  return new Date(taipeiStartOfDate(firstDateKey).getTime() + boundaryOffset);
};

export const parseWatchDate = (text: string, now: Date = new Date()): Date | null => {
  return parseWatchDatePrecise(text, now)?.watchedAt ?? null;
};

export const parseWatchDatePrecise = (text: string, now: Date = new Date()): PreciseWatchDate | null => {
  const absolute = /^(20\d{2})([./-])(\d{1,2})\2(\d{1,2})\s+(\d{1,2}):(\d{2})$/.exec(text);
  if (absolute) {
    return exactMinute(dateFromTaipeiParts(
      Number(absolute[1]),
      Number(absolute[3]),
      Number(absolute[4]),
      Number(absolute[5]),
      Number(absolute[6])
    ));
  }

  const relativeDay = text.match(/^(昨天|前天)\s+(\d{1,2}):(\d{2})$/);
  if (relativeDay) {
    const dateKey = addTaipeiCalendarDays(toTaipeiDateKey(now), relativeDay[1] === "昨天" ? -1 : -2);
    const [year, month, day] = dateKey.split("-").map(Number);
    return exactMinute(
      dateFromTaipeiParts(year ?? 0, month ?? 0, day ?? 0, Number(relativeDay[2]), Number(relativeDay[3]))
    );
  }

  const relativeMinutes = text.match(/^(\d+)\s*分前$/);
  if (relativeMinutes?.[1]) {
    return relativeToNow(new Date(now.getTime() - Number(relativeMinutes[1]) * 60 * 1000), "minute");
  }

  const relativeHours = text.match(/^(\d+)\s*小時前$/);
  if (relativeHours?.[1]) {
    return relativeToNow(new Date(now.getTime() - Number(relativeHours[1]) * 60 * 60 * 1000), "hour");
  }

  return text === "1 分內" ? relativeToNow(new Date(now), "minute") : null;
};

export const dedupeEntries = (entries: readonly WatchEntry[]): WatchEntry[] => {
  const seen = new Set<string>();
  return entries
    .filter((entry) => {
      const key = `${entry.videoSn}|${entry.watchedAt.getTime()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.watchedAt.getTime() - right.watchedAt.getTime());
};

const extractEpisode = (text: string): string => {
  const normalized = normalizeText(text);
  const bracketEpisode = normalized.match(/[\[【]\s*(\d+(?:\.\d+)?)\s*[\]】]/);
  if (bracketEpisode?.[1]) {
    return `第 ${bracketEpisode[1]} 集`;
  }

  const numberedEpisode = normalized.match(/第\s*(\d+(?:\.\d+)?)\s*(話|集|季|部)/);
  if (numberedEpisode?.[0]) {
    return numberedEpisode[0].replace(/\s+/g, " ");
  }

  const englishEpisode = normalized.match(/\b(?:episode|ep\.?)\s*(\d+(?:\.\d+)?)/i);
  if (englishEpisode?.[1]) {
    return `第 ${englishEpisode[1]} 集`;
  }

  if (/電影|劇場版/.test(normalized)) {
    return "電影";
  }
  if (/\bOVA\b/i.test(normalized)) {
    return "OVA";
  }
  return "";
};

const cleanTitle = (text: string, episode: string): string => cleanText(text)
  .replace(/\b20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s+\d{1,2}:\d{2}\b/g, "")
  .replace(/[\[【]\s*\d+(?:\.\d+)?\s*[\]】]/g, "")
  .replace(episode, "")
  .replace(/觀看紀錄|觀看記錄|觀看結束|已更新|繼續觀看/g, "")
  .trim();

const exactMinute = (date: Date | null): PreciseWatchDate | null => date === null
  ? null
  : { watchedAt: date, precision: "minute", relativeToNow: false };

const relativeToNow = (date: Date, precision: WatchTimePrecision): PreciseWatchDate | null =>
  Number.isNaN(date.getTime()) ? null : { watchedAt: date, precision, relativeToNow: true };
const normalizeText = (text: string): string => cleanText(text).replace(/\s+/g, " ");
const cleanText = (text: string): string => text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
