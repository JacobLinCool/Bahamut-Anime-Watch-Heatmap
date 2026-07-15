import { describe, expect, it } from "vitest";

import {
  analysisScopeKey,
  analysisScopeLabel,
  classifyReleaseAtTaipei,
  createAnalysisScope,
  getAnalysisScopeOptionGroups,
  resolvePeriod,
  type AnalysisAxisConfiguration,
  type AnalysisScope,
  type CalendarSeasonReference,
  type PeriodDefinition
} from "./period";

const instant = (value: string): Date => new Date(value);

const releasedScope = (period: PeriodDefinition): AnalysisScope => ({
  axis: "released-at",
  period
});

const watchedScope = (
  period: PeriodDefinition,
  dayBoundaryMode: "calendar" | "thirty-hour" = "calendar"
): AnalysisScope => ({
  axis: "watched-at",
  dayBoundaryMode,
  period
});

describe("Taipei release season classification", () => {
  it.each([
    ["2026-03-31T15:59:59.999Z", { year: 2026, season: "winter" }],
    ["2026-03-31T16:00:00.000Z", { year: 2026, season: "spring" }],
    ["2026-06-30T15:59:59.999Z", { year: 2026, season: "spring" }],
    ["2026-06-30T16:00:00.000Z", { year: 2026, season: "summer" }],
    ["2026-09-30T15:59:59.999Z", { year: 2026, season: "summer" }],
    ["2026-09-30T16:00:00.000Z", { year: 2026, season: "autumn" }],
    ["2026-12-31T15:59:59.999Z", { year: 2026, season: "autumn" }],
    ["2026-12-31T16:00:00.000Z", { year: 2027, season: "winter" }]
  ] as const)("classifies %s using natural Taipei boundaries", (value, expected) => {
    expect(classifyReleaseAtTaipei(instant(value))).toEqual<CalendarSeasonReference>(expected);
  });

  it("rejects an invalid release instant", () => {
    expect(() => classifyReleaseAtTaipei(new Date(Number.NaN))).toThrow(/releasedAt/);
  });
});

