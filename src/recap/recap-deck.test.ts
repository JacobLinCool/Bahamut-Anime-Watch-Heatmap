import { describe, expect, it } from "vitest";

import type { AnalyticsResult } from "../analytics";
import { resolvePeriod, type AnalysisScope } from "../period";
import {
  buildRecapDeck,
  joinWithSpacing,
  type RecapPresentationChapter,
  type RecapPresentationDeck
} from "./recap-deck";
import { evaluateRecapPersona, RECAP_PERSONA_THRESHOLDS } from "./recap-summary";
import { initialRecapUiState, reduceRecapUiState, type RecapUiState } from "./recap-state";
import {
  cover,
  coverage,
  fullResult,
  instant,
  resolvedPeriod,
  seasonRow,
  watchedRollingYearScope
} from "./recap-test-fixtures";

const chapter = <Kind extends RecapPresentationChapter["kind"]>(
  deck: RecapPresentationDeck,
  kind: Kind
): Extract<RecapPresentationChapter, { readonly kind: Kind }> => {
  const value = deck.chapters.find((candidate) => candidate.kind === kind);
  if (!value || value.kind !== kind) throw new Error(`missing ${kind} chapter`);
  return value as Extract<RecapPresentationChapter, { readonly kind: Kind }>;
};

describe("recap presentation deck", () => {
  it("builds release-calendar-year chapters in presentation order", () => {
    const deck = buildRecapDeck(fullResult());
    expect(deck.chapters.map((item) => item.kind)).toEqual([
      "overview",
      "season-breakdown",
      "habit-clock",
      "marathon",
      "runtime",
      "taste",
      "completion",
      "timeliness",
      "behavior-preference"
    ]);
    expect(deck.scope).toMatchObject({
      key: "released-at:year:2026",
      axis: "released-at",
      period: { kind: "calendar-year", year: 2026 }
    });

    const overview = chapter(deck, "overview");
    expect(overview.payload).toMatchObject({ watchCount: 12, activeDayCount: 9 });

    const seasons = chapter(deck, "season-breakdown");
    expect(seasons.payload.leadingSeasons).toEqual(["summer"]);
    // 期間標籤以數字開頭：中文與英數之間要有空白。
    expect(seasons.title).toBe("你最常看 2026 summer 上架的動畫");
    expect(seasons.payload.rows.map((row) => [row.season, row.watchCount])).toEqual([
      ["winter", 3],
      ["spring", 2],
      ["summer", 5],
      ["autumn", 2]
    ]);

    const runtime = chapter(deck, "runtime");
    expect(runtime.payload.totalContentMinutes).toBe(366);
    expect(runtime.payload.longestEpisode).toMatchObject({
      videoSn: 101,
      durationMinutes: 89,
      watchedAtIso: "2026-07-14T02:00:00.000Z"
    });
    expect(runtime.narrative).toContain("6 小時 6 分鐘");

    expect(chapter(deck, "timeliness").payload.rows[0]).toMatchObject({
      title: "作品 A",
      medianLagMinutes: 90
    });
    expect(chapter(deck, "behavior-preference").payload.rows[0]).toMatchObject({
      title: "作品 A",
      wins: 9,
      comparisons: 10
    });
    expect(chapter(deck, "taste").payload.tags[0]).toMatchObject({
      label: "懸疑",
      knownContentMinutes: 240
    });
  });

  it("uses the same insight chapters for a watched-at rolling 365-day recap", () => {
    const result = fullResult();
    const scope = watchedRollingYearScope();
    const watchedRollingYear: AnalyticsResult = {
      ...result,
      scope,
      period: resolvedPeriod(scope, "過去一年")
    };
    const deck = buildRecapDeck(watchedRollingYear);

    expect(deck.chapters.map((item) => item.kind)).toEqual([
      "overview",
      "habit-clock",
      "marathon",
      "runtime",
      "taste",
      "completion",
      "timeliness",
      "behavior-preference"
    ]);
    expect(deck.omissions).toContainEqual(expect.objectContaining({
      chapter: "season-breakdown",
      reason: "not-release-calendar-year"
    }));

  });

  it("keeps every tied leading release season in calendar order", () => {
    const result = fullResult();
    const tied: AnalyticsResult = {
      ...result,
      seasonBreakdown: [
        seasonRow("winter", 4, 90),
        seasonRow("spring", 2, 50),
        seasonRow("summer", 4, 160),
        seasonRow("autumn", 2, 66)
      ]
    };
    const seasons = chapter(buildRecapDeck(tied), "season-breakdown");

    expect(seasons.payload.leadingSeasons).toEqual(["winter", "summer"]);
    expect(seasons.narrative).toBe("各有 4 次觀看。");
  });

  it("deep-freezes the complete presentation graph and detaches it from source rows", () => {
    const source = fullResult();
    const deck = buildRecapDeck(source);
    expect(Object.isFrozen(deck)).toBe(true);
    expect(Object.isFrozen(deck.scope)).toBe(true);
    expect(Object.isFrozen(deck.chapters)).toBe(true);
    expect(Object.isFrozen(deck.chapters[0])).toBe(true);
    expect(Object.isFrozen(deck.chapters[0]?.payload)).toBe(true);
    expect(Object.isFrozen(deck.chapters[0]?.evidence)).toBe(true);
    expect(Object.isFrozen(deck.omissions)).toBe(true);
    expect(Object.isFrozen(deck.summary)).toBe(true);
    expect(Object.isFrozen(deck.summary.covers)).toBe(true);
    expect(Object.isFrozen(deck.summary.persona)).toBe(true);
    expect(Object.isFrozen(deck.summary.rhythm?.points)).toBe(true);

    const mutableRows = source.runtime.rows as Array<AnalyticsResult["runtime"]["rows"][number]>;
    mutableRows[0] = { ...mutableRows[0]!, title: "被外部改寫" };
    expect(chapter(deck, "runtime").payload.rows[0]?.title).toBe("作品 A");
  });

  it("preserves typed chapter payloads when the state reducer snapshots the deck", () => {
    const deck = buildRecapDeck(fullResult());
    let state: RecapUiState<RecapPresentationDeck> = initialRecapUiState;
    state = reduceRecapUiState(state, { type: "OPEN", surface: "recap" });
    state = reduceRecapUiState(state, { type: "START_RECAP", deck });
    expect(state.kind).toBe("recap-chapter");
    if (state.kind !== "recap-chapter") throw new Error("expected recap chapter");
    expect(state.deck.chapters[0]?.kind).toBe("overview");
    expect(chapter(state.deck, "overview").payload.watchCount).toBe(12);
  });
});

