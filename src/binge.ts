import type { AnalysisDataset, WatchFact } from "./analysis-dataset";
import type { AnimeMetadata, EpisodeRef } from "./model";
import { taipeiStartOfDate, toTaipeiDateKey } from "./time";

const DAY_MINUTES = 24 * 60;
const TAIL_EPISODE_COUNT = 4;

export type BingeRow = {
  readonly rank: number;
  readonly animeSn: number;
  readonly title: string;
  readonly coverUrl: string | null;
  readonly episodeCount: number;
  readonly startedAt: Date;
  readonly completedAt: Date;
  /** Time between observed watch records, not time spent playing videos. */
  readonly elapsedMinutes: number;
  /** Inclusive watch-date span, including dates without a watch. */
  readonly spanDays: number;
  readonly activeDayCount: number;
  readonly episodesPerDay: number;
};

/**
 * One unambiguous season catalog. A continuation may be numbered 13–24.
 * Special/prologue labels and multiple playback groups have no verified mapping
 * to a season's main episodes, so they do not produce a completion denominator.
 */
export const singleSeasonReferences = (anime: AnimeMetadata): readonly EpisodeRef[] | null => {
  if (!Number.isSafeInteger(anime.totalEpisode) || anime.totalEpisode < 1
    || anime.episodeRefs.length !== anime.totalEpisode) return null;
  const refs = [...anime.episodeRefs].sort((a, b) => a.episodeNumber - b.episodeNumber);
  const first = refs[0]!;
  if (!first.groupKey.trim() || !Number.isSafeInteger(first.episodeNumber) || first.episodeNumber < 1) return null;
  const videoSns = new Set<number>();
  for (const [index, ref] of refs.entries()) {
    if (!Number.isSafeInteger(ref.videoSn) || ref.videoSn < 1 || videoSns.has(ref.videoSn)
      || ref.groupKey !== first.groupKey || ref.episodeNumber !== first.episodeNumber + index) return null;
    videoSns.add(ref.videoSn);
  }
  return refs;
};

/** Completion events belong to watch-time periods; release-time cohorts are not completion periods. */
export const buildBingeRows = (dataset: AnalysisDataset): readonly BingeRow[] => {
  if (dataset.scope.axis !== "watched-at") return [];
  const mode = dataset.scope.dayBoundaryMode;
  const cutoff = dataset.period.effectiveRange.endExclusive.getTime();
  const watches = new Map(dataset.canonical
    .filter((fact) => fact.entry.watchedAt.getTime() < cutoff)
    .map((fact) => [fact.entry.videoSn, fact]));
  const rows: Omit<BingeRow, "rank">[] = [];

  for (const anime of dataset.anime.values()) {
    const refs = singleSeasonReferences(anime);
    // A single video has no multi-episode viewing journey (e.g. a movie).
    if (!refs || refs.length < 2) continue;
    const facts: WatchFact[] = [];
    for (const ref of refs) {
      const fact = watches.get(ref.videoSn);
      if (!fact || !fact.releaseValid || fact.animeSn !== anime.animeSn
        || fact.episode?.episodeNumber !== ref.episodeNumber
        || fact.episode.groupKey !== ref.groupKey) break;
      facts.push(fact);
    }
    if (facts.length !== refs.length) continue;

    const startMinute = Math.min(...facts.map((fact) => fact.watchedMinute));
    const endMinute = Math.max(...facts.map((fact) => fact.watchedMinute));
    const completedAt = new Date(endMinute * 60_000);
    if (completedAt.getTime() < dataset.period.effectiveRange.startInclusive.getTime()) continue;
    if (!isBinge(anime, facts)) continue;

    const startedAt = new Date(startMinute * 60_000);
    const firstDay = toTaipeiDateKey(startedAt, mode);
    const lastDay = toTaipeiDateKey(completedAt, mode);
    const spanDays = Math.round((taipeiStartOfDate(lastDay).getTime()
      - taipeiStartOfDate(firstDay).getTime()) / (DAY_MINUTES * 60_000)) + 1;
    rows.push({
      animeSn: anime.animeSn,
      title: dataset.titleByAnimeSn.get(anime.animeSn) ?? anime.apiTitle,
      coverUrl: anime.coverUrl,
      episodeCount: refs.length,
      startedAt,
      completedAt,
      elapsedMinutes: endMinute - startMinute,
      spanDays,
      activeDayCount: new Set(facts.map((fact) => toTaipeiDateKey(fact.entry.watchedAt, mode))).size,
      episodesPerDay: refs.length / spanDays
    });
  }

  rows.sort((a, b) => b.episodesPerDay - a.episodesPerDay
    || a.elapsedMinutes - b.elapsedMinutes
    || a.completedAt.getTime() - b.completedAt.getTime()
    || a.animeSn - b.animeSn);
  let rank = 0;
  return rows.map((row, index) => {
    if (index === 0 || row.episodesPerDay !== rows[index - 1]!.episodesPerDay) rank = index + 1;
    return { ...row, rank };
  });
};

/**
 * Classify the final stretch, not the first-ever watch: catching up after weeks
 * of following a show is still a binge. Official dates take precedence. On the
 * ending day, an agreeing release timestamp can resolve date precision. If official facts
 * cannot establish a boundary, the last four distinct catalog episodes within
 * a rolling 168 hours are the internal proxy. Never export the decision method
 * into presentation payloads.
 */
const isBinge = (anime: AnimeMetadata, facts: readonly WatchFact[]): boolean => {
  // A positive official ongoing marker must not be overridden by the proxy.
  if (anime.isOngoing) return false;
  const tail = facts.slice(-TAIL_EPISODE_COUNT);
  const firstTailMinute = Math.min(...tail.map((fact) => fact.watchedMinute));
  const lastTailMinute = Math.max(...tail.map((fact) => fact.watchedMinute));
  const endDate = anime.seasonEndDateKey;
  if (endDate !== null) {
    const firstTailDate = toTaipeiDateKey(new Date(firstTailMinute * 60_000));
    if (firstTailDate !== endDate) return firstTailDate > endDate;
    const lastReleaseMinute = Math.max(...facts.map((fact) => fact.availableMinute!));
    if (toTaipeiDateKey(new Date(lastReleaseMinute * 60_000)) === endDate) {
      return firstTailMinute >= lastReleaseMinute;
    }
  }
  return tail.length === TAIL_EPISODE_COUNT
    && lastTailMinute - firstTailMinute <= 7 * DAY_MINUTES;
};
