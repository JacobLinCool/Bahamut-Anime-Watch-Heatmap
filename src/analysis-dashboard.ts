import type {
  AnalyticsResult,
  DimensionRow,
  PreferenceRow,
  RhythmPoint,
  SeriesRuntimeRow,
  TimelinessRow
} from "./analytics";
import {
  formatCompactDuration,
  formatDuration,
  formatInteger,
  formatLag,
  formatPercent,
  truncateText
} from "./analysis-format";
import { createButton, createCover, element, textElement } from "./view-dom";

export type DashboardRenderOptions = {
  readonly result: AnalyticsResult;
  readonly onOpenRecap: () => void;
  readonly reveal?: boolean;
};

export const renderDashboard = (options: DashboardRenderOptions): HTMLElement => {
  const { result } = options;
  const root = element("div", "ani-dashboard");
  root.append(renderLede(result, options.onOpenRecap), renderGlance(result));

  const clusters = [
    renderCluster("01", "你的節奏", "你追的番在哪一季上架，又都在什麼時候看", [
      result.seasonBreakdown.length > 0 ? renderSeasonBreakdown(result) : null,
      result.rhythm.some((point) => point.count > 0)
        ? renderRhythm(result.rhythm, result.scope.axis)
        : null
    ]),
    renderCluster("02", "你看什麼", "你的口味，和花最多時間的作品", [
      hasTasteRows(result) ? renderTaste(result) : null,
      result.runtime.available ? renderRuntime(result) : null
    ]),
    renderCluster("03", "你怎麼選", "有得選時的取捨，和追番的速度", [
      result.preference.available ? renderPreference(result.preference.rows) : null,
      result.timeliness.available ? renderTimeliness(result.timeliness.rows) : null
    ], true),
    renderCluster("04", "和平台比", "你最常看的，和平台熱門一不一樣", [
      result.currentPlatformSnapshotComparison.available ? renderPlatformComparison(result) : null
    ])
  ];
  for (const cluster of clusters) if (cluster) root.append(cluster);

  if (options.reveal) {
    root.classList.add("ani-dashboard--reveal");
    Array.from(root.children).forEach((child, index) => {
      if (child instanceof HTMLElement) child.style.setProperty("--ani-order", String(index));
    });
    // Rows and cards cascade within their group; the index restarts per parent
    // so every module reads as its own small wave.
    const staggered = root.querySelectorAll<HTMLElement>([
      ".ani-dashboard-stat",
      ".ani-dashboard-season-card",
      ".ani-dashboard-ranked-row",
      ".ani-dashboard-platform-row",
      ".ani-dashboard-footprint-row",
      ".ani-dashboard-compact-list li"
    ].join(", "));
    for (const node of staggered) {
      const index = node.parentElement ? Array.from(node.parentElement.children).indexOf(node) : 0;
      node.style.setProperty("--ani-stagger", String(Math.min(Math.max(0, index), 9)));
    }
  }
  return root;
};

const renderLede = (result: AnalyticsResult, onOpenRecap: () => void): HTMLElement => {
  const lede = element("section", "ani-dashboard-lede");
  const copy = element("div", "ani-dashboard-lede-copy");
  const axis = result.scope.axis === "watched-at" ? "依你的觀看時間" : "依每集實際上架時間";
  copy.append(
    textElement("p", "ani-dashboard-eyebrow", axis),
    textElement("h3", "ani-dashboard-lede-headline", ledeHeadline(result)),
    textElement(
      "p",
      "ani-dashboard-lede-caption",
      `${formatInteger(result.summary.watchCount)} 次觀看 · ${formatInteger(result.summary.animeCount)} 部作品 · ${formatInteger(result.summary.activeDayCount)} 天`
    )
  );
  const insights = renderLedeInsights(result);
  if (insights) copy.append(insights);
  const action = createButton("ani-dashboard-recap-button", "看看這段回顧");
  action.addEventListener("click", onOpenRecap);
  copy.append(action);

  const hasDuration = result.summary.knownContentMinutes > 0;
  const figure = element("div", "ani-dashboard-lede-figure");
  figure.append(
    textElement(
      "strong",
      "ani-dashboard-lede-figure-value",
      hasDuration ? formatDuration(result.summary.knownContentMinutes) : formatInteger(result.summary.watchCount)
    ),
    textElement("span", "ani-dashboard-lede-figure-unit", hasDuration ? "已知觀看片長" : "次觀看")
  );

  lede.append(copy, figure);
  return lede;
};

const ledeHeadline = (result: AnalyticsResult): string => {
  if (result.summary.watchCount === 0) return "這段期間還沒有觀看紀錄";
  return `${result.period.label}的追番軌跡`;
};

/**
 * Distills the period into at most three takeaway chips: the busiest slot on
 * the rhythm axis, the dominant release season, and the most-watched series.
 */