describe("scope-aware chapters", () => {
  it("uses the same builder for a season but never invents a four-season breakdown", () => {
    const result = fullResult();
    const scope: AnalysisScope = {
      axis: "released-at",
      period: { kind: "calendar-season", year: 2026, season: "summer" }
    };
    const seasonal: AnalyticsResult = {
      ...result,
      scope,
      period: resolvedPeriod(scope, "2026 年夏季")
    };
    const deck = buildRecapDeck(seasonal);
    expect(deck.chapters.some((item) => item.kind === "season-breakdown")).toBe(false);
    expect(deck.chapters.some((item) => item.kind === "runtime")).toBe(true);
    expect(deck.omissions).toContainEqual(expect.objectContaining({
      chapter: "season-breakdown",
      reason: "not-release-calendar-year"
    }));
  });

  it("does not call watched-at calendar-year rows a release-year four-season union", () => {
    const result = fullResult();
    const scope: AnalysisScope = {
      axis: "watched-at",
      dayBoundaryMode: "calendar",
      period: { kind: "calendar-year", year: 2026 }
    };
    const watched: AnalyticsResult = {
      ...result,
      scope,
      period: resolvedPeriod(scope, "2026 年")
    };
    const deck = buildRecapDeck(watched);
    expect(deck.chapters.some((item) => item.kind === "season-breakdown")).toBe(false);
  });

  it("keeps a useful annual breakdown when some episodes cannot be assigned to a season", () => {
    const result = fullResult();
    const inconsistent: AnalyticsResult = {
      ...result,
      seasonBreakdown: result.seasonBreakdown.map((row) => row.season === "summer"
        ? { ...row, watchCount: row.watchCount - 1 }
        : row)
    };
    const deck = buildRecapDeck(inconsistent);
    expect(chapter(deck, "season-breakdown").payload.rows.map((row) => row.watchCount)).toEqual([3, 2, 4, 2]);
  });
});

