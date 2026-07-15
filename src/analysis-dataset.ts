import type {
  AnimeMetadata,
  EpisodeMetadata,
  WatchEntry
} from "./model";
import { analysisScopeKey, type AnalysisScope, type ResolvedPeriod } from "./period";

export type WatchFact = {
  readonly entry: WatchEntry;
  readonly watchedMinute: number;
  readonly episode: EpisodeMetadata | null;
  readonly anime: AnimeMetadata | null;
  readonly animeSn: number | null;
  readonly availableMinute: number | null;
  readonly releaseValid: boolean;
  readonly preferenceValid: boolean;
  readonly negativeLag: boolean;
};

export type AnalysisDataset = {
  readonly scope: AnalysisScope;
  readonly period: ResolvedPeriod;
  /** The authoritative metadata catalogs used to enrich watched facts. */
  readonly episodes: ReadonlyMap<number, EpisodeMetadata>;
  readonly anime: ReadonlyMap<number, AnimeMetadata>;
  readonly events: readonly WatchFact[];
  readonly canonical: readonly WatchFact[];
  readonly selectedEvents: readonly WatchFact[];
  readonly selectedCanonical: readonly WatchFact[];
  readonly unclassified: readonly WatchFact[];
  readonly titleByAnimeSn: ReadonlyMap<number, string>;
};

export const buildAnalysisDataset = ({
  entries,
  episodes,
  anime,
  scope,
  period,
  asOf
}: {
  readonly entries: readonly WatchEntry[];
  readonly episodes: ReadonlyMap<number, EpisodeMetadata>;
  readonly anime: ReadonlyMap<number, AnimeMetadata>;
  readonly scope: AnalysisScope;
  readonly period: ResolvedPeriod;
  readonly asOf: Date;
}): AnalysisDataset => {
  assertValidDate(asOf, "asOf");
  if (period.key !== analysisScopeKey(scope)) {
    throw new Error("分析期間與 scope 不一致");
  }
  const asOfMinute = toEpochMinute(asOf);
  const events = entries
    .filter((entry) => validEntry(entry) && toEpochMinute(entry.watchedAt) <= asOfMinute)
    .map((entry) => buildWatchFact(entry, episodes, anime))
    .sort(compareWatchFacts);
  const canonical = canonicalize(events);
  const selectedEvents = events.filter((fact) => factInScope(fact, scope, period));
  const selectedCanonical = canonical.filter((fact) => factInScope(fact, scope, period));
  const unclassified = (scope.axis === "released-at" ? canonical : selectedCanonical)
    .filter((fact) => !fact.releaseValid);

  return {
    scope,
    period,
    episodes,
    anime,
    events,
    canonical,
    selectedEvents,
    selectedCanonical,
    unclassified,
    titleByAnimeSn: buildTitleIndex(events)
  };
};

export const factInScope = (
  fact: WatchFact,
  scope: AnalysisScope,
  period: ResolvedPeriod
): boolean => {
  const instant = scope.axis === "watched-at"
    ? fact.entry.watchedAt
    : fact.releaseValid && fact.episode
      ? fact.episode.availableFrom
      : null;
  if (!instant) {
    return false;
  }
  const timestamp = instant.getTime();
  return timestamp >= period.effectiveRange.startInclusive.getTime()
    && timestamp < period.effectiveRange.endExclusive.getTime();
};

const buildWatchFact = (
  entry: WatchEntry,
  episodes: ReadonlyMap<number, EpisodeMetadata>,
  anime: ReadonlyMap<number, AnimeMetadata>
): WatchFact => {
  const candidateEpisode = episodes.get(entry.videoSn);
  const episode = candidateEpisode
    && candidateEpisode.videoSn === entry.videoSn
    && positiveSafeInteger(candidateEpisode.animeSn)
    && validDate(candidateEpisode.availableFrom)
    && validDate(candidateEpisode.fetchedAt)
    ? candidateEpisode
    : null;
  const candidateAnime = episode ? anime.get(episode.animeSn) : undefined;
  const animeRecord = candidateAnime
    && candidateAnime.animeSn === episode?.animeSn
    && validDate(candidateAnime.fetchedAt)
    ? candidateAnime
    : null;
  const watchedMinute = toEpochMinute(entry.watchedAt);
  const availableMinute = episode ? toEpochMinute(episode.availableFrom) : null;
  const negativeLag = availableMinute !== null && availableMinute > watchedMinute;
  const releaseValid = episode !== null && availableMinute !== null && !negativeLag;
  const preferenceValid = releaseValid
    && Number.isSafeInteger(episode.episodeIndex)
    && episode.episodeIndex >= 0
    && Number.isSafeInteger(episode.episodeNumber)
    && episode.episodeNumber > 0
    && episode.groupKey.trim().length > 0;

  return {
    entry,
    watchedMinute,
    episode,
    anime: animeRecord,
    animeSn: episode?.animeSn ?? null,
    availableMinute,
    releaseValid,
    preferenceValid,
    negativeLag
  };
};

const canonicalize = (events: readonly WatchFact[]): readonly WatchFact[] => {
  const earliestByVideoSn = new Map<number, WatchFact>();
  for (const fact of events) {
    const existing = earliestByVideoSn.get(fact.entry.videoSn);
    if (!existing || compareWatchFacts(fact, existing) < 0) {
      earliestByVideoSn.set(fact.entry.videoSn, fact);
    }
  }
  return [...earliestByVideoSn.values()].sort(compareWatchFacts);
};

const buildTitleIndex = (facts: readonly WatchFact[]): ReadonlyMap<number, string> => {
  const countsByAnime = new Map<number, Map<string, number>>();
  for (const fact of facts) {
    if (fact.animeSn === null) {
      continue;
    }
    const title = fact.entry.title.trim();
    if (!title) {
      continue;
    }
    const counts = countsByAnime.get(fact.animeSn) ?? new Map<string, number>();
    counts.set(title, (counts.get(title) ?? 0) + 1);
    countsByAnime.set(fact.animeSn, counts);
  }

  return new Map(Array.from(countsByAnime, ([animeSn, counts]) => {
    const title = [...counts]
      .sort((left, right) => right[1] - left[1]
        || left[0].localeCompare(right[0], "zh-Hant-TW"))[0]?.[0] ?? "";
    return [animeSn, title] as const;
  }));
};

const validEntry = (entry: WatchEntry): boolean => positiveSafeInteger(entry.videoSn)
  && validDate(entry.watchedAt);

const compareWatchFacts = (left: WatchFact, right: WatchFact): number =>
  left.watchedMinute - right.watchedMinute
  || left.entry.videoSn - right.entry.videoSn
  || left.entry.title.localeCompare(right.entry.title, "zh-Hant-TW")
  || left.entry.episode.localeCompare(right.entry.episode, "zh-Hant-TW");

const toEpochMinute = (date: Date): number => Math.floor(date.getTime() / 60_000);
const positiveSafeInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;
const validDate = (date: Date): boolean => date instanceof Date && Number.isFinite(date.getTime());

const assertValidDate = (date: Date, label: string): void => {
  if (!validDate(date)) {
    throw new TypeError(`${label} 必須是有效 Date`);
  }
};