const renderLedeInsights = (result: AnalyticsResult): HTMLElement | null => {
  const chips: string[] = [];

  const peak = result.rhythm.reduce<RhythmPoint | null>(
    (best, point) => point.count > (best?.count ?? 0) ? point : best,
    null
  );
  if (peak) chips.push(`高峰在${peak.label} · ${formatInteger(peak.count)} 次`);

  const seasonTotal = result.seasonBreakdown.reduce((sum, row) => sum + row.watchCount, 0);
  const topSeason = result.seasonBreakdown.reduce<AnalyticsResult["seasonBreakdown"][number] | null>(
    (best, row) => row.watchCount > (best?.watchCount ?? 0) ? row : best,
    null
  );
  if (topSeason && seasonTotal > 0 && topSeason.watchCount > 0) {
    chips.push(`${topSeason.label}上架佔 ${formatPercent(topSeason.watchCount / seasonTotal)}`);
  }

  const companion = result.runtime.available ? result.runtime.rows[0] : undefined;
  if (companion) chips.push(`《${truncateText(companion.title, 18)}》陪了你 ${formatCompactDuration(companion.contentMinutes)}`);

  if (chips.length === 0) return null;
  const list = element("ul", "ani-dashboard-insights");
  for (const chip of chips.slice(0, 3)) list.append(textElement("li", "", chip));
  return list;
};

const renderGlance = (result: AnalyticsResult): HTMLElement => {
  const grid = element("section", "ani-dashboard-glance");
  grid.setAttribute("aria-label", "觀看摘要");
  const activityLabel = result.scope.axis === "released-at" ? "有上架的日子" : "有觀看的日子";
  // 觀看次數 == 不同單集（沒有重看）時，兩張同數字的卡片只是雜訊；改放日均密度。
  const rewatchCount = result.summary.watchCount - result.summary.uniqueEpisodeCount;
  const secondCard: GlanceCard = rewatchCount > 0
    ? { label: "重看次數", text: formatInteger(rewatchCount), countTo: rewatchCount }
    : {
        label: "平均每個觀看日",
        text: result.summary.activeDayCount > 0
          ? `${averagePerDay(result.summary.watchCount, result.summary.activeDayCount)} 次`
          : "—"
      };
  const cards: readonly GlanceCard[] = [
    { label: "觀看次數", text: formatInteger(result.summary.watchCount), countTo: result.summary.watchCount },
    secondCard,
    { label: "作品數", text: formatInteger(result.summary.animeCount), countTo: result.summary.animeCount },
    { label: activityLabel, text: formatInteger(result.summary.activeDayCount), countTo: result.summary.activeDayCount }
  ];
  for (const { label, text, countTo } of cards) {
    const card = element("article", "ani-dashboard-stat");
    const valueEl = textElement("strong", "ani-dashboard-stat-value", text);
    if (countTo !== undefined) valueEl.dataset.countTo = String(countTo);
    card.append(
      textElement("span", "ani-dashboard-stat-label", label),
      valueEl
    );
    grid.append(card);
  }
  return grid;
};

type GlanceCard = { readonly label: string; readonly text: string; readonly countTo?: number };

const averagePerDay = (watchCount: number, activeDayCount: number): string =>
  new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 }).format(watchCount / activeDayCount);

const renderCluster = (
  index: string,
  title: string,
  subtitle: string,
  modules: readonly (HTMLElement | null)[],
  split = false
): HTMLElement | null => {
  const present = modules.filter((module): module is HTMLElement => module !== null);
  if (present.length === 0) return null;

  const section = element("section", "ani-dashboard-cluster");
  const head = element("div", "ani-dashboard-cluster-head");
  const heading = element("div", "ani-dashboard-cluster-heading");
  heading.append(
    textElement("h3", "ani-dashboard-cluster-title", title),
    textElement("p", "ani-dashboard-cluster-subtitle", subtitle)
  );
  head.append(textElement("span", "ani-dashboard-cluster-index", index), heading);

  const useSplit = split && present.length >= 2;
  const body = element(
    "div",
    useSplit ? "ani-dashboard-cluster-body ani-dashboard-cluster-body--split" : "ani-dashboard-cluster-body"
  );
  for (const module of present) body.append(module);

  section.append(head, body);
  return section;
};

/** Seasons beyond this many cards collapse into one "更早" summary so the long tail stays one glance. */
const SEASON_CARD_LIMIT = 8;