describe("evidence gates", () => {
  it("shows runtime from known episodes without extrapolating missing duration", () => {
    const result = fullResult();
    const partial: AnalyticsResult = {
      ...result,
      summary: {
        ...result.summary,
        knownContentMinutes: 300,
        contentMinutes: null,
        durationCoverage: coverage(11, 12, false)
      },
      seasonBreakdown: result.seasonBreakdown.map((row) => row.season === "autumn"
        ? { ...row, contentMinutes: null, durationCoverage: coverage(1, 2, false) }
        : row),
      runtime: {
        ...result.runtime,
        available: true,
        coverage: coverage(11, 12, false),
      }
    };
    const deck = buildRecapDeck(partial);
    const runtime = chapter(deck, "runtime");
    expect(runtime.payload.totalContentMinutes).toBe(300);
    expect(runtime.narrative).toContain("5 小時");
    expect(chapter(deck, "season-breakdown").payload.rows.find(
      (row) => row.season === "autumn"
    )?.contentMinutes).toBeNull();
  });

  it("independently omits insights with no usable rows", () => {
    const result = fullResult();
    const gated: AnalyticsResult = {
      ...result,
      catalog: {
        animeCoverage: coverage(2, 3, false),
        tags: [],
        makers: [],
        directors: [],
        publishers: []
      },
      completion: { available: false, rows: [] },
      habitClock: {
        available: false,
        hourCounts: Array.from({ length: 24 }, () => 0),
        peakHour: null,
        peakHourCount: 0,
        segments: [],
        topSegment: null,
        weekdayCounts: Array.from({ length: 7 }, () => 0),
        topWeekday: null
      },
      marathon: { available: false, peakDay: null, longestStreak: null, topSingleDayRun: null },
      timeliness: { available: false, coverage: coverage(8, 12, false), rows: [] },
      preference: {
        available: false,
        coverage: coverage(8, 12, false),
        choiceEventCount: 0,
        rows: []
      }
    };
    const deck = buildRecapDeck(gated);
    expect(deck.chapters.map((item) => item.kind)).toEqual([
      "overview",
      "season-breakdown",
      "runtime"
    ]);
    expect(deck.omissions.map((item) => [item.chapter, item.reason])).toEqual(expect.arrayContaining([
      ["timeliness", "insufficient-timeliness"],
      ["behavior-preference", "insufficient-preference"],
      ["taste", "no-taste-dimensions"]
    ]));
  });

  it("does not suppress factual chapters when history or metadata coverage is partial", () => {
    const result = fullResult();
    const deck = buildRecapDeck({
      ...result,
      historyComplete: false,
      summary: {
        ...result.summary,
        durationCoverage: coverage(6, 12, false),
        releaseCoverage: coverage(6, 12, false)
      },
      runtime: { ...result.runtime, coverage: coverage(6, 12, false) },
      catalog: { ...result.catalog, animeCoverage: coverage(2, 3, false) },
      timeliness: { ...result.timeliness, coverage: coverage(6, 12, false) },
      preference: { ...result.preference, coverage: coverage(6, 12, false) }
    });

    expect(deck.chapters.map((item) => item.kind)).toEqual([
      "overview",
      "season-breakdown",
      "habit-clock",
      "marathon",
      "runtime",
      "taste",
      "completion",
      "timeliness",
      "behavior-preference"
    ]);
  });
});

