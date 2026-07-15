import type { DayBoundaryMode, WatchEntry } from "./model";
import { parseVideoSn } from "./metadata";
import { addTaipeiCalendarDays, dateFromTaipeiParts, toTaipeiDateKey } from "./time";

export type HistoryParseIssue = {
  readonly href: string;
  readonly message: string;
};

export type HistoryParseResult = {
  readonly entries: readonly WatchEntry[];
  readonly issues: readonly HistoryParseIssue[];
};

export const parseWatchEntriesFromDom = (
  root: ParentNode,
  mode: DayBoundaryMode,
  now: Date = new Date(),
  baseUrl: string = location.href
): HistoryParseResult => {
  const entries: WatchEntry[] = [];
  const issues: HistoryParseIssue[] = [];
  const links = root.querySelectorAll<HTMLAnchorElement>(".user-watchTime-list .user-watch-textlist a");
  const todayKey = toTaipeiDateKey(now, mode);
  const firstDateKey = addTaipeiCalendarDays(todayKey, -364);

  for (const link of links) {
    const href = link.getAttribute("href") ?? "";
    const watchedAt = parseWatchDate(cleanText(link.querySelector(".date")?.textContent ?? ""), now);
    const rawTitle = cleanText(link.querySelector(".history-list-anime-title")?.textContent ?? "");
    let videoSn: number;

    try {
      videoSn = parseVideoSn(href, baseUrl);
    } catch (error) {
      issues.push({ href, message: error instanceof Error ? error.message : "無法辨識單集連結" });
      continue;
    }

    if (!watchedAt) {
      issues.push({ href, message: "無法辨識觀看時間" });
      continue;
    }

    if (!rawTitle) {
      issues.push({ href, message: "觀看紀錄缺少作品名稱" });
      continue;
    }

    const dateKey = toTaipeiDateKey(watchedAt, mode);
    if (dateKey < firstDateKey || dateKey > todayKey) {
      continue;
    }

    const episode = extractEpisode(rawTitle);
    const title = cleanTitle(rawTitle, episode);
    entries.push({
      videoSn,
      dateKey,
      watchedAt,
      title: title || rawTitle,
      episode: episode || "集數未標示"
    });
  }

  return {
    entries: dedupeEntries(entries),
    issues
  };
};

export const parseWatchDate = (text: string, now: Date = new Date()): Date | null => {
  const absolute = /^(20\d{2})([./-])(\d{1,2})\2(\d{1,2})\s+(\d{1,2}):(\d{2})$/.exec(text);
  if (absolute) {
    return dateFromTaipeiParts(
      Number(absolute[1]),
      Number(absolute[3]),
      Number(absolute[4]),
      Number(absolute[5]),
      Number(absolute[6])
    );
  }

  const relativeDay = text.match(/^(昨天|前天)\s+(\d{1,2}):(\d{2})$/);
  if (relativeDay) {
    const dateKey = addTaipeiCalendarDays(toTaipeiDateKey(now), relativeDay[1] === "昨天" ? -1 : -2);
    const [year, month, day] = dateKey.split("-").map(Number);
    return dateFromTaipeiParts(year ?? 0, month ?? 0, day ?? 0, Number(relativeDay[2]), Number(relativeDay[3]));
  }

  const relativeMinutes = text.match(/^(\d+)\s*分前$/);
  if (relativeMinutes?.[1]) {
    return validDateOrNull(new Date(now.getTime() - Number(relativeMinutes[1]) * 60 * 1000));
  }

  const relativeHours = text.match(/^(\d+)\s*小時前$/);
  if (relativeHours?.[1]) {
    return validDateOrNull(new Date(now.getTime() - Number(relativeHours[1]) * 60 * 60 * 1000));
  }

  return text === "1 分內" ? new Date(now) : null;
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

const validDateOrNull = (date: Date): Date | null => Number.isNaN(date.getTime()) ? null : date;
const normalizeText = (text: string): string => cleanText(text).replace(/\s+/g, " ");
const cleanText = (text: string): string => text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