const renderSeasonBreakdown = (result: AnalyticsResult): HTMLElement => {
  const section = moduleShell("上架季分布");

  const grid = element("div", "ani-dashboard-season-grid");
  const rows = result.seasonBreakdown;
  const folded = rows.length > SEASON_CARD_LIMIT + 1 ? rows.slice(0, rows.length - SEASON_CARD_LIMIT) : [];
  const shown = rows.slice(folded.length);
  const max = Math.max(1, ...rows.map((row) => row.watchCount));

  if (folded.length > 0) {
    const card = element("article", "ani-dashboard-season-card ani-dashboard-season-card--folded");
    const watchCount = folded.reduce((sum, row) => sum + row.watchCount, 0);
    const animeCount = folded.reduce((sum, row) => sum + row.animeCount, 0);
    const first = folded[0]!;
    const last = folded.at(-1)!;
    card.title = folded.map((row) => `${row.label} · ${formatInteger(row.watchCount)} 次`).join("\n");
    card.append(
      textElement("span", "ani-dashboard-season-label", `${first.label} – ${last.label}`),
      textElement("strong", "ani-dashboard-season-value", `${formatInteger(watchCount)} 次觀看`),
      textElement("span", "ani-dashboard-season-meta", `更早的 ${formatInteger(folded.length)} 季 · ${formatInteger(animeCount)} 部作品`),
      meterBar(watchCount / max)
    );
    grid.append(card);
  }

  for (const row of shown) {
    const card = element("article", "ani-dashboard-season-card");
    card.dataset.season = row.season;
    const isPeak = row.watchCount === max && row.watchCount > 0;
    card.dataset.peak = String(isPeak);
    if (isPeak) card.append(textElement("span", "ani-dashboard-season-flag", "峰值"));
    card.append(
      textElement("span", "ani-dashboard-season-label", row.label),
      textElement("strong", "ani-dashboard-season-value", `${formatInteger(row.watchCount)} 次觀看`),
      textElement(
        "span",
        "ani-dashboard-season-meta",
        row.contentMinutes === null
          ? `${formatInteger(row.animeCount)} 部作品`
          : `${formatInteger(row.animeCount)} 部作品 · ${formatCompactDuration(row.contentMinutes)}`
      ),
      meterBar(row.watchCount / max)
    );
    grid.append(card);
  }
  section.append(grid);

  const footprints = result.observedWatchedEpisodeReleaseFootprints.rows
    .filter((row) => row.observedReleaseSeasons.length > 1);
  if (footprints.length > 0) {
    const footprintBlock = element("div", "ani-dashboard-footprints");
    footprintBlock.append(
      textElement("h5", "ani-dashboard-footprints-title", "跨季作品")
    );
    const footprintList = element("div", "ani-dashboard-footprint-list");
    for (const row of footprints.slice(0, 8)) {
      const item = element("article", "ani-dashboard-footprint-row");
      const copy = element("div", "ani-dashboard-footprint-copy");
      copy.append(textElement("strong", "", row.title));
      const seasons = element("div", "ani-dashboard-footprint-seasons");
      for (const season of row.observedReleaseSeasons) {
        seasons.append(textElement(
          "span",
          "",
          `${season.label} · ${formatInteger(season.knownReleaseEpisodeCount)} 集`
        ));
      }
      item.append(copy, seasons);
      footprintList.append(item);
    }
    footprintBlock.append(footprintList);
    section.append(footprintBlock);
  }

  return section;
};

export const renderRhythm = (
  points: readonly RhythmPoint[],
  axis: "watched-at" | "released-at" = "watched-at"
): HTMLElement => {
  const peak = points.reduce<RhythmPoint | null>(
    (best, point) => point.count > (best?.count ?? 0) ? point : best,
    null
  );
  const section = moduleShell(
    axis === "released-at" ? "上架時間分布" : "觀看時段",
    undefined,
    peak ? `峰值 ${peak.label} · ${formatInteger(peak.count)} 次` : undefined
  );
  const max = Math.max(1, ...points.map((point) => point.count));
  const chart = element("div", "ani-dashboard-rhythm");
  const bars = element("div", "ani-dashboard-rhythm-bars");
  bars.setAttribute("aria-hidden", "true");
  points.forEach((point, index) => {
    const bar = element("div", "ani-dashboard-rhythm-bar");
    bar.style.setProperty("--ani-rhythm-level", String(point.count / max));
    bar.style.setProperty("--ani-order", String(index));
    bar.dataset.empty = String(point.count === 0);
    bar.dataset.peak = String(point.count > 0 && point.count === max);
    const readable = point.contentMinutes === null
      ? `${point.label}：${point.count} 次觀看`
      : `${point.label}：${point.count} 次觀看，${formatDuration(point.contentMinutes)}`;
    bar.title = readable;
    bars.append(bar);
  });
  const labels = element("div", "ani-dashboard-rhythm-labels");
  const tickCount = Math.min(5, points.length);
  const seen = new Set<number>();
  for (let tick = 0; tick < tickCount; tick++) {
    const index = Math.round((points.length - 1) * (tickCount === 1 ? 0 : tick / (tickCount - 1)));
    if (seen.has(index)) continue;
    seen.add(index);
    labels.append(textElement("span", "", points[index]!.label));
  }
  labels.setAttribute("aria-hidden", "true");
  chart.append(bars, labels, renderRhythmDataTable(points, axis));
  section.append(chart);
  return section;
};

const renderRhythmDataTable = (
  points: readonly RhythmPoint[],
  axis: "watched-at" | "released-at"
): HTMLTableElement => {
  const table = element("table", "ani-dashboard-rhythm-data ani-dashboard-sr-only");
  table.append(textElement("caption", "", "觀看節奏明細"));

  const head = element("thead");
  const headRow = element("tr");
  for (const label of [
    axis === "released-at" ? "上架日期或月份" : "觀看日期或月份",
    "觀看次數",
    "觀看片長"
  ]) {
    const cell = textElement("th", "", label);
    cell.scope = "col";
    headRow.append(cell);
  }
  head.append(headRow);

  const body = element("tbody");
  for (const point of points) {
    const row = element("tr");
    const period = textElement("th", "", point.label);
    period.scope = "row";
    row.append(
      period,
      textElement("td", "", `${formatInteger(point.count)} 次`),
      textElement(
        "td",
        "",
        point.contentMinutes === null ? "—" : formatDuration(point.contentMinutes)
      )
    );
    body.append(row);
  }

  table.append(head, body);
  return table;
};