describe("fingerprint", () => {
  it("is deterministic for equal analytics values", () => {
    const first = buildRecapDeck(fullResult());
    const second = buildRecapDeck(fullResult());
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprint).toMatch(/^recap-v6:[a-f0-9]{64}$/);
  });

  it("changes for substantive analytic and metadata-derived presentation changes", () => {
    const baseline = fullResult();
    const baselineFingerprint = buildRecapDeck(baseline).fingerprint;

    const runtimeChanged: AnalyticsResult = {
      ...fullResult(),
      summary: { ...fullResult().summary, contentMinutes: 367, knownContentMinutes: 367 }
    };
    expect(buildRecapDeck(runtimeChanged).fingerprint).not.toBe(baselineFingerprint);

    const coverResult = fullResult();
    const coverChanged: AnalyticsResult = {
      ...coverResult,
      runtime: {
        ...coverResult.runtime,
        rows: coverResult.runtime.rows.map((row, index) => index === 0
          ? { ...row, coverUrl: cover("new-cover") }
          : row)
      }
    };
    expect(buildRecapDeck(coverChanged).fingerprint).not.toBe(baselineFingerprint);

    const tagResult = fullResult();
    const tagChanged: AnalyticsResult = {
      ...tagResult,
      catalog: {
        ...tagResult.catalog,
        tags: tagResult.catalog.tags.map((row, index) => index === 0
          ? { ...row, label: "科幻" }
          : row)
      }
    };
    expect(buildRecapDeck(tagChanged).fingerprint).not.toBe(baselineFingerprint);

    // 結尾海報的節奏條把 rhythm 凍進 deck：節奏改變就是另一份回顧（schema v5 起的刻意變更）。
    const rhythmResult = fullResult();
    const rhythmChanged: AnalyticsResult = {
      ...rhythmResult,
      rhythm: rhythmResult.rhythm.map((point, index) => index === 0
        ? { ...point, count: point.count + 1 }
        : point)
    };
    expect(buildRecapDeck(rhythmChanged).fingerprint).not.toBe(baselineFingerprint);

    // 只影響分鐘數、不在海報與章節上的欄位，仍不改變 fingerprint。
    const minutesOnly: AnalyticsResult = {
      ...fullResult(),
      rhythm: fullResult().rhythm.map((point) => ({ ...point, contentMinutes: (point.contentMinutes ?? 0) + 5 }))
    };
    expect(buildRecapDeck(minutesOnly).fingerprint).toBe(baselineFingerprint);
  });

  it("ignores the as-of minute of a to-date range but not a change of shown dates", () => {
    // 保存的紀錄換成剛讀到的頁面時，滾動期間的結束時間往前推了 20 分鐘，內容完全一樣。
    const endingAt = (iso: string): AnalyticsResult => {
      const result = fullResult();
      return {
        ...result,
        period: {
          ...result.period,
          periodStatus: "to-date",
          effectiveRange: { startInclusive: result.period.effectiveRange.startInclusive, endExclusive: instant(iso) }
        }
      };
    };
    const cached = buildRecapDeck(endingAt("2026-10-16T12:00:00+08:00"));
    const refreshed = buildRecapDeck(endingAt("2026-10-16T12:20:00+08:00"));
    expect(refreshed.scope.endExclusiveIso).not.toBe(cached.scope.endExclusiveIso);
    expect(refreshed.fingerprint).toBe(cached.fingerprint);
    // 跨日後海報上的日期範圍不同：這才是另一份回顧。
    expect(buildRecapDeck(endingAt("2026-10-17T12:00:00+08:00")).fingerprint).not.toBe(cached.fingerprint);
  });
});

const withoutMetadata = (result: AnalyticsResult): AnalyticsResult => ({
  ...result,
  scope: watchedRollingYearScope(),
  period: resolvedPeriod(watchedRollingYearScope(), "過去一年"),
  summary: { ...result.summary, animeCount: 0, knownContentMinutes: 0, contentMinutes: null, medianLagMinutes: null, within24HoursCount: null, within24HoursRate: null },
  runtime: { available: false, coverage: coverage(0, 12, false), rows: [], longestEpisode: null },
  catalog: { animeCoverage: coverage(0, 3, false), tags: [], makers: [], directors: [], publishers: [] },
  completion: { available: false, rows: [] },
  timeliness: { available: false, coverage: coverage(0, 12, false), rows: [] },
  preference: { available: false, coverage: coverage(0, 12, false), choiceEventCount: 0, rows: [] },
  marathon: { ...result.marathon, topSingleDayRun: null }
});