describe("period resolution", () => {
  it("resolves a closed leap year and exposes its exact four seasons", () => {
    const result = resolvePeriod(
      releasedScope({ kind: "calendar-year", year: 2024 }),
      instant("2025-01-02T00:00:00+08:00")
    );

    expect(result.periodStatus).toBe("closed");
    expect(result.fullRange.startInclusive.toISOString()).toBe("2023-12-31T16:00:00.000Z");
    expect(result.fullRange.endExclusive.toISOString()).toBe("2024-12-31T16:00:00.000Z");
    expect((result.fullRange.endExclusive.getTime() - result.fullRange.startInclusive.getTime()) / 86_400_000).toBe(366);
    expect(result.effectiveRange).toEqual(result.fullRange);
    expect(result.constituentSeasons).toEqual([
      { year: 2024, season: "winter" },
      { year: 2024, season: "spring" },
      { year: 2024, season: "summer" },
      { year: 2024, season: "autumn" }
    ]);
  });

  it("truncates the current season at the next minute and labels it to-date", () => {
    const asOf = instant("2026-07-14T15:30:45+08:00");
    const result = resolvePeriod(
      releasedScope({ kind: "calendar-season", year: 2026, season: "summer" }),
      asOf
    );

    expect(result.periodStatus).toBe("to-date");
    expect(result.fullRange.startInclusive.toISOString()).toBe("2026-06-30T16:00:00.000Z");
    expect(result.fullRange.endExclusive.toISOString()).toBe("2026-09-30T16:00:00.000Z");
    expect(result.effectiveRange.endExclusive.toISOString()).toBe("2026-07-14T07:31:00.000Z");
    expect(result.label).toBe("2026 年夏季（截至 7 月 14 日）");
    expect(result.constituentSeasons).toEqual([{ year: 2026, season: "summer" }]);
  });

  it("rejects calendar periods that have not started", () => {
    const asOf = instant("2026-07-14T12:00:00+08:00");
    expect(() => resolvePeriod(
      releasedScope({ kind: "calendar-season", year: 2026, season: "autumn" }),
      asOf
    )).toThrow(/尚未開始/);
    expect(() => resolvePeriod(
      releasedScope({ kind: "calendar-year", year: 2027 }),
      asOf
    )).toThrow(/尚未開始/);
  });

  it("uses logical days for watched-at rolling periods", () => {
    const asOf = instant("2026-07-01T02:15:10+08:00");
    const calendar = resolvePeriod(
      watchedScope({ kind: "rolling-days", days: 30 }, "calendar"),
      asOf
    );
    const thirtyHour = resolvePeriod(
      watchedScope({ kind: "rolling-days", days: 30 }, "thirty-hour"),
      asOf
    );

    expect(calendar.effectiveRange.startInclusive.toISOString()).toBe("2026-06-01T16:00:00.000Z");
    expect(thirtyHour.effectiveRange.startInclusive.toISOString()).toBe("2026-05-31T22:00:00.000Z");
    expect(calendar.effectiveRange.endExclusive.toISOString()).toBe("2026-06-30T18:16:00.000Z");
    expect(thirtyHour.effectiveRange.endExclusive.toISOString()).toBe("2026-06-30T18:16:00.000Z");
  });

  it("never applies the 30-hour boundary to released-at periods", () => {
    const asOf = instant("2026-07-01T02:00:00+08:00");
    const releasedJuly = resolvePeriod(
      releasedScope({ kind: "calendar-month", year: 2026, month: 7 }),
      asOf
    );
    const watchedJune = resolvePeriod(
      watchedScope({ kind: "calendar-month", year: 2026, month: 6 }, "thirty-hour"),
      asOf
    );

    expect(releasedJuly.periodStatus).toBe("to-date");
    expect(releasedJuly.fullRange.startInclusive.toISOString()).toBe("2026-06-30T16:00:00.000Z");
    expect(watchedJune.periodStatus).toBe("to-date");
    expect(watchedJune.fullRange.endExclusive.toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(() => resolvePeriod(
      watchedScope({ kind: "calendar-month", year: 2026, month: 7 }, "thirty-hour"),
      asOf
    )).toThrow(/尚未開始/);
  });
});

describe("scope descriptors", () => {
  it("uses stable axis-aware keys and resolved labels", () => {
    const asOf = instant("2026-07-14T12:00:00+08:00");
    const watched = watchedScope(
      { kind: "calendar-month", year: 2026, month: 7 },
      "thirty-hour"
    );
    const released = releasedScope({ kind: "calendar-season", year: 2026, season: "summer" });

    expect(analysisScopeKey(watched)).toBe("watched-at:thirty-hour:month:2026-07");
    expect(analysisScopeKey(released)).toBe("released-at:season:2026-summer");
    expect(analysisScopeLabel(released, asOf)).toBe("2026 年夏季（截至 7 月 14 日）");
    expect(analysisScopeKey(createAnalysisScope(
      { axis: "released-at" },
      { kind: "rolling-days", days: 365 }
    ))).toBe("released-at:rolling:365");
  });

  it("returns explicitly identified groups instead of positional option semantics", () => {
    const axis: AnalysisAxisConfiguration = { axis: "released-at" };
    const groups = getAnalysisScopeOptionGroups({
      asOf: instant("2026-07-14T12:00:00+08:00"),
      axis,
      recentMonthCount: 2,
      recentSeasonCount: 3,
      recentYearCount: 2
    });

    expect(groups.map((group) => ({
      id: group.id,
      label: group.label,
      count: group.options.length
    }))).toEqual([
      { id: "rolling", label: "快速範圍", count: 2 },
      { id: "calendar-seasons", label: "季度", count: 3 },
      { id: "calendar-years", label: "年度", count: 2 },
      { id: "calendar-months", label: "月份", count: 2 }
    ]);

    const seasonGroup = groups.find((group) => group.id === "calendar-seasons");
    expect(seasonGroup?.options.map((option) => ({ key: option.key, label: option.label }))).toEqual([
      { key: "released-at:season:2026-summer", label: "2026 年夏季（截至 7 月 14 日）" },
      { key: "released-at:season:2026-spring", label: "2026 年春季" },
      { key: "released-at:season:2026-winter", label: "2026 年冬季" }
    ]);

    const yearGroup = groups.find((group) => group.id === "calendar-years");
    expect(yearGroup?.options.map((option) => option.label)).toEqual([
      "2026 年（截至 7 月 14 日）",
      "2025 年"
    ]);
  });

  it("generates the effective prior month and season before 06:00 in 30-hour mode", () => {
    const groups = getAnalysisScopeOptionGroups({
      asOf: instant("2026-07-01T02:00:00+08:00"),
      axis: { axis: "watched-at", dayBoundaryMode: "thirty-hour" },
      recentMonthCount: 1,
      recentSeasonCount: 1,
      recentYearCount: 1
    });

    expect(groups.find((group) => group.id === "calendar-months")?.options[0]?.key)
      .toBe("watched-at:thirty-hour:month:2026-06");
    expect(groups.find((group) => group.id === "calendar-seasons")?.options[0]?.key)
      .toBe("watched-at:thirty-hour:season:2026-spring");
  });
});