const renderRuntime = (result: AnalyticsResult): HTMLElement => {
  const section = moduleShell("觀看片長排行");

  const longest = result.runtime.longestEpisode;
  if (longest) {
    const feature = element("article", "ani-dashboard-feature");
    const copy = element("div", "ani-dashboard-feature-copy");
    copy.append(
      textElement("span", "ani-dashboard-feature-kicker", "最長單集"),
      textElement("strong", "ani-dashboard-feature-title", longest.title),
      textElement("span", "ani-dashboard-feature-subtitle", longest.episode)
    );
    feature.append(
      createCover(longest.coverUrl, longest.title, "ani-dashboard-feature-cover"),
      copy,
      textElement("span", "ani-dashboard-feature-value", formatDuration(longest.durationMinutes))
    );
    section.append(feature);
  }

  const ranking = element("div", "ani-dashboard-list");
  const rows = result.runtime.rows.slice(0, 6);
  const max = Math.max(1, ...rows.map((row) => row.contentMinutes));
  for (const row of rows) ranking.append(renderRuntimeRow(row, row.contentMinutes / max));
  section.append(ranking);
  return section;
};

const renderRuntimeRow = (row: SeriesRuntimeRow, level: number): HTMLElement => {
  const item = element("article", "ani-dashboard-ranked-row");
  item.append(
    rankBadge(row.rank),
    createCover(row.coverUrl, row.title, "ani-dashboard-row-cover"),
    rowCopy(row.title, `${formatInteger(row.watchCount)} 次觀看`, level),
    textElement("strong", "ani-dashboard-row-value", formatCompactDuration(row.contentMinutes))
  );
  return item;
};

const renderPreference = (rows: readonly PreferenceRow[]): HTMLElement => {
  const module = moduleShell("有得選時，先看誰");
  const list = element("div", "ani-dashboard-list");
  for (const row of rows.slice(0, 5)) {
    const item = element("article", "ani-dashboard-ranked-row");
    item.append(
      rankBadge(row.rank),
      createCover(row.coverUrl, row.title, "ani-dashboard-row-cover"),
      rowCopy(row.title, `${formatInteger(row.comparisons)} 次比較 · 涉及 ${formatInteger(row.distinctOpponentCount)} 部其他作品`),
      textElement("strong", "ani-dashboard-row-value", formatPercent(row.rawWinRate))
    );
    list.append(item);
  }
  module.append(list);
  return module;
};

const renderTimeliness = (rows: readonly TimelinessRow[]): HTMLElement => {
  const module = moduleShell("上架後多久會看");
  const list = element("div", "ani-dashboard-list");
  for (const row of rows.slice(0, 5)) {
    const item = element("article", "ani-dashboard-ranked-row");
    item.append(
      rankBadge(row.rank),
      createCover(row.coverUrl, row.title, "ani-dashboard-row-cover"),
      rowCopy(row.title, `${formatInteger(row.sampleCount)} 集 · 24 小時內 ${formatPercent(row.within24HoursRate)}`),
      textElement("strong", "ani-dashboard-row-value", formatLag(row.medianLagMinutes))
    );
    list.append(item);
  }
  module.append(list);
  return module;
};

const renderTaste = (result: AnalyticsResult): HTMLElement => {
  const section = moduleShell("常看的類型與製作");
  const grid = element("div", "ani-dashboard-profile-grid");
  const dimensions = [
    ["類型", result.catalog.tags],
    ["動畫公司", result.catalog.makers],
    ["導演", result.catalog.directors],
    ["代理商", result.catalog.publishers]
  ] as const;
  for (const [title, rows] of dimensions) if (rows.length > 0) grid.append(renderDimension(title, rows));
  section.append(grid);
  return section;
};

const renderPlatformComparison = (result: AnalyticsResult): HTMLElement => {
  const comparison = result.currentPlatformSnapshotComparison;
  const section = moduleShell("平台人氣對照");

  const list = element("div", "ani-dashboard-platform-list");
  for (const row of comparison.rows.slice(0, 8)) {
    const item = element("article", "ani-dashboard-platform-row");
    const ranks = element("div", "ani-dashboard-platform-ranks");
    ranks.append(
      platformRank("你的觀看", row.personalWatchRank),
      platformRank("平台人氣", row.platformPopularityRankWithinCoveredAnime)
    );
    const copy = rowCopy(
      row.title,
      `${formatInteger(row.personalWatchCount)} 次觀看 · 平台人氣 ${formatInteger(row.platformPopular)}`
    );
    copy.append(platformDelta(row.personalWatchRank, row.platformPopularityRankWithinCoveredAnime));
    item.append(
      createCover(row.coverUrl, row.title, "ani-dashboard-row-cover"),
      copy,
      ranks
    );
    list.append(item);
  }
  section.append(list);
  return section;
};

/** Positive gap = you rank it higher than the platform crowd does. */
const platformDelta = (personalRank: number, platformRank: number): HTMLElement => {
  const gap = platformRank - personalRank;
  const chip = textElement(
    "span",
    "ani-dashboard-platform-delta",
    gap > 0 ? `你比平台熱情 +${formatInteger(gap)}` : gap < 0 ? `平台比你熱情 +${formatInteger(-gap)}` : "和平台同步"
  );
  chip.dataset.tone = gap > 0 ? "ahead" : gap < 0 ? "behind" : "even";
  return chip;
};

const platformRank = (label: string, rank: number): HTMLElement => {
  const item = element("div");
  item.append(
    textElement("span", "", label),
    textElement("strong", "", `#${formatInteger(rank)}`)
  );
  return item;
};

