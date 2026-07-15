import type { DayBoundaryMode } from "./model";
import {
  addTaipeiCalendarDays,
  getTaipeiCalendarDate,
  parseDateKey,
  taipeiStartOfDate,
  toTaipeiDateKey
} from "./time";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;
const MIN_SUPPORTED_YEAR = 1000;
const MAX_SUPPORTED_YEAR = 9999;

export const CALENDAR_SEASONS = ["winter", "spring", "summer", "autumn"] as const;

export type CalendarSeason = typeof CALENDAR_SEASONS[number];
export type AnalysisAxis = "watched-at" | "released-at";

export type CalendarSeasonReference = {
  readonly year: number;
  readonly season: CalendarSeason;
};

export type PeriodDefinition =
  | {
      readonly kind: "rolling-days";
      readonly days: 30 | 365;
    }
  | {
      readonly kind: "calendar-month";
      readonly year: number;
      readonly month: number;
    }
  | {
      readonly kind: "calendar-season";
      readonly year: number;
      readonly season: CalendarSeason;
    }
  | {
      readonly kind: "calendar-year";
      readonly year: number;
    };

export type AnalysisAxisConfiguration =
  | {
      readonly axis: "watched-at";
      readonly dayBoundaryMode: DayBoundaryMode;
    }
  | {
      readonly axis: "released-at";
    };

export type AnalysisScope =
  | {
      readonly axis: "watched-at";
      readonly dayBoundaryMode: DayBoundaryMode;
      readonly period: PeriodDefinition;
    }
  | {
      readonly axis: "released-at";
      readonly period: PeriodDefinition;
    };

export type TimeRange = {
  readonly startInclusive: Date;
  readonly endExclusive: Date;
};

export type ResolvedPeriod = {
  readonly scope: AnalysisScope;
  readonly key: string;
  readonly label: string;
  readonly periodStatus: "closed" | "to-date";
  readonly fullRange: TimeRange;
  readonly effectiveRange: TimeRange;
  readonly constituentSeasons: readonly CalendarSeasonReference[];
};

export type AnalysisScopeOption = {
  readonly scope: AnalysisScope;
  readonly key: string;
  readonly label: string;
  readonly periodStatus: ResolvedPeriod["periodStatus"];
};

export type AnalysisScopeOptionGroupId =
  | "rolling"
  | "calendar-seasons"
  | "calendar-years"
  | "calendar-months";

export type AnalysisScopeOptionGroup = {
  readonly id: AnalysisScopeOptionGroupId;
  readonly label: string;
  readonly options: readonly AnalysisScopeOption[];
};

export type AnalysisScopeOptionRequest = {
  readonly asOf: Date;
  readonly axis: AnalysisAxisConfiguration;
  readonly recentMonthCount?: number;
  readonly recentSeasonCount?: number;
  readonly recentYearCount?: number;
};

export const createAnalysisScope = (
  axis: AnalysisAxisConfiguration,
  period: PeriodDefinition
): AnalysisScope => axis.axis === "watched-at"
  ? { axis: axis.axis, dayBoundaryMode: axis.dayBoundaryMode, period }
  : { axis: axis.axis, period };

export const analysisScopeKey = (scope: AnalysisScope): string => {
  assertAnalysisScope(scope);
  const axisKey = scope.axis === "watched-at"
    ? `${scope.axis}:${scope.dayBoundaryMode}`
    : scope.axis;
  return `${axisKey}:${periodKey(scope.period)}`;
};

export const analysisScopeLabel = (scope: AnalysisScope, asOf: Date): string =>
  resolvePeriod(scope, asOf).label;

/**
 * Resolves a period as a half-open interval. Calendar boundaries are Asia/Taipei
 * boundaries. The 30-hour offset is valid only for watched-at scopes; official
 * release periods always use natural midnight boundaries.
 */