describe("summary poster payload", () => {
  it("freezes a rich summary built from the chapters it recalls", () => {
    const deck = buildRecapDeck(fullResult());
    const summary = deck.summary;
    expect(summary.title).toBe("2026 年度回顧");
    expect(summary.rangeLabel).toBe("2026/01/01–2026/12/31");
    expect(summary.hero).toEqual({ kind: "known-runtime", minutes: 366 });
    // 拼貼以作品去重：同一部作品出現在多章也只放一張。
    expect(summary.covers.map((item) => item.animeSn)).toEqual([10, 20]);
    expect(summary.ledger).toMatchObject({ chapterId: "runtime", metric: "known-minutes", label: "片長排行" });
    expect(summary.ledger?.rows.map((row) => [row.title, row.value, row.watchCount])).toEqual([
      ["作品 A", 210, 6],
      ["作品 B", 100, 4]
    ]);
    expect(summary.rhythm).toEqual({
      granularity: "month",
      points: [{ key: "2026-01", count: 2 }, { key: "2026-07", count: 5 }],
      peak: { key: "2026-07", count: 5 }
    });
    expect(summary.weekdayCounts).toEqual([0, 0, 0, 0, 0, 7, 5]);
    // 期間本身（含頭含尾）：觀看日占比與馬拉松時間軸的分母。
    expect(summary.period).toEqual({ startDateKey: "2026-01-01", endDateKey: "2026-12-31", dayCount: 365 });
    expect(summary.persona?.primary).toMatchObject({
      key: "fresh",
      label: "追新番派",
      reason: "75% 的觀看，在上架 24 小時內就按下播放",
      chapterId: "timeliness"
    });
    expect(summary.persona?.others.map((trait) => trait.key)).toEqual(["night-owl"]);
  });

  it("degrades to watch-history facts without inventing metadata metrics", () => {
    const deck = buildRecapDeck(withoutMetadata(fullResult()));
    expect(deck.chapters.map((item) => item.kind)).toEqual(["overview", "habit-clock", "marathon"]);
    const summary = deck.summary;
    expect(summary.hero).toEqual({ kind: "watch-count", count: 12 });
    expect(summary.covers).toEqual([]);
    expect(summary.ledger).toBeNull();
    expect(summary.persona?.primary.key).toBe("night-owl");
    expect(summary.rhythm?.points.length).toBe(2);
    // 辨識不出作品時，總覽不說「來自 0 部作品」。
    expect(chapter(deck, "overview").narrative).toBe("你看了 12 個不同單集。");
  });

  it("dates the poster by logical days in 30-hour mode", () => {
    // 30 小時制的月份是 6/1 06:00–7/1 06:00；海報要寫 6/1–6/30，和「共 30 天」一致。
    const month: AnalysisScope = {
      axis: "watched-at",
      dayBoundaryMode: "thirty-hour",
      period: { kind: "calendar-month", year: 2026, month: 6 }
    };
    const monthDeck = buildRecapDeck({
      ...fullResult(),
      scope: month,
      period: resolvePeriod(month, instant("2026-08-01T12:00:00+08:00"))
    });
    expect(monthDeck.summary.rangeLabel).toBe("2026/06/01–2026/06/30");
    expect(monthDeck.summary.period).toEqual({ startDateKey: "2026-06-01", endDateKey: "2026-06-30", dayCount: 30 });

    // 滾動一年在凌晨（仍屬前一個邏輯日）打開：結尾日期是邏輯日，天數剛好 365。
    const rolling: AnalysisScope = {
      axis: "watched-at",
      dayBoundaryMode: "thirty-hour",
      period: { kind: "rolling-days", days: 365 }
    };
    const rollingDeck = buildRecapDeck({
      ...fullResult(),
      scope: rolling,
      period: resolvePeriod(rolling, instant("2026-07-15T03:00:00+08:00"))
    });
    expect(rollingDeck.summary.rangeLabel).toBe("2025/07/15–2026/07/14");
    expect(rollingDeck.summary.period.dayCount).toBe(365);
  });

  it("labels a fallback ledger truthfully when runtime is unavailable", () => {
    const result = fullResult();
    const deck = buildRecapDeck({
      ...result,
      summary: { ...result.summary, knownContentMinutes: 0, contentMinutes: null },
      runtime: { available: false, coverage: coverage(0, 12, false), rows: [], longestEpisode: null }
    });
    expect(deck.summary.hero).toEqual({ kind: "watch-count", count: 12 });
    expect(deck.summary.ledger).toMatchObject({
      chapterId: "behavior-preference",
      metric: "win-rate",
      label: "有得選時最先看"
    });
    expect(deck.summary.ledger?.rows.map((row) => row.value)).toEqual([0.9, 0.5]);
  });

  it("omits the rhythm strip when the period has no plays to draw", () => {
    const deck = buildRecapDeck({
      ...fullResult(),
      rhythm: [{ label: "2026-01", count: 0, contentMinutes: 0 }]
    });
    expect(deck.summary.rhythm).toBeNull();
    const daily = buildRecapDeck({
      ...fullResult(),
      rhythm: [{ label: "2026-06-01", count: 1, contentMinutes: 23 }, { label: "2026-06-02", count: 3, contentMinutes: 69 }]
    });
    expect(daily.summary.rhythm).toMatchObject({ granularity: "day", peak: { key: "2026-06-02", count: 3 } });
  });

  it("draws a season's rhythm week by week and freezes it into the fingerprint", () => {
    const base = fullResult();
    const weekly = buildRecapDeck({
      ...base,
      weeklyRhythm: [
        { label: "2026-07-01", count: 2, contentMinutes: 48 },
        { label: "2026-07-08", count: 5, contentMinutes: 120 },
        { label: "2026-07-15", count: 0, contentMinutes: 0 }
      ]
    });
    expect(weekly.summary.rhythm).toMatchObject({ granularity: "week", peak: { key: "2026-07-08", count: 5 } });
    expect(weekly.summary.rhythm?.points).toHaveLength(3);
    expect(Object.isFrozen(weekly.summary.rhythm?.points)).toBe(true);
    // 換成週節奏就是不同的結尾內容：fingerprint 跟著變。
    expect(weekly.fingerprint).not.toBe(buildRecapDeck(base).fingerprint);
  });
});