const renderDimension = (title: string, rows: readonly DimensionRow[]): HTMLElement => {
  const card = dimensionCard(title);
  const list = element("ol", "ani-dashboard-compact-list");
  const shown = rows.slice(0, 6);
  const max = Math.max(1, ...shown.map((row) => row.watchCount));
  // 每列都只來自一部作品時（常見於導演），bar 長度只是把同一件事畫兩次，省下來。
  const meaningfulBars = shown.some((row) => row.animeCount > 1);
  for (const row of shown) {
    const item = element("li");
    const line = element("div", "ani-dashboard-compact-line");
    line.append(
      textElement("span", "ani-dashboard-compact-label", row.label),
      textElement("span", "ani-dashboard-compact-value", `${formatInteger(row.watchCount)} 次觀看 · ${formatInteger(row.animeCount)} 部作品`)
    );
    item.append(line);
    if (meaningfulBars) item.append(meterBar(row.watchCount / max));
    list.append(item);
  }
  card.append(list);
  return card;
};

const hasTasteRows = (result: AnalyticsResult): boolean =>
  result.catalog.tags.length > 0
  || result.catalog.makers.length > 0
  || result.catalog.directors.length > 0
  || result.catalog.publishers.length > 0;

const moduleShell = (title: string, description?: string, hint?: string): HTMLElement => {
  const module = element("section", "ani-dashboard-module");
  const heading = textElement("h4", "ani-dashboard-module-title", title);
  if (hint) heading.append(textElement("span", "ani-dashboard-module-hint", hint));
  module.append(heading);
  if (description) module.append(textElement("p", "ani-dashboard-module-description", description));
  return module;
};

const meterBar = (level: number): HTMLElement => {
  const meter = element("span", "ani-dashboard-meter");
  meter.setAttribute("aria-hidden", "true");
  meter.style.setProperty("--ani-level", String(Math.min(1, Math.max(0, level))));
  return meter;
};

const dimensionCard = (title: string): HTMLElement => {
  const card = element("section", "ani-dashboard-subsection");
  card.append(textElement("h5", "ani-dashboard-subsection-title", title));
  return card;
};

const rankBadge = (rank: number): HTMLElement => {
  const badge = textElement("span", "ani-dashboard-rank", String(rank));
  if (rank === 1) badge.dataset.top = "true";
  return badge;
};

const rowCopy = (title: string, meta: string, level?: number): HTMLElement => {
  const copy = element("div", "ani-dashboard-row-copy");
  copy.append(
    textElement("strong", "ani-dashboard-row-title", title),
    textElement("span", "ani-dashboard-row-meta", meta)
  );
  if (level !== undefined) copy.append(meterBar(level));
  return copy;
};