export const resolvePeriod = (scope: AnalysisScope, asOf: Date): ResolvedPeriod => {
  assertAnalysisScope(scope);
  assertValidDate(asOf, "asOf");

  const currentDate = calendarDateForScope(asOf, scope);
  if (scope.period.kind === "rolling-days") {
    const currentDateKey = formatDateKey(currentDate.year, currentDate.month, currentDate.day);
    const startDateKey = addTaipeiCalendarDays(currentDateKey, -(scope.period.days - 1));
    const fullRange = {
      startInclusive: logicalDayStart(startDateKey, scope),
      endExclusive: nextMinuteExclusive(asOf)
    };
    return {
      scope,
      key: analysisScopeKey(scope),
      label: periodBaseLabel(scope.period),
      periodStatus: "to-date",
      fullRange,
      effectiveRange: cloneTimeRange(fullRange),
      constituentSeasons: []
    };
  }

  const boundaries = calendarPeriodBoundaries(scope.period);
  const fullRange: TimeRange = {
    startInclusive: logicalDayStart(boundaries.startDateKey, scope),
    endExclusive: logicalDayStart(boundaries.endDateKeyExclusive, scope)
  };
  if (asOf.getTime() < fullRange.startInclusive.getTime()) {
    throw new RangeError(`${periodBaseLabel(scope.period)}尚未開始`);
  }

  const periodStatus: ResolvedPeriod["periodStatus"] = asOf.getTime() >= fullRange.endExclusive.getTime()
    ? "closed"
    : "to-date";
  const effectiveRange: TimeRange = periodStatus === "closed"
    ? cloneTimeRange(fullRange)
    : {
        startInclusive: fullRange.startInclusive,
        endExclusive: new Date(Math.min(
          fullRange.endExclusive.getTime(),
          nextMinuteExclusive(asOf).getTime()
        ))
      };

  return {
    scope,
    key: analysisScopeKey(scope),
    label: formatResolvedLabel(scope.period, periodStatus, currentDate),
    periodStatus,
    fullRange,
    effectiveRange,
    constituentSeasons: constituentSeasons(scope.period)
  };
};

export const classifyReleaseAtTaipei = (releasedAt: Date): CalendarSeasonReference => {
  assertValidDate(releasedAt, "releasedAt");
  const { year, month } = getTaipeiCalendarDate(releasedAt);
  return { year, season: calendarSeasonForMonth(month) };
};

export const getAnalysisScopeOptionGroups = (
  request: AnalysisScopeOptionRequest
): readonly AnalysisScopeOptionGroup[] => {
  assertValidDate(request.asOf, "asOf");
  assertAxisConfiguration(request.axis);
  const monthCount = validatedOptionCount(request.recentMonthCount ?? 12, "recentMonthCount");
  const seasonCount = validatedOptionCount(request.recentSeasonCount ?? 8, "recentSeasonCount");
  const yearCount = validatedOptionCount(request.recentYearCount ?? 2, "recentYearCount");
  const current = calendarDateForAxis(request.asOf, request.axis);
  const currentSeason = calendarSeasonForMonth(current.month);

  const rollingPeriods: readonly PeriodDefinition[] = [
    { kind: "rolling-days", days: 30 },
    { kind: "rolling-days", days: 365 }
  ];
  const seasonPeriods = Array.from({ length: seasonCount }, (_, offset): PeriodDefinition => {
    const value = shiftCalendarSeason(current.year, currentSeason, -offset);
    return { kind: "calendar-season", year: value.year, season: value.season };
  });
  const yearPeriods = Array.from({ length: yearCount }, (_, offset): PeriodDefinition => ({
    kind: "calendar-year",
    year: current.year - offset
  }));
  const monthPeriods = Array.from({ length: monthCount }, (_, offset): PeriodDefinition => {
    const value = shiftCalendarMonth(current.year, current.month, -offset);
    return { kind: "calendar-month", year: value.year, month: value.month };
  });

  return [
    optionGroup("rolling", "快速範圍", rollingPeriods, request.axis, request.asOf),
    optionGroup("calendar-seasons", "季度", seasonPeriods, request.axis, request.asOf),
    optionGroup("calendar-years", "年度", yearPeriods, request.axis, request.asOf),
    optionGroup("calendar-months", "月份", monthPeriods, request.axis, request.asOf)
  ];
};

const optionGroup = (
  id: AnalysisScopeOptionGroupId,
  label: string,
  periods: readonly PeriodDefinition[],
  axis: AnalysisAxisConfiguration,
  asOf: Date
): AnalysisScopeOptionGroup => ({
  id,
  label,
  options: periods.map((period): AnalysisScopeOption => {
    const scope = createAnalysisScope(axis, period);
    const resolved = resolvePeriod(scope, asOf);
    return {
      scope,
      key: resolved.key,
      label: resolved.label,
      periodStatus: resolved.periodStatus
    };
  })
});

