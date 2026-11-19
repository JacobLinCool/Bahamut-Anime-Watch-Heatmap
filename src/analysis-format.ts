import type { CoverageResult } from "./analytics";

const dateFormatter = new Intl.DateTimeFormat("zh-TW", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Taipei"
});

const integerFormatter = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 });

const snapshotTimeFormatter = new Intl.DateTimeFormat("zh-TW", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Taipei"
});

/**
 * 觀看誌裡的紀錄狀態：顯示的是先前保存的快照時，附上它截至的時間，
 * 讓「近 30 日」「過去一年」看得出是到哪一刻為止。
 */
export const formatHistoryNote = (note: string, savedSnapshotAt: Date | null): string =>
  savedSnapshotAt ? `${note} · 紀錄截至 ${snapshotTimeFormatter.format(savedSnapshotAt)}` : note;

export const formatInteger = (value: number): string => integerFormatter.format(value);

export const formatDuration = (minutes: number): string => {
  if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError("minutes 必須是非負數");
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (hours === 0) return `${remainder} 分鐘`;
  if (remainder === 0) return `${formatInteger(hours)} 小時`;
  return `${formatInteger(hours)} 小時 ${remainder} 分鐘`;
};

export const formatCompactDuration = (minutes: number): string => {
  if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError("minutes 必須是非負數");
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (hours === 0) return `${remainder} 分`;
  if (remainder === 0) return `${formatInteger(hours)} 小時`;
  return `${formatInteger(hours)} 小時 ${remainder} 分`;
};

/** Elapsed time between watch records, rather than the sum of episode lengths. */
export const formatBingeElapsed = (minutes: number): string => {
  if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError("minutes 必須是非負數");
  const rounded = Math.round(minutes);
  const days = Math.floor(rounded / (24 * 60));
  const hours = Math.floor((rounded % (24 * 60)) / 60);
  const remainder = rounded % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${formatInteger(days)} 天`);
  if (hours > 0) parts.push(`${hours} 小時`);
  if (remainder > 0 || parts.length === 0) parts.push(`${remainder} 分鐘`);
  return parts.join(" ");
};

export const formatEpisodesPerDay = (rate: number): string => {
  if (!Number.isFinite(rate) || rate < 0) throw new RangeError("rate 必須是非負數");
  if (rate > 0 && rate < 0.1) return "不到 0.1 集／日";
  return `${stripTrailingZero(rate)} 集／日`;
};

export const formatLag = (minutes: number): string => {
  if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError("lag 必須是非負數");
  if (minutes < 60) return `${Math.round(minutes)} 分鐘`;
  if (minutes < 24 * 60) return `${stripTrailingZero(minutes / 60)} 小時`;
  return `${stripTrailingZero(minutes / (24 * 60))} 天`;
};

export const formatPercent = (ratio: number, maximumFractionDigits = 0): string => {
  if (!Number.isFinite(ratio)) throw new RangeError("ratio 必須是有限數值");
  return new Intl.NumberFormat("zh-TW", {
    style: "percent",
    maximumFractionDigits
  }).format(ratio);
};

export const formatCoverage = (coverage: CoverageResult): string => coverage.ratio === null
  ? "沒有樣本"
  : `${formatInteger(coverage.numerator)} / ${formatInteger(coverage.denominator)}（${formatPercent(coverage.ratio)}）`;

export const formatTaipeiDate = (date: Date): string => dateFormatter.format(date);

export const formatHalfOpenRange = (startInclusive: Date, endExclusive: Date): string => {
  const endInclusive = new Date(endExclusive.getTime() - 1);
  return `${formatTaipeiDate(startInclusive)}–${formatTaipeiDate(endInclusive)}`;
};

/** 時刻一律兩位數（02:00），區間用 en dash：章節、資料依據與海報寫法一致。 */
export const formatClockHour = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

export const formatHourRange = (startHour: number, endHour: number): string =>
  `${formatClockHour(startHour)}–${formatClockHour(endHour)}`;

const stripTrailingZero = (value: number): string => new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 1
}).format(value);

/** Clamps display copy (titles woven into sentences) so one runaway string can't bury the layout. */
export const truncateText = (text: string, maxCharacters: number): string => {
  const characters = [...text];
  if (characters.length <= maxCharacters) return text;
  return `${characters.slice(0, Math.max(1, maxCharacters - 1)).join("").trimEnd()}…`;
};
