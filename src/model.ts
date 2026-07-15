export type DayBoundaryMode = "calendar" | "thirty-hour";

export type WatchEntry = {
  readonly videoSn: number;
  readonly dateKey: string;
  readonly watchedAt: Date;
  readonly title: string;
  readonly episode: string;
};

export type EpisodeMetadata = {
  readonly videoSn: number;
  readonly animeSn: number;
  /** Exact key of the containing anime.episodes group returned by the API. */
  readonly groupKey: string;
  readonly episodeIndex: number;
  readonly episodeNumber: number;
  readonly availableFrom: Date;
  readonly availableUntil: Date | null;
  readonly durationMinutes: number;
  readonly coverUrl: string | null;
  readonly videoType: number;
  readonly fetchedAt: Date;
};

export type EpisodeRef = {
  readonly videoSn: number;
  readonly episodeNumber: number;
  readonly groupKey: string;
  readonly coverUrl: string | null;
};

export type AnimePlatformSnapshot = {
  readonly score: number;
  readonly reviewCount: number;
  readonly popular: number;
  readonly observedAt: Date;
};

export type AnimeMetadata = {
  readonly animeSn: number;
  readonly apiTitle: string;
  readonly totalEpisode: number;
  readonly seasonStartDateKey: string | null;
  readonly seasonEndDateKey: string | null;
  readonly coverUrl: string | null;
  readonly tags: readonly string[];
  readonly maker: string | null;
  readonly director: string | null;
  readonly publisher: string | null;
  readonly episodeRefs: readonly EpisodeRef[];
  readonly platformSnapshot: AnimePlatformSnapshot;
  readonly fetchedAt: Date;
};

export type MetadataBundle = {
  readonly episode: EpisodeMetadata;
  readonly anime: AnimeMetadata;
};

export type MetadataIssueKind =
  | "unavailable"
  | "network"
  | "http"
  | "invalid-response"
  | "invalid-cache";

export type MetadataIssue = {
  readonly videoSn: number;
  readonly kind: MetadataIssueKind;
  readonly message: string;
};

export type MetadataProgress = {
  readonly phase: "idle" | "resolving" | "complete" | "aborted";
  readonly total: number;
  readonly completed: number;
  readonly available: number;
  readonly unavailable: number;
  readonly failed: number;
};

export type MetadataState = {
  readonly episodes: ReadonlyMap<number, EpisodeMetadata>;
  readonly anime: ReadonlyMap<number, AnimeMetadata>;
  readonly issues: readonly MetadataIssue[];
  readonly progress: MetadataProgress;
};

export const emptyMetadataState = (): MetadataState => ({
  episodes: new Map(),
  anime: new Map(),
  issues: [],
  progress: {
    phase: "idle",
    total: 0,
    completed: 0,
    available: 0,
    unavailable: 0,
    failed: 0
  }
});