describe("viewing persona rules", () => {
  const stub = <Kind extends RecapPresentationChapter["kind"]>(
    kind: Kind,
    payload: Extract<RecapPresentationChapter, { readonly kind: Kind }>["payload"]
  ): RecapPresentationChapter => ({
    id: kind,
    kind,
    title: kind,
    eyebrow: kind,
    narrative: "",
    evidence: [],
    payload
  }) as RecapPresentationChapter;

  const marathon = (episodes: number): RecapPresentationChapter => stub("marathon", {
    peakDay: { dateKey: "2026-07-04", watchCount: 9, knownContentMinutes: 0 },
    longestStreak: null,
    topSingleDayRun: { animeSn: 1, title: "作品", coverUrl: null, dateKey: "2026-07-04", watchCount: episodes }
  });
  const completion = (sampled: number, completed: number, tasted: number): RecapPresentationChapter =>
    stub("completion", { sampledCount: sampled, completedCount: completed, tastedCount: tasted, rows: [] });
  const platform = (personalWatchRank: number, gap: number): RecapPresentationChapter => {
    const row = {
      animeSn: 7,
      title: "私藏",
      coverUrl: null,
      personalWatchRank,
      personalWatchCount: 9,
      platformRank: personalWatchRank + gap,
      platformPopular: 100,
      gap
    };
    return stub("platform-taste", { rows: [row], hiddenGem: row, averageGap: gap });
  };

  const timeliness = (within24Hours: number, samples: number): RecapPresentationChapter => stub("timeliness", {
    overallMedianLagMinutes: 90,
    overallWithin24HoursCount: within24Hours,
    overallWithin24HoursRate: within24Hours / samples,
    rows: []
  });
  /** lateNight 次播放落在 01:00，其餘落在 20:00。 */
  const clock = (lateNight: number, total: number): RecapPresentationChapter => {
    const hourCounts = Array.from({ length: 24 }, (_, hour) => hour === 1 ? lateNight : hour === 20 ? total - lateNight : 0);
    const segment = (key: "late-night" | "evening", label: string, startHour: number, endHour: number, watchCount: number) =>
      ({ key, label, startHour, endHour, watchCount, share: watchCount / total });
    const segments = [
      segment("evening", "晚間", 18, 24, total - lateNight),
      segment("late-night", "深夜", 0, 5, lateNight)
    ];
    return stub("habit-clock", {
      hourCounts,
      peakHour: 1,
      peakHourCount: lateNight,
      segments,
      topSegment: segments[1]!,
      topWeekday: { weekday: 5, label: "週五", watchCount: total }
    });
  };

  it("pins the explicit thresholds", () => {
    expect(RECAP_PERSONA_THRESHOLDS).toEqual({
      freshWithin24HoursRate: 0.5,
      freshStrongRate: 0.9,
      freshMinSamples: 10,
      bingeSingleDayEpisodes: 6,
      bingeStrongEpisodes: 15,
      completistShare: 0.4,
      completistStrongShare: 0.8,
      completistMinCount: 3,
      samplerShare: 0.35,
      samplerStrongShare: 0.7,
      samplerMinCount: 3,
      nightOwlShare: 0.4,
      nightOwlStrongShare: 0.85,
      nightOwlMinWatches: 10,
      curatorMaxPersonalRank: 3,
      curatorMinGap: 20,
      curatorStrongGap: 100
    });
  });

  it("fires each rule exactly at its threshold and not below it", () => {
    expect(evaluateRecapPersona([marathon(5)])).toBeNull();
    expect(evaluateRecapPersona([marathon(6)])?.primary).toMatchObject({ key: "binge", strength: 0 });
    expect(evaluateRecapPersona([completion(10, 3, 0)])).toBeNull();
    expect(evaluateRecapPersona([completion(7, 3, 0)])?.primary.key).toBe("completist");
    expect(evaluateRecapPersona([completion(5, 2, 2)])).toBeNull();
    expect(evaluateRecapPersona([completion(6, 0, 3)])?.primary.key).toBe("sampler");
    expect(evaluateRecapPersona([timeliness(5, 10)])?.primary).toMatchObject({ key: "fresh", strength: 0 });
    expect(evaluateRecapPersona([timeliness(4, 10)])).toBeNull();
    expect(evaluateRecapPersona([clock(4, 10)])?.primary).toMatchObject({ key: "night-owl", strength: 0 });
    expect(evaluateRecapPersona([clock(3, 10)])).toBeNull();
    expect(evaluateRecapPersona([platform(4, 80)])).toBeNull();
    expect(evaluateRecapPersona([platform(3, 19)])).toBeNull();
    expect(evaluateRecapPersona([platform(3, 20)])?.primary).toMatchObject({
      key: "curator",
      reason: "你排第 3 的《私藏》，平台人氣只排第 23"
    });
  });

  it("needs a minimum sample before naming a share-based trait", () => {
    // 一兩次觀看就算全在上架當天、全在深夜，也還不構成「型態」。
    expect(evaluateRecapPersona([timeliness(1, 1)])).toBeNull();
    expect(evaluateRecapPersona([timeliness(9, 9)])).toBeNull();
    expect(evaluateRecapPersona([timeliness(10, 10)])?.primary).toMatchObject({
      key: "fresh",
      strength: 1,
      reason: "100% 的觀看，在上架 24 小時內就按下播放"
    });
    expect(evaluateRecapPersona([clock(2, 2)])).toBeNull();
    expect(evaluateRecapPersona([clock(9, 9)])).toBeNull();
    expect(evaluateRecapPersona([clock(10, 10)])?.primary).toMatchObject({ key: "night-owl", strength: 1 });
    expect(evaluateRecapPersona([timeliness(1, 1), clock(2, 2)])).toBeNull();
  });

  it("picks the strongest trait and keeps up to two more", () => {
    const persona = evaluateRecapPersona([marathon(15), completion(10, 5, 4), platform(1, 60)]);
    expect(persona?.primary).toMatchObject({ key: "binge", strength: 1 });
    expect(persona?.others.map((trait) => trait.key)).toEqual(["curator", "completist"]);
  });
});

describe("copy spacing", () => {
  it("adds a space only where CJK text meets latin letters or digits", () => {
    expect(joinWithSpacing("你最常看", "2025 夏季", "上架的動畫")).toBe("你最常看 2025 夏季上架的動畫");
    expect(joinWithSpacing("2025 冬季", "與", "2025 夏季")).toBe("2025 冬季與 2025 夏季");
    expect(joinWithSpacing("「奇幻」", "最常出現")).toBe("「奇幻」最常出現");
  });
});