export const dashboardCss = `
.ani-dashboard { display: grid; gap: 40px; }
.ani-dashboard-lede { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: clamp(20px, 4vw, 48px); border-bottom: 1px solid var(--ani-line); padding-bottom: clamp(22px, 3vw, 30px); }
.ani-dashboard-lede-copy { display: grid; justify-items: start; gap: 14px; min-width: 0; }
.ani-dashboard-eyebrow { margin: 0; color: var(--ani-accent); font-size: 12px; font-weight: 900; letter-spacing: .13em; text-transform: uppercase; }
.ani-dashboard-lede-headline { margin: 0; max-inline-size: 16em; color: var(--ani-ink); font-size: clamp(30px, 5vw, 52px); font-weight: 900; letter-spacing: -.02em; line-height: 1.12; text-wrap: balance; }
.ani-dashboard-lede-caption { margin: 0; color: var(--ani-ink-3); font-size: 13px; font-variant-numeric: tabular-nums; }
.ani-dashboard-insights { display: flex; flex-wrap: wrap; gap: 8px; margin: 2px 0 0; padding: 0; list-style: none; }
.ani-dashboard-insights li { max-width: 100%; border: 1px solid var(--ani-accent-tint); border-radius: var(--ani-r-pill); background: var(--ani-accent-tint); color: var(--ani-accent-ink); font-size: 11px; font-weight: 800; padding: 6px 12px; overflow-wrap: anywhere; }
.ani-dashboard-recap-button { display: inline-flex; align-items: center; gap: 7px; margin-top: 2px; border: 0; border-radius: var(--ani-r-pill); background: var(--ani-ink); color: #fff; cursor: pointer; font: inherit; font-size: 13px; font-weight: 800; padding: 12px 20px; box-shadow: var(--ani-shadow-2); transition: transform var(--ani-dur-1) var(--ani-ease), box-shadow var(--ani-dur-1) var(--ani-ease); }
.ani-dashboard-recap-button::after { content: "→"; font-weight: 700; }
.ani-dashboard-recap-button:hover { transform: translateY(-1px); box-shadow: 0 16px 34px rgba(13, 21, 38, .26); }
.ani-dashboard-lede-figure { display: grid; justify-items: end; align-content: center; gap: 2px; text-align: right; }
.ani-dashboard-lede-figure-value { max-inline-size: 8em; color: var(--ani-accent-ink); font-size: clamp(28px, 3.6vw, 44px); font-weight: 900; letter-spacing: -.03em; line-height: 1.08; text-wrap: balance; font-variant-numeric: tabular-nums; }
.ani-dashboard-lede-figure-unit { color: var(--ani-accent); font-size: 12px; font-weight: 800; }
.ani-dashboard-glance { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 1px solid var(--ani-line); border-bottom: 1px solid var(--ani-line); }
.ani-dashboard-stat { display: grid; gap: 5px; align-content: center; min-height: 86px; padding: 16px 22px; }
.ani-dashboard-stat + .ani-dashboard-stat { border-left: 1px solid var(--ani-line); }
.ani-dashboard-stat-label { color: var(--ani-ink-3); font-size: 12px; font-weight: 800; }
.ani-dashboard-stat-value { align-self: end; color: var(--ani-ink); font-size: clamp(28px, 4vw, 36px); font-weight: 900; line-height: 1; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
.ani-dashboard-cluster { display: grid; gap: 22px; }
.ani-dashboard-cluster-head { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 14px; border-bottom: 2px solid var(--ani-ink); padding-bottom: 12px; }
.ani-dashboard-cluster-index { color: var(--ani-accent); font-size: clamp(26px, 4vw, 40px); font-weight: 900; line-height: 1; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
.ani-dashboard-cluster-heading { display: grid; gap: 2px; min-width: 0; }
.ani-dashboard-cluster-title { margin: 0; color: var(--ani-ink); font-size: clamp(20px, 2.6vw, 26px); font-weight: 900; letter-spacing: -.02em; line-height: 1.15; }
.ani-dashboard-cluster-subtitle { margin: 0; color: var(--ani-ink-3); font-size: 12px; line-height: 1.5; }
.ani-dashboard-cluster-body { display: grid; gap: 34px; }
.ani-dashboard-cluster-body--split { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 32px 30px; align-items: start; }
.ani-dashboard-module { display: grid; gap: 14px; align-content: start; }
.ani-dashboard-module-title { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--ani-ink); font-size: 14px; font-weight: 800; letter-spacing: -.01em; }
.ani-dashboard-module-title::before { content: ""; width: 6px; height: 6px; border-radius: 2px; background: var(--ani-accent); }
.ani-dashboard-module-hint { margin-left: auto; border-radius: var(--ani-r-pill); background: var(--ani-hot-tint); color: var(--ani-hot-ink); font-size: 10px; font-weight: 800; padding: 4px 10px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ani-dashboard-meter { position: relative; display: block; overflow: hidden; width: 100%; max-width: 240px; height: 4px; margin-top: 6px; border-radius: 999px; background: #e3e9f1; }
.ani-dashboard-meter::after { content: ""; position: absolute; inset: 0; width: calc(var(--ani-level, 0) * 100%); border-radius: inherit; background: linear-gradient(90deg, var(--ani-accent-bright), var(--ani-accent)); }
.ani-dashboard-module-description { margin: -8px 0 0; color: var(--ani-ink-3); font-size: 12px; line-height: 1.5; }
.ani-dashboard-season-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.ani-dashboard-season-card { position: relative; display: grid; gap: 3px; overflow: hidden; min-height: 96px; border-radius: var(--ani-r-sm); background: var(--ani-surface-sunken); padding: 12px 14px 12px 16px; --ani-season: var(--ani-accent-bright); }
.ani-dashboard-season-card::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--ani-season); }
.ani-dashboard-season-card[data-season="spring"] { --ani-season: #34d399; }
.ani-dashboard-season-card[data-season="summer"] { --ani-season: #f59e0b; }
.ani-dashboard-season-card[data-season="autumn"] { --ani-season: #f97316; }
.ani-dashboard-season-card[data-peak="true"] { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ani-season) 45%, transparent); }
.ani-dashboard-season-card--folded { background: transparent; box-shadow: inset 0 0 0 1px var(--ani-line); --ani-season: var(--ani-line-strong); }
.ani-dashboard-season-card--folded .ani-dashboard-season-value { color: var(--ani-ink-2); }
.ani-dashboard-season-flag { position: absolute; top: 10px; right: 10px; border-radius: var(--ani-r-pill); background: var(--ani-hot-tint); color: var(--ani-hot-ink); font-size: 9px; font-weight: 900; letter-spacing: .06em; padding: 3px 8px; }
.ani-dashboard-season-card .ani-dashboard-meter { max-width: none; margin-top: 7px; }
.ani-dashboard-season-card .ani-dashboard-meter::after { background: var(--ani-season); }
.ani-dashboard-season-label { color: var(--ani-ink-2); font-size: 12px; font-weight: 800; }
.ani-dashboard-season-value { align-self: end; color: var(--ani-ink); font-size: 23px; font-weight: 800; font-variant-numeric: tabular-nums; }
.ani-dashboard-season-meta { color: var(--ani-ink-3); font-size: 11px; }
.ani-dashboard-rhythm { min-width: 0; }
.ani-dashboard-rhythm-bars { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 46px); justify-content: space-between; align-items: end; gap: 8px; height: 168px; border-bottom: 1px solid var(--ani-line-strong); padding: 12px 0 0; }
.ani-dashboard-rhythm-bar { height: max(3px, calc(var(--ani-rhythm-level) * 144px)); border-radius: 5px 5px 2px 2px; background: linear-gradient(180deg, var(--ani-accent-bright), var(--ani-accent-ink)); outline: none; transition: opacity 120ms ease, filter 120ms ease; }
.ani-dashboard-rhythm-bar[data-empty="true"] { background: var(--ani-line); opacity: .6; }
.ani-dashboard-rhythm-bar[data-peak="true"] { background: linear-gradient(180deg, var(--ani-hot), var(--ani-hot-ink)); }
.ani-dashboard-rhythm-bar:hover { filter: brightness(.9); }
.ani-dashboard-rhythm-labels { display: flex; justify-content: space-between; gap: 12px; margin-top: 8px; color: var(--ani-ink-4); font-size: 10px; }
.ani-dashboard-sr-only { position: absolute !important; width: 1px !important; height: 1px !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; clip-path: inset(50%) !important; white-space: nowrap !important; border: 0 !important; padding: 0 !important; }
.ani-dashboard-profile-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 48px; align-items: start; }
.ani-dashboard-subsection { min-width: 0; }
.ani-dashboard-subsection-title { margin: 0 0 10px; padding-bottom: 8px; border-bottom: 1px solid var(--ani-line); color: var(--ani-ink); font-size: 13px; font-weight: 800; }
.ani-dashboard-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(400px, 100%), 1fr)); column-gap: 48px; }
.ani-dashboard-ranked-row { display: grid; grid-template-columns: auto 40px minmax(0, 1fr) max-content; align-items: center; gap: 11px; min-width: 0; border-bottom: 1px solid var(--ani-line); padding: 10px 0; }
.ani-dashboard-rank { display: grid; place-items: center; min-width: 22px; height: 22px; border-radius: var(--ani-r-pill); background: var(--ani-accent-tint); color: var(--ani-accent-ink); font-size: 12px; font-weight: 900; padding: 0 6px; font-variant-numeric: tabular-nums; }
.ani-dashboard-rank[data-top="true"] { background: var(--ani-hot-tint); color: var(--ani-hot-ink); }
.ani-dashboard-row-cover { display: grid; place-items: center; overflow: hidden; width: 42px; aspect-ratio: 3 / 4; border-radius: 8px; background: linear-gradient(145deg, var(--ani-line), var(--ani-line-strong)); box-shadow: inset 0 0 0 1px rgba(13, 21, 38, .05); }
.ani-dashboard-row-cover img { width: 100%; height: 100%; object-fit: cover; }
.ani-dashboard .ani-cover-fallback { color: var(--ani-ink-3); font-size: 15px; font-weight: 900; opacity: .75; user-select: none; }
.ani-dashboard-feature-cover .ani-cover-fallback { font-size: 21px; }
.ani-dashboard-row-copy { display: grid; min-width: 0; gap: 2px; }
.ani-dashboard-row-title { overflow: hidden; color: var(--ani-ink); font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.ani-dashboard-row-meta { overflow: hidden; color: var(--ani-ink-3); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.ani-dashboard-row-value { color: var(--ani-ink); font-size: 12px; font-weight: 800; text-align: right; font-variant-numeric: tabular-nums; }
.ani-dashboard-feature { display: grid; grid-template-columns: 60px auto auto; align-items: center; gap: 16px; width: fit-content; max-width: 100%; overflow: hidden; border: 0; border-radius: var(--ani-r-md); background: linear-gradient(120deg, var(--ani-hot-tint), var(--ani-surface-sunken)); padding: 12px 22px 12px 12px; }
.ani-dashboard-feature-cover { display: grid; place-items: center; overflow: hidden; width: 60px; aspect-ratio: 3 / 4; border-radius: 8px; background: linear-gradient(145deg, var(--ani-line), var(--ani-line-strong)); }
.ani-dashboard-feature-cover img { width: 100%; height: 100%; object-fit: cover; }
.ani-dashboard-feature-copy { display: grid; gap: 2px; min-width: 0; }
.ani-dashboard-feature-kicker { color: var(--ani-hot-ink); font-size: 10px; font-weight: 900; letter-spacing: .08em; }
.ani-dashboard-feature-title { overflow: hidden; color: var(--ani-ink); font-size: 14px; font-weight: 700; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
.ani-dashboard-feature-subtitle { color: var(--ani-ink-3); font-size: 11px; }
.ani-dashboard-feature-value { color: var(--ani-hot-ink); font-size: 20px; font-weight: 800; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ani-dashboard-compact-list { display: grid; gap: 9px; margin: 0; padding: 0; list-style: none; }
.ani-dashboard-compact-list li { min-width: 0; }
.ani-dashboard-compact-list .ani-dashboard-meter { margin-top: 4px; max-width: none; height: 3px; background: transparent; }
.ani-dashboard-compact-list .ani-dashboard-meter::after { background: color-mix(in srgb, var(--ani-accent) 58%, #dbe6f0); }
.ani-dashboard-compact-line { display: grid; grid-template-columns: minmax(0, 1fr) max-content; gap: 10px; align-items: center; }
.ani-dashboard-compact-label { overflow: hidden; color: var(--ani-ink); font-size: 12px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
.ani-dashboard-compact-value { color: var(--ani-ink-3); font-size: 10px; font-variant-numeric: tabular-nums; }
.ani-dashboard-footprints { display: grid; gap: 10px; border-top: 1px solid var(--ani-line); padding-top: 16px; }
.ani-dashboard-footprints-title { margin: 0; color: var(--ani-ink); font-size: 13px; font-weight: 800; }
.ani-dashboard-footprint-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(360px, 100%), 1fr)); column-gap: 48px; }
.ani-dashboard-footprint-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; border-bottom: 1px solid var(--ani-line); padding: 10px 0; }
.ani-dashboard-footprint-copy { display: grid; min-width: 0; }
.ani-dashboard-footprint-copy strong { overflow: hidden; color: var(--ani-ink); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.ani-dashboard-footprint-seasons { display: flex; flex-wrap: wrap; gap: 5px; }
.ani-dashboard-footprint-seasons span { border-radius: var(--ani-r-pill); background: var(--ani-accent-tint); color: var(--ani-accent-ink); font-size: 9px; font-weight: 800; padding: 4px 7px; }
.ani-dashboard-platform-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(420px, 100%), 1fr)); column-gap: 48px; }
.ani-dashboard-platform-row { display: grid; grid-template-columns: 40px minmax(0, 1fr) max-content; align-items: center; gap: 12px; min-width: 0; border-bottom: 1px solid var(--ani-line); padding: 11px 0; }
.ani-dashboard-platform-ranks { display: grid; grid-template-columns: repeat(2, max-content); gap: 8px; }
.ani-dashboard-platform-ranks div { display: grid; justify-items: end; }
.ani-dashboard-platform-ranks span { color: var(--ani-ink-4); font-size: 8px; }
.ani-dashboard-platform-ranks strong { color: var(--ani-ink); font-size: 13px; font-weight: 800; font-variant-numeric: tabular-nums; }
.ani-dashboard-platform-delta { justify-self: start; margin-top: 4px; border-radius: var(--ani-r-pill); font-size: 9px; font-weight: 800; padding: 3px 8px; font-variant-numeric: tabular-nums; }
.ani-dashboard-platform-delta[data-tone="ahead"] { background: var(--ani-hot-tint); color: var(--ani-hot-ink); }
.ani-dashboard-platform-delta[data-tone="behind"] { background: var(--ani-accent-tint); color: var(--ani-accent-ink); }
.ani-dashboard-platform-delta[data-tone="even"] { background: var(--ani-surface-sunken); color: var(--ani-ink-3); }
.ani-dashboard--reveal > * { animation: ani-dashboard-rise var(--ani-dur-4) var(--ani-ease-out) both; animation-delay: calc(var(--ani-order, 0) * 72ms); }
.ani-dashboard--reveal .ani-dashboard-stat { animation: ani-dashboard-rise var(--ani-dur-4) var(--ani-ease-out) both; animation-delay: calc(90ms + var(--ani-stagger, 0) * 55ms); }
.ani-dashboard--reveal .ani-dashboard-season-card,
.ani-dashboard--reveal .ani-dashboard-ranked-row,
.ani-dashboard--reveal .ani-dashboard-platform-row,
.ani-dashboard--reveal .ani-dashboard-footprint-row,
.ani-dashboard--reveal .ani-dashboard-compact-list li { animation: ani-dashboard-rise var(--ani-dur-4) var(--ani-ease-out) both; animation-delay: calc(160ms + var(--ani-order, 0) * 72ms + var(--ani-stagger, 0) * 45ms); }
.ani-dashboard--reveal .ani-dashboard-rhythm-bar { animation: ani-dashboard-bar 460ms var(--ani-ease-out) both; animation-delay: calc(260ms + var(--ani-order, 0) * 22ms); transform-origin: bottom; }
.ani-dashboard--reveal .ani-dashboard-meter::after { transform-origin: left center; animation: ani-dashboard-meter-grow 640ms var(--ani-ease-out) both; animation-delay: calc(420ms + var(--ani-stagger, 0) * 45ms); }
@keyframes ani-dashboard-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes ani-dashboard-bar { from { transform: scaleY(0); opacity: .35; } to { transform: scaleY(1); opacity: 1; } }
@keyframes ani-dashboard-meter-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@media (max-width: 820px) {
  .ani-dashboard-lede { grid-template-columns: 1fr; align-items: start; gap: 20px; }
  .ani-dashboard-lede-figure { justify-self: start; justify-items: start; text-align: left; }
  .ani-dashboard-glance, .ani-dashboard-season-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ani-dashboard-stat:nth-child(odd) { border-left: 0; }
  .ani-dashboard-stat:nth-child(n + 3) { border-top: 1px solid var(--ani-line); }
  .ani-dashboard-cluster-body--split, .ani-dashboard-two-column, .ani-dashboard-profile-grid { grid-template-columns: 1fr; }
}
@media (max-width: 520px) {
  .ani-dashboard { gap: 24px; }
  .ani-dashboard-recap-button { width: 100%; justify-content: center; }
  .ani-dashboard-stat { padding: 14px 16px; }
  .ani-dashboard-season-grid { grid-template-columns: 1fr; }
  .ani-dashboard-ranked-row { grid-template-columns: auto 36px minmax(0, 1fr); }
  .ani-dashboard-row-cover { width: 36px; }
  .ani-dashboard-row-value { grid-column: 2 / -1; text-align: left; padding-left: 47px; }
  .ani-dashboard-platform-row { grid-template-columns: 36px minmax(0, 1fr); }
  .ani-dashboard-platform-ranks { grid-column: 2; justify-self: start; }
}
@media (prefers-reduced-motion: reduce) {
  .ani-dashboard-rhythm-bar { transition: none; }
}
`;
