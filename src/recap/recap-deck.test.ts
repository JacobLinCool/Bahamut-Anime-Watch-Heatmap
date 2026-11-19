import { describe, expect, it } from "vitest";

import type { AnalyticsResult, CompletionRow } from "../analytics";
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
  bingeResult,
  cover,
  coverage,
  dailyCountsFrom,
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
  it("shows a highlight only when it clears its bar, and at most two of them", () => {
    const base = fullResult();
    const moment = (animeSn: number, at: string) => ({
      animeSn,
      title: `作品 ${animeSn}`,
      episode: "第 1 集",
      coverUrl: cover(`moment-${animeSn}`),
      watchedAt: instant(at)
    });
    const oldWorks = (workCount: number, episodeCount: number) => ({
      workCount,
      episodeCount,
      datedEpisodeCount: 100,
      oldest: { animeSn: 9, title: "老作品", coverUrl: null, premiereYear: 2010 }
    });
    const summaryWith = (highlights: AnalyticsResult["highlights"]) => buildRecapDeck({ ...base, highlights }).summary.highlights;

    // 舊作太少、占比也低：不出現。
    expect(summaryWith({ newYearsEve: null, dawn: null, oldWorks: oldWorks(4, 10) })).toEqual([]);
    // 部數夠，或占比夠，擇一成立。
    expect(summaryWith({ newYearsEve: null, dawn: null, oldWorks: oldWorks(5, 10) }).map((item) => item.kind)).toEqual(["old-works"]);
    expect(summaryWith({ newYearsEve: null, dawn: null, oldWorks: oldWorks(2, 25) })[0]).toMatchObject({ kind: "old-works", episodeShare: 0.25 });

    const all = summaryWith({
      newYearsEve: { year: 2026, before: moment(1, "2025-12-31T23:50:00+08:00"), after: moment(2, "2026-01-01T00:30:00+08:00") },
      dawn: {
        startedAt: instant("2026-07-05T02:30:00+08:00"),
        endedAt: instant("2026-07-05T06:20:00+08:00"),
        episodeCount: 6,
        last: moment(3, "2026-07-05T06:20:00+08:00")
      },
      oldWorks: oldWorks(10, 30)
    });
    expect(all.map((item) => item.kind)).toEqual(["new-year", "dawn"]);
    expect(all[0]).toMatchObject({ before: { time: "23:50", dateLabel: "12/31" }, after: { time: "00:30", dateLabel: "1/1" } });
    expect(all[1]).toMatchObject({ startTime: "02:30", episodeCount: 6, last: { time: "06:20", dateLabel: "7/5" } });
  });

  it("lists each season's favorites and names a hidden gem only when one qualifies", () => {
    const base = fullResult();
    const pick = base.preference.rows[0]!;
    const seasons = (["winter", "spring", "summer"] as const).map((season, index) => ({
      year: 2026,
      season,
      choiceEventCount: 12,
      rows: index === 1 ? [] : [pick]
    }));
    const gem = {
      animeSn: pick.animeSn,
      title: pick.title,
      coverUrl: pick.coverUrl,
      cohortYear: 2026,
      cohortSeason: "summer" as const,
      cohortSize: 20,
      popularityRank: 15,
      cohortLeaderTitle: "大作",
      popularityRatio: 0.17
    };
    const deck = buildRecapDeck({ ...base, favorites: { seasons, hiddenGems: [gem] } });
    const preference = chapter(deck, "behavior-preference");
    expect(preference.title).toBe("每一季，你最先點開的作品");
    expect(preference.payload.seasons.map((season) => [season.label, season.rows.length])).toEqual([
      ["冬季", 1],
      ["春季", 0],
      ["夏季", 1]
    ]);
    const hidden = chapter(deck, "platform-taste");
    expect(hidden.title).toBe("《作品 A》是你的私藏");
    expect(hidden.narrative).toBe("有得選時你常常先點開它；但 2026 夏季開播、你也看過的 20 部作品裡，它的人氣只排第 15。");
    expect(hidden.payload.gems[0]?.cohortLabel).toBe("2026 夏季");

    // 沒有私藏：整章不出現，也不拿「你最常看」充數。
    const plain = buildRecapDeck({ ...base, favorites: { seasons: [], hiddenGems: [] } });
    expect(plain.chapters.some((item) => item.kind === "platform-taste")).toBe(false);
    expect(plain.omissions.find((item) => item.chapter === "platform-taste")?.reason).toBe("no-hidden-gem");
    expect(chapter(plain, "behavior-preference").title).toBe("有得選時，你最常先看《作品 A》");
  });

  it("sorts started works into finished, nearly, midway and dropped, and keeps airing ones apart", () => {
    const base = fullResult();
    const row = (animeSn: number, watched: number, total: number, outcome: CompletionRow["outcome"], isOngoing = false): CompletionRow => ({
      animeSn,
      title: `作品 ${animeSn}`,
      coverUrl: cover(`work-${animeSn}`),
      watchedEpisodeCount: watched,
      totalEpisode: total,
      ratio: watched / total,
      isOngoing,
      outcome
    });
    const tag = (label: string, startedCount: number, droppedCount: number) =>
      ({ label, startedCount, droppedCount, dropRate: droppedCount / startedCount });
    const rows = [
      row(1, 12, 12, "finished"), row(2, 12, 12, "finished"), row(3, 24, 24, "finished"),
      row(4, 10, 12, "nearly"), row(5, 12, 13, "nearly"),
      row(6, 7, 12, "midway"),
      row(7, 1, 12, "dropped"), row(8, 3, 12, "dropped"),
      row(9, 5, 24, "unknown-start"),
      row(10, 7, 7, "caught-up", true), row(11, 3, 7, "behind", true)
    ];
    const deck = buildRecapDeck({
      ...base,
      completion: {
        available: true,
        rows,
        // 整體放棄 2/8＝25%：校園 50% 夠高、動作 0% 夠低，戀愛 25% 跟整體一樣不提。
        dropTags: [tag("校園", 8, 4), tag("戀愛", 8, 2), tag("動作", 8, 0)]
      }
    });
    const completion = chapter(deck, "completion");
    expect(completion.payload).toMatchObject({
      startedCount: 8,
      finishedCount: 3,
      nearlyCount: 2,
      midwayCount: 1,
      droppedCount: 2,
      tastedCount: 1,
      airingCount: 2,
      caughtUpCount: 1,
      mostDroppedTag: { label: "校園", droppedCount: 4 },
      leastDroppedTag: { label: "動作", droppedCount: 0 }
    });
    // 差得最少的在前：只差 1 集的排在差 2 集的前面。
    expect(completion.payload.nearlyRows.map((item) => item.animeSn)).toEqual([5, 4]);
    expect(completion.title).toBe("你把 3 部作品從頭看到尾");
    expect(completion.narrative).toBe("從第 1 集開始看、已完結的 8 部作品裡，有 38% 一集不漏。");

    // 類型之間差不多時，不硬挑一個說。
    const flat = buildRecapDeck({ ...base, completion: { available: true, rows, dropTags: [tag("校園", 8, 2), tag("動作", 8, 2)] } });
    expect(chapter(flat, "completion").payload).toMatchObject({ mostDroppedTag: null, leastDroppedTag: null });

    // 只有還在播的作品：改說追到最新。
    const airingOnly = buildRecapDeck({ ...base, completion: { available: true, rows: rows.slice(-2), dropTags: [] } });
    expect(chapter(airingOnly, "completion").payload).toMatchObject({ startedCount: 0, caughtUpCount: 1 });
    expect(chapter(airingOnly, "completion").title).toContain("追到最新");
  });

  it("features the highest daily episode rate rather than the shortest season duration", () => {
    const source = bingeResult();
    const deck = buildRecapDeck(source);
    const insight = chapter(deck, "binge");
    const kinds = deck.chapters.map((item) => item.kind);
    expect(kinds.indexOf("binge")).toBe(kinds.indexOf("completion") + 1);
    expect(insight.payload.completedCount).toBe(2);
    expect(insight.payload.rows[0]).toEqual({
      rank: 1,
      animeSn: 40,
      title: "補番作品 B",
      coverUrl: cover("binge-b"),
      episodesPerDay: 3
    });
    expect(insight.title).toContain("補番作品 B");
    expect(insight.narrative).toContain("補完了 2 部");
    expect(insight.narrative).not.toMatch(/耗時|最快的一部|12 集|24 集/);
    expect(deck.summary.covers.map((row) => row.animeSn)).toContain(30);
    const fingerprint = deck.fingerprint;
    const changed = {
      ...source,
      binge: { ...source.binge, rows: source.binge.rows.map((row, index) => index === 0 ? { ...row, episodesPerDay: 4 } : row) }
    };
    expect(insight.payload.rows[0]!.episodesPerDay).toBe(3);
    expect(buildRecapDeck(changed).fingerprint).not.toBe(fingerprint);
  });

  it("omits the binge chapter and its covers when no season qualifies", () => {
    const result = bingeResult();
    for (const available of [false, true]) {
      const deck = buildRecapDeck({ ...result, binge: { available, rows: [] } });
      expect(deck.chapters.some((item) => item.kind === "binge")).toBe(false);
      expect(deck.omissions).toContainEqual(expect.objectContaining({
        chapter: "binge",
        reason: "no-binge-completions"
      }));
      expect(deck.summary.covers.some((row) => row.animeSn === 30)).toBe(false);
    }
  });

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
    expect(seasons.narrative).toBe("各看了 4 集。");
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
    expect(Object.isFrozen(deck.summary.calendar?.days)).toBe(true);

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
      completion: { available: false, rows: [], dropTags: [] },
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
    expect(first.fingerprint).toMatch(/^recap-v9:[a-f0-9]{64}$/);
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

    // 結尾海報的熱度圖把每天的集數凍進 deck：哪一天多看一集就是另一份回顧。
    const calendarResult = fullResult();
    const calendarChanged: AnalyticsResult = {
      ...calendarResult,
      dailyCounts: calendarResult.dailyCounts.map((day) => day.dateKey === "2026-03-01" ? { ...day, count: 1 } : day)
    };
    expect(buildRecapDeck(calendarChanged).fingerprint).not.toBe(baselineFingerprint);

    // 儀表板的月節奏不在海報與章節上：只改它不改變 fingerprint。
    const rhythmOnly: AnalyticsResult = {
      ...fullResult(),
      rhythm: fullResult().rhythm.map((point) => ({ ...point, count: point.count + 1, contentMinutes: (point.contentMinutes ?? 0) + 5 }))
    };
    expect(buildRecapDeck(rhythmOnly).fingerprint).toBe(baselineFingerprint);
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
  completion: { available: false, rows: [], dropTags: [] },
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
    expect(summary.calendar?.days).toHaveLength(365);
    expect(summary.calendar).toMatchObject({
      activeDayCount: 9,
      peak: { dateKey: "2026-07-04", count: 4 },
      // 依上架時間時，連續幾天有上架不是觀看習慣：不畫最長連續。
      longestStreak: null
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
    expect(summary.persona?.primary.key).toBe("night-owl");
    expect(summary.calendar?.activeDayCount).toBe(9);
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

  it("falls back to the episode count when runtime is unavailable", () => {
    const result = fullResult();
    const deck = buildRecapDeck({
      ...result,
      summary: { ...result.summary, knownContentMinutes: 0, contentMinutes: null },
      runtime: { available: false, coverage: coverage(0, 12, false), rows: [], longestEpisode: null }
    });
    expect(deck.summary.hero).toEqual({ kind: "watch-count", count: 12 });
  });

  it("omits the calendar when the period has no plays to draw", () => {
    const deck = buildRecapDeck({
      ...fullResult(),
      dailyCounts: dailyCountsFrom("2026-01-01", 31, {})
    });
    expect(deck.summary.calendar).toBeNull();
  });

  it("marks the longest watching streak by watch date, keeping the earliest of equal runs and peaks", () => {
    const watched: AnalysisScope = {
      axis: "watched-at",
      dayBoundaryMode: "thirty-hour",
      period: { kind: "calendar-month", year: 2026, month: 6 }
    };
    const deck = buildRecapDeck({
      ...fullResult(),
      scope: watched,
      period: resolvePeriod(watched, instant("2026-08-01T12:00:00+08:00")),
      dailyCounts: dailyCountsFrom("2026-06-01", 30, {
        "2026-06-02": 3, "2026-06-03": 1, "2026-06-04": 2,
        "2026-06-10": 3,
        "2026-06-20": 1, "2026-06-21": 1, "2026-06-22": 1
      })
    });
    expect(deck.summary.calendar).toMatchObject({
      activeDayCount: 7,
      peak: { dateKey: "2026-06-02", count: 3 },
      longestStreak: { fromDateKey: "2026-06-02", toDateKey: "2026-06-04", days: 3 }
    });
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
  const completion = (started: number, finished: number, tasted: number): RecapPresentationChapter => stub("completion", {
    startedCount: started,
    finishedCount: finished,
    nearlyCount: 0,
    midwayCount: 0,
    droppedCount: started - finished,
    tastedCount: tasted,
    airingCount: 0,
    caughtUpCount: 0,
    nearlyRows: [],
    mostDroppedTag: null,
    leastDroppedTag: null,
    tagDrops: []
  });
  const platform = (popularityRank: number, popularityRatio: number): RecapPresentationChapter => stub("platform-taste", {
    gems: [{
      animeSn: 7,
      title: "私藏",
      coverUrl: null,
      cohortYear: 2026,
      cohortSeason: "summer",
      cohortSize: 20,
      popularityRank,
      cohortLeaderTitle: "大作",
      popularityRatio,
      cohortLabel: "2026 夏季"
    }]
  });

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
      curatorShortfall: 0.5,
      curatorStrongShortfall: 0.9
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
    // 私藏本身已經要求偏心又冷門：有私藏就成立，強度看它比同季最熱門的少多少。
    expect(evaluateRecapPersona([platform(15, 0.5)])?.primary).toMatchObject({
      key: "curator",
      strength: 0,
      reason: "你最先點開的《私藏》，同季你看的 20 部裡人氣只排第 15"
    });
    expect(evaluateRecapPersona([platform(19, 0.1)])?.primary.strength).toBe(1);
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
    const persona = evaluateRecapPersona([marathon(15), completion(10, 5, 4), platform(15, 0.3)]);
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
