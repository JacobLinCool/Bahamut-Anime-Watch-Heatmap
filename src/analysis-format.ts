import type { CoverageResult } from "./analytics";

const dateFormatter = new Intl.DateTimeFormat("zh-TW", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Taipei"
});

const integerFormatter = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 });

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

const stripTrailingZero = (value: number): string => new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 1
}).format(value);

/** Clamps display copy (titles woven into sentences) so one runaway string can't bury the layout. */
export const truncateText = (text: string, maxCharacters: number): string => {
  const characters = [...text];
  if (characters.length <= maxCharacters) return text;
  return `${characters.slice(0, Math.max(1, maxCharacters - 1)).join("").trimEnd()}…`;
};