const calendarPeriodBoundaries = (
  period: Exclude<PeriodDefinition, { readonly kind: "rolling-days" }>
): { readonly startDateKey: string; readonly endDateKeyExclusive: string } => {
  if (period.kind === "calendar-month") {
    const next = shiftCalendarMonth(period.year, period.month, 1);
    return {
      startDateKey: formatDateKey(period.year, period.month, 1),
      endDateKeyExclusive: formatDateKey(next.year, next.month, 1)
    };
  }

  if (period.kind === "calendar-season") {
    const startMonth = seasonStartMonth(period.season);
    const next = shiftCalendarMonth(period.year, startMonth, 3);
    return {
      startDateKey: formatDateKey(period.year, startMonth, 1),
      endDateKeyExclusive: formatDateKey(next.year, next.month, 1)
    };
  }

  return {
    startDateKey: formatDateKey(period.year, 1, 1),
    endDateKeyExclusive: formatDateKey(period.year + 1, 1, 1)
  };
};

const constituentSeasons = (period: PeriodDefinition): readonly CalendarSeasonReference[] => {
  if (period.kind === "calendar-season") {
    return [{ year: period.year, season: period.season }];
  }
  if (period.kind === "calendar-year") {
    return CALENDAR_SEASONS.map((season) => ({ year: period.year, season }));
  }
  return [];
};

const periodKey = (period: PeriodDefinition): string => {
  assertPeriodDefinition(period);
  switch (period.kind) {
    case "rolling-days":
      return `rolling:${period.days}`;
    case "calendar-month":
      return `month:${period.year}-${String(period.month).padStart(2, "0")}`;
    case "calendar-season":
      return `season:${period.year}-${period.season}`;
    case "calendar-year":
      return `year:${period.year}`;
  }
};

const periodBaseLabel = (period: PeriodDefinition): string => {
  switch (period.kind) {
    case "rolling-days":
      return period.days === 30 ? "近 30 日" : "過去一年";
    case "calendar-month":
      return `${period.year} 年 ${period.month} 月`;
    case "calendar-season":
      return `${period.year} 年${seasonLabel(period.season)}`;
    case "calendar-year":
      return `${period.year} 年`;
  }
};

const formatResolvedLabel = (
  period: PeriodDefinition,
  status: ResolvedPeriod["periodStatus"],
  currentDate: { readonly month: number; readonly day: number }
): string => {
  const base = periodBaseLabel(period);
  return status === "to-date"
    ? `${base}（截至 ${currentDate.month} 月 ${currentDate.day} 日）`
    : base;
};

const seasonLabel = (season: CalendarSeason): string => {
  switch (season) {
    case "winter": return "冬季";
    case "spring": return "春季";
    case "summer": return "夏季";
    case "autumn": return "秋季";
  }
};

const calendarSeasonForMonth = (month: number): CalendarSeason => {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`無效月份：${month}`);
  }
  if (month <= 3) return "winter";
  if (month <= 6) return "spring";
  if (month <= 9) return "summer";
  return "autumn";
};

const seasonStartMonth = (season: CalendarSeason): number => {
  switch (season) {
    case "winter": return 1;
    case "spring": return 4;
    case "summer": return 7;
    case "autumn": return 10;
  }
};

const shiftCalendarSeason = (
  year: number,
  season: CalendarSeason,
  offset: number
): CalendarSeasonReference => {
  const seasonIndex = CALENDAR_SEASONS.indexOf(season);
  const absoluteIndex = year * 4 + seasonIndex + offset;
  const shiftedYear = Math.floor(absoluteIndex / 4);
  const shiftedSeason = CALENDAR_SEASONS[((absoluteIndex % 4) + 4) % 4];
  if (shiftedSeason === undefined) {
    throw new Error("季度位移結果無效");
  }
  assertYear(shiftedYear, "季度年份");
  return { year: shiftedYear, season: shiftedSeason };
};

const shiftCalendarMonth = (
  year: number,
  month: number,
  offset: number
): { readonly year: number; readonly month: number } => {
  assertYear(year, "年份");
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(offset)) {
    throw new RangeError(`無效月份位移：${year}-${month}, ${offset}`);
  }
  const absoluteMonth = year * 12 + month - 1 + offset;
  const shiftedYear = Math.floor(absoluteMonth / 12);
  const shiftedMonth = ((absoluteMonth % 12) + 12) % 12 + 1;
  assertYear(shiftedYear, "月份位移年份");
  return { year: shiftedYear, month: shiftedMonth };
};

