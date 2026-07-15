import type { DayBoundaryMode } from "./model";

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

type CalendarDate = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
};

export const getTaipeiCalendarDate = (instant: Date): CalendarDate => {
  const shifted = new Date(instant.getTime() + TAIPEI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
};

export const toTaipeiDateKey = (instant: Date, mode: DayBoundaryMode = "calendar"): string => {
  const boundaryShiftMs = mode === "thirty-hour" ? 6 * 60 * 60 * 1000 : 0;
  return formatCalendarDate(getTaipeiCalendarDate(new Date(instant.getTime() - boundaryShiftMs)));
};

export const addTaipeiCalendarDays = (dateKey: string, days: number): string => {
  const date = parseDateKey(dateKey);
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return formatCalendarDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  });
};

export const taipeiStartOfDate = (dateKey: string): Date => {
  const date = parseDateKey(dateKey);
  return new Date(Date.UTC(date.year, date.month - 1, date.day) - TAIPEI_OFFSET_MS);
};

export const taipeiWeekday = (dateKey: string): number => {
  const date = parseDateKey(dateKey);
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
};

export const dateFromTaipeiParts = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): Date | null => {
  if (![year, month, day, hour, minute].every(Number.isInteger)
    || month < 1 || month > 12
    || day < 1 || day > 31
    || hour < 0 || hour > 23
    || minute < 0 || minute > 59) {
    return null;
  }

  const timestamp = Date.UTC(year, month - 1, day, hour - 8, minute);
  const instant = new Date(timestamp);
  const shifted = new Date(timestamp + TAIPEI_OFFSET_MS);
  if (shifted.getUTCFullYear() !== year
    || shifted.getUTCMonth() + 1 !== month
    || shifted.getUTCDate() !== day
    || shifted.getUTCHours() !== hour
    || shifted.getUTCMinutes() !== minute) {
    return null;
  }

  return instant;
};

export const parseDateKey = (dateKey: string): CalendarDate => {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) {
    throw new Error(`無效日期鍵：${dateKey}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const valid = dateFromTaipeiParts(year, month, day, 0, 0);
  if (!valid) {
    throw new Error(`無效日期鍵：${dateKey}`);
  }

  return { year, month, day };
};

const formatCalendarDate = ({ year, month, day }: CalendarDate): string => {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};