const calendarDateForScope = (
  instant: Date,
  scope: AnalysisScope
): { readonly year: number; readonly month: number; readonly day: number } =>
  calendarDateForAxis(instant, scope.axis === "watched-at"
    ? { axis: scope.axis, dayBoundaryMode: scope.dayBoundaryMode }
    : { axis: scope.axis });

const calendarDateForAxis = (
  instant: Date,
  axis: AnalysisAxisConfiguration
): { readonly year: number; readonly month: number; readonly day: number } => {
  if (axis.axis === "released-at") {
    return getTaipeiCalendarDate(instant);
  }
  return parseDateKey(toTaipeiDateKey(instant, axis.dayBoundaryMode));
};

const logicalDayStart = (dateKey: string, scope: AnalysisScope): Date => {
  const offset = scope.axis === "watched-at" && scope.dayBoundaryMode === "thirty-hour"
    ? SIX_HOURS_MS
    : 0;
  return new Date(taipeiStartOfDate(dateKey).getTime() + offset);
};

const nextMinuteExclusive = (instant: Date): Date => {
  const timestamp = (Math.floor(instant.getTime() / ONE_MINUTE_MS) + 1) * ONE_MINUTE_MS;
  const result = new Date(timestamp);
  assertValidDate(result, "asOf 的下一分鐘");
  return result;
};

const cloneTimeRange = (range: TimeRange): TimeRange => ({
  startInclusive: new Date(range.startInclusive.getTime()),
  endExclusive: new Date(range.endExclusive.getTime())
});

const formatDateKey = (year: number, month: number, day: number): string => {
  assertYear(year, "年份");
  const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  parseDateKey(key);
  return key;
};

const assertAnalysisScope = (scope: AnalysisScope): void => {
  if (scope.axis === "watched-at") {
    if (scope.dayBoundaryMode !== "calendar" && scope.dayBoundaryMode !== "thirty-hour") {
      throw new RangeError(`無效觀看日界線：${String(scope.dayBoundaryMode)}`);
    }
  } else if (scope.axis !== "released-at") {
    throw new RangeError(`無效分析時間軸：${String((scope as { readonly axis?: unknown }).axis)}`);
  }
  assertPeriodDefinition(scope.period);
};

const assertAxisConfiguration = (axis: AnalysisAxisConfiguration): void => {
  if (axis.axis === "watched-at") {
    if (axis.dayBoundaryMode !== "calendar" && axis.dayBoundaryMode !== "thirty-hour") {
      throw new RangeError(`無效觀看日界線：${String(axis.dayBoundaryMode)}`);
    }
    return;
  }
  if (axis.axis !== "released-at") {
    throw new RangeError(`無效分析時間軸：${String((axis as { readonly axis?: unknown }).axis)}`);
  }
};

const assertPeriodDefinition = (period: PeriodDefinition): void => {
  switch (period.kind) {
    case "rolling-days":
      if (period.days !== 30 && period.days !== 365) {
        throw new RangeError(`無效 rolling days：${String(period.days)}`);
      }
      return;
    case "calendar-month":
      assertYear(period.year, "月份年份");
      if (!Number.isInteger(period.month) || period.month < 1 || period.month > 12) {
        throw new RangeError(`無效分析月份：${period.year}-${period.month}`);
      }
      return;
    case "calendar-season":
      assertYear(period.year, "季度年份");
      if (!CALENDAR_SEASONS.includes(period.season)) {
        throw new RangeError(`無效季度：${String(period.season)}`);
      }
      return;
    case "calendar-year":
      assertYear(period.year, "年度年份");
      return;
    default:
      throw new RangeError(`無效分析期間：${String((period as { readonly kind?: unknown }).kind)}`);
  }
};

const validatedOptionCount = (value: number, name: string): number => {
  if (!Number.isInteger(value) || value < 1 || value > 120) {
    throw new RangeError(`${name} 必須是 1 到 120 的整數`);
  }
  return value;
};

const assertYear = (year: number, label: string): void => {
  if (!Number.isInteger(year) || year < MIN_SUPPORTED_YEAR || year > MAX_SUPPORTED_YEAR) {
    throw new RangeError(`${label}必須是 ${MIN_SUPPORTED_YEAR} 到 ${MAX_SUPPORTED_YEAR} 的整數`);
  }
};

const assertValidDate = (date: Date, label: string): void => {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError(`${label} 必須是有效日期`);
  }
};
