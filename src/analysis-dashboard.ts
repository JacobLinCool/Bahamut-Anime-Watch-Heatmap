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
  formatPercent
} from "./analysis-format";
import { createButton, createCover, element, textElement } from "./view-dom";

export type DashboardRenderOptions = {
  readonly result: AnalyticsResult;
  readonly onOpenRecap: () => void;
};

export const renderDashboard = (options: DashboardRenderOptions): HTMLElement => {
  const root = element("div", "ani-dashboard");
  root.append(
    renderHero(options.result, options.onOpenRecap),
    renderSummaryGrid(options.result)
  );
  const sections = [
    options.result.seasonBreakdown.length > 0 ? renderSeasonBreakdown(options.result) : null,
    options.result.rhythm.some((point) => point.count > 0)
      ? renderRhythm(options.result.rhythm, options.result.scope.axis)
      : null,
    options.result.runtime.available ? renderRuntime(options.result) : null,
    options.result.preference.available || options.result.timeliness.available
      ? renderBehavior(options.result)
      : null,
    hasTasteRows(options.result) ? renderTaste(options.result) : null,
    options.result.currentPlatformSnapshotComparison.available
      ? renderPlatformComparison(options.result)
      : null
  ];
  for (const section of sections) if (section) root.append(section);
  return root;
};

const renderHero = (result: AnalyticsResult, onOpenRecap: () => void): HTMLElement => {
  const hero = element("section", "ani-dashboard-hero");
  const copy = element("div", "ani-dashboard-hero-copy");
  const axis = result.scope.axis === "watched-at" ? "按你的觀看時間" : "按每集實際上架時間";
  const hasDuration = result.summary.knownContentMinutes > 0;
  copy.append(
    textElement("p", "ani-dashboard-eyebrow", axis),
    textElement(
      "h3",
      "ani-dashboard-hero-value",
      hasDuration
        ? formatDuration(result.summary.knownContentMinutes)
        : `${formatInteger(result.summary.watchCount)} 次觀看`
    ),
    textElement(
      "p",
      "ani-dashboard-hero-caption",
      `${formatInteger(result.summary.watchCount)} 次觀看 · ${formatInteger(result.summary.animeCount)} 部作品 · ${formatInteger(result.summary.activeDayCount)} 天`
    )
  );
  const action = createButton("ani-dashboard-recap-button", "看看這段回顧");
  action.addEventListener("click", onOpenRecap);
  hero.append(copy, action);
  return hero;
};

const renderSummaryGrid = (result: AnalyticsResult): HTMLElement => {
  const grid = element("section", "ani-dashboard-stat-grid");
  grid.setAttribute("aria-label", "觀看摘要");
  const activityCard: readonly [string, string] = result.scope.axis === "released-at"
    ? ["有上架的日子", formatInteger(result.summary.activeDayCount)]
    : ["有觀看的日子", formatInteger(result.summary.activeDayCount)];
  const cards: ReadonlyArray<readonly [string, string]> = [
    ["觀看次數", formatInteger(result.summary.watchCount)],
    ["不同單集", formatInteger(result.summary.uniqueEpisodeCount)],
    ["作品數", formatInteger(result.summary.animeCount)],
    activityCard
  ];
  for (const [label, value] of cards) {
    const card = element("article", "ani-dashboard-stat");
    card.append(
      textElement("span", "ani-dashboard-stat-label", label),
      textElement("strong", "ani-dashboard-stat-value", value)
    );
    grid.append(card);
  }
  return grid;
};

const renderSeasonBreakdown = (result: AnalyticsResult): HTMLElement => {
  const section = sectionShell("你看的動畫，在哪一季上架");

  const grid = element("div", "ani-dashboard-season-grid");
  for (const row of result.seasonBreakdown) {
    const card = element("article", "ani-dashboard-season-card");
    card.dataset.season = row.season;
    card.append(
      textElement("span", "ani-dashboard-season-label", row.label),
      textElement("strong", "ani-dashboard-season-value", `${formatInteger(row.watchCount)} 次觀看`),
      textElement(
        "span",
        "ani-dashboard-season-meta",
        row.contentMinutes === null
          ? `${formatInteger(row.animeCount)} 部作品`
          : `${formatInteger(row.animeCount)} 部作品 · ${formatCompactDuration(row.contentMinutes)}`
      )
    );
    grid.append(card);
  }
  section.append(grid);

  const footprints = result.observedWatchedEpisodeReleaseFootprints.rows
    .filter((row) => row.observedReleaseSeasons.length > 1);
  if (footprints.length > 0) {
    const footprintBlock = element("div", "ani-dashboard-footprints");
    footprintBlock.append(
      textElement("h4", "ani-dashboard-footprints-title", "跨季作品")
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
  const section = sectionShell(axis === "released-at" ? "上架時間分布" : "你都在什麼時候看");
  const max = Math.max(1, ...points.map((point) => point.count));
  const chart = element("div", "ani-dashboard-rhythm");
  const bars = element("div", "ani-dashboard-rhythm-bars");
  bars.setAttribute("aria-hidden", "true");
  for (const point of points) {
    const bar = element("div", "ani-dashboard-rhythm-bar");
    bar.style.setProperty("--ani-rhythm-level", String(point.count / max));
    bar.dataset.empty = String(point.count === 0);
    const readable = point.contentMinutes === null
      ? `${point.label}：${point.count} 次觀看`
      : `${point.label}：${point.count} 次觀看，${formatDuration(point.contentMinutes)}`;
    bar.title = readable;
    bars.append(bar);
  }
  const labels = element("div", "ani-dashboard-rhythm-labels");
  const first = points[0];
  const middle = points[Math.floor(points.length / 2)];
  const last = points.at(-1);
  if (first) labels.append(textElement("span", "", first.label));
  if (middle && middle !== first && middle !== last) labels.append(textElement("span", "", middle.label));
  if (last && last !== first) labels.append(textElement("span", "", last.label));
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
  const section = sectionShell("觀看片長排行");

  const layout = element("div", "ani-dashboard-two-column");
  const ranking = element("div", "ani-dashboard-list");
  for (const row of result.runtime.rows.slice(0, 6)) ranking.append(renderRuntimeRow(row));
  layout.append(ranking);

  const longest = result.runtime.longestEpisode;
  if (longest) {
    const feature = element("article", "ani-dashboard-feature");
    feature.append(
      createCover(longest.coverUrl, longest.title, "ani-dashboard-feature-cover"),
      textElement("span", "ani-dashboard-feature-kicker", "最長單集"),
      textElement("strong", "ani-dashboard-feature-title", longest.title),
      textElement("span", "ani-dashboard-feature-subtitle", longest.episode),
      textElement("span", "ani-dashboard-feature-value", formatDuration(longest.durationMinutes))
    );
    layout.append(feature);
  }
  section.append(layout);
  return section;
};

const renderRuntimeRow = (row: SeriesRuntimeRow): HTMLElement => {
  const item = element("article", "ani-dashboard-ranked-row");
  item.append(
    textElement("span", "ani-dashboard-rank", String(row.rank)),
    createCover(row.coverUrl, row.title, "ani-dashboard-row-cover"),
    rowCopy(row.title, `${formatInteger(row.watchCount)} 次觀看`),
    textElement("strong", "ani-dashboard-row-value", formatCompactDuration(row.contentMinutes))
  );
  return item;
};

const renderBehavior = (result: AnalyticsResult): HTMLElement => {
  const section = sectionShell("你會先看哪一部");
  const layout = element("div", "ani-dashboard-two-column");
  if (result.preference.available) layout.append(renderPreference(result.preference.rows));
  if (result.timeliness.available) layout.append(renderTimeliness(result.timeliness.rows));
  section.append(layout);
  return section;
};

const renderPreference = (rows: readonly PreferenceRow[]): HTMLElement => {
  const card = subsection("有得選時，你先看誰");
  const list = element("div", "ani-dashboard-list");
  for (const row of rows.slice(0, 5)) {
    const item = element("article", "ani-dashboard-ranked-row");
    item.append(
      textElement("span", "ani-dashboard-rank", String(row.rank)),
      createCover(row.coverUrl, row.title, "ani-dashboard-row-cover"),
      rowCopy(row.title, `${formatInteger(row.comparisons)} 次比較 · 涉及 ${formatInteger(row.distinctOpponentCount)} 部其他作品`),
      textElement("strong", "ani-dashboard-row-value", formatPercent(row.rawWinRate))
    );
    list.append(item);
  }
  card.append(list);
  return card;
};

const renderTimeliness = (rows: readonly TimelinessRow[]): HTMLElement => {
  const card = subsection("上架後，你多久會看");
  const list = element("div", "ani-dashboard-list");
  for (const row of rows.slice(0, 5)) {
    const item = element("article", "ani-dashboard-ranked-row");
    item.append(
      textElement("span", "ani-dashboard-rank", String(row.rank)),
      createCover(row.coverUrl, row.title, "ani-dashboard-row-cover"),
      rowCopy(row.title, `${formatInteger(row.sampleCount)} 集 · 24 小時內 ${formatPercent(row.within24HoursRate)}`),
      textElement("strong", "ani-dashboard-row-value", formatLag(row.medianLagMinutes))
    );
    list.append(item);
  }
  card.append(list);
  return card;
};

const renderTaste = (result: AnalyticsResult): HTMLElement => {
  const section = sectionShell("你常看什麼");
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
  const section = sectionShell("你的觀看 vs. 平台人氣", "你最常看的，和平台熱門一樣嗎？");

  const list = element("div", "ani-dashboard-platform-list");
  for (const row of comparison.rows.slice(0, 8)) {
    const item = element("article", "ani-dashboard-platform-row");
    const ranks = element("div", "ani-dashboard-platform-ranks");
    ranks.append(
      platformRank("你的觀看", row.personalWatchRank),
      platformRank("平台人氣", row.platformPopularityRankWithinCoveredAnime)
    );
    item.append(
      createCover(row.coverUrl, row.title, "ani-dashboard-row-cover"),
      rowCopy(
        row.title,
        `${formatInteger(row.personalWatchCount)} 次觀看 · 平台人氣 ${formatInteger(row.platformPopular)}`
      ),
      ranks
    );
    list.append(item);
  }
  section.append(list);
  return section;
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
  const card = subsection(title);
  const list = element("ol", "ani-dashboard-compact-list");
  for (const row of rows.slice(0, 6)) {
    const item = element("li");
    item.append(
      textElement("span", "ani-dashboard-compact-label", row.label),
      textElement("span", "ani-dashboard-compact-value", `${formatInteger(row.watchCount)} 次觀看 · ${formatInteger(row.animeCount)} 部作品`)
    );
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

const sectionShell = (title: string, description?: string): HTMLElement => {
  const section = element("section", "ani-dashboard-section");
  const heading = element("div", "ani-dashboard-section-heading");
  heading.append(textElement("h3", "ani-dashboard-section-title", title));
  if (description) heading.append(textElement("p", "ani-dashboard-section-description", description));
  section.append(heading);
  return section;
};

const subsection = (title: string, description?: string): HTMLElement => {
  const card = element("section", "ani-dashboard-subsection");
  card.append(textElement("h4", "ani-dashboard-subsection-title", title));
  if (description) card.append(textElement("p", "ani-dashboard-subsection-description", description));
  return card;
};

const rowCopy = (title: string, meta: string): HTMLElement => {
  const copy = element("div", "ani-dashboard-row-copy");
  copy.append(
    textElement("strong", "ani-dashboard-row-title", title),
    textElement("span", "ani-dashboard-row-meta", meta)
  );
  return copy;
};

export const dashboardCss = `
.ani-dashboard { display: grid; gap: 20px; }
.ani-dashboard-hero { position: relative; display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; overflow: hidden; border-radius: 24px; background: radial-gradient(circle at 85% 15%, rgba(56, 189, 248, .32), transparent 32%), linear-gradient(135deg, #0f172a 0%, #172554 56%, #164e63 100%); color: #fff; min-height: 245px; padding: clamp(26px, 5vw, 54px); box-shadow: 0 28px 70px rgba(15, 23, 42, .18); }
.ani-dashboard-hero::after { content: ""; position: absolute; width: 280px; height: 280px; right: -110px; bottom: -170px; border: 1px solid rgba(255, 255, 255, .18); border-radius: 50%; box-shadow: 0 0 0 38px rgba(255, 255, 255, .035), 0 0 0 78px rgba(255, 255, 255, .025); }
.ani-dashboard-hero-copy, .ani-dashboard-recap-button { position: relative; z-index: 1; }
.ani-dashboard-eyebrow { margin: 0 0 10px; color: #7dd3fc; font-size: 12px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }
.ani-dashboard-hero-value { margin: 0; max-width: 720px; font-size: clamp(38px, 7vw, 72px); font-weight: 900; letter-spacing: -.05em; line-height: 1; }
.ani-dashboard-hero-caption { margin: 16px 0 0; max-width: 620px; color: #cbd5e1; font-size: 14px; }
.ani-dashboard-recap-button { flex: none; border: 1px solid rgba(255, 255, 255, .35); border-radius: 999px; background: #fff; color: #0f172a; cursor: pointer; font: inherit; font-size: 13px; font-weight: 900; padding: 12px 18px; box-shadow: 0 10px 30px rgba(2, 6, 23, .24); }
.ani-dashboard-stat-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.ani-dashboard-stat { display: grid; gap: 3px; border: 1px solid #e2e8f0; border-radius: 16px; background: #fff; min-height: 128px; padding: 17px; }
.ani-dashboard-stat-label { color: #64748b; font-size: 12px; font-weight: 800; }
.ani-dashboard-stat-value { align-self: end; color: #0f172a; font-size: 30px; line-height: 1.1; letter-spacing: -.035em; }
.ani-dashboard-section { display: grid; gap: 18px; border: 1px solid #e2e8f0; border-radius: 20px; background: rgba(255, 255, 255, .94); padding: clamp(18px, 3vw, 28px); }
.ani-dashboard-section-heading { display: grid; gap: 4px; }
.ani-dashboard-section-title { margin: 0; color: #0f172a; font-size: 20px; line-height: 1.3; letter-spacing: -.02em; }
.ani-dashboard-section-description { margin: 0; max-width: 850px; color: #64748b; font-size: 12px; line-height: 1.6; }
.ani-dashboard-season-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.ani-dashboard-season-card { position: relative; display: grid; gap: 4px; overflow: hidden; min-height: 126px; border: 1px solid #e2e8f0; border-radius: 16px; background: #f8fafc; padding: 17px; }
.ani-dashboard-season-card::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 4px; background: #38bdf8; }
.ani-dashboard-season-card[data-season="spring"]::before { background: #34d399; }
.ani-dashboard-season-card[data-season="summer"]::before { background: #f59e0b; }
.ani-dashboard-season-card[data-season="autumn"]::before { background: #f97316; }
.ani-dashboard-season-label { color: #475569; font-size: 12px; font-weight: 800; }
.ani-dashboard-season-value { align-self: end; color: #0f172a; font-size: 25px; }
.ani-dashboard-season-meta { color: #64748b; font-size: 11px; }
.ani-dashboard-rhythm { min-width: 0; }
.ani-dashboard-rhythm-bars { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(3px, 1fr); align-items: end; gap: clamp(2px, .5vw, 7px); height: 170px; border-bottom: 1px solid #cbd5e1; padding: 12px 3px 0; }
.ani-dashboard-rhythm-bar { height: max(3px, calc(var(--ani-rhythm-level) * 145px)); border-radius: 5px 5px 2px 2px; background: linear-gradient(180deg, #38bdf8, #0369a1); outline: none; transition: opacity 120ms ease, filter 120ms ease; }
.ani-dashboard-rhythm-bar[data-empty="true"] { background: #e2e8f0; opacity: .6; }
.ani-dashboard-rhythm-bar:hover { filter: brightness(.88); }
.ani-dashboard-rhythm-labels { display: flex; justify-content: space-between; gap: 12px; margin-top: 8px; color: #94a3b8; font-size: 10px; }
.ani-dashboard-sr-only { position: absolute !important; width: 1px !important; height: 1px !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; clip-path: inset(50%) !important; white-space: nowrap !important; border: 0 !important; padding: 0 !important; }
.ani-dashboard-two-column { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(250px, .75fr); gap: 14px; align-items: start; }
.ani-dashboard-profile-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; align-items: start; }
.ani-dashboard-subsection { min-width: 0; border: 1px solid #e2e8f0; border-radius: 16px; background: #f8fafc; padding: 16px; }
.ani-dashboard-subsection-title { margin: 0; color: #0f172a; font-size: 15px; }
.ani-dashboard-subsection-description { margin: 4px 0 13px; color: #64748b; font-size: 11px; line-height: 1.5; }
.ani-dashboard-list { display: grid; }
.ani-dashboard-ranked-row { display: grid; grid-template-columns: 22px 42px minmax(0, 1fr) max-content; align-items: center; gap: 10px; min-width: 0; border-bottom: 1px solid #e2e8f0; padding: 10px 0; }
.ani-dashboard-ranked-row:first-child { padding-top: 0; }
.ani-dashboard-ranked-row:last-child { border-bottom: 0; padding-bottom: 0; }
.ani-dashboard-rank { color: #0284c7; font-size: 13px; font-weight: 900; text-align: center; }
.ani-dashboard-row-cover { display: grid; place-items: center; overflow: hidden; width: 42px; aspect-ratio: 3 / 4; border-radius: 7px; background: linear-gradient(145deg, #e2e8f0, #cbd5e1); }
.ani-dashboard-row-cover img { width: 100%; height: 100%; object-fit: cover; }
.ani-dashboard-row-copy { display: grid; min-width: 0; gap: 2px; }
.ani-dashboard-row-title { overflow: hidden; color: #0f172a; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.ani-dashboard-row-meta { overflow: hidden; color: #64748b; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.ani-dashboard-row-value { color: #0f172a; font-size: 12px; text-align: right; }
.ani-dashboard-feature { display: grid; grid-template-columns: 88px 1fr; grid-template-rows: repeat(4, min-content); gap: 4px 14px; overflow: hidden; border: 1px solid #cbd5e1; border-radius: 16px; background: linear-gradient(145deg, #eff6ff, #f8fafc); padding: 14px; }
.ani-dashboard-feature-cover { grid-row: 1 / -1; overflow: hidden; width: 88px; aspect-ratio: 3 / 4; border-radius: 10px; background: #cbd5e1; }
.ani-dashboard-feature-cover img { width: 100%; height: 100%; object-fit: cover; }
.ani-dashboard-feature-kicker { color: #0284c7; font-size: 10px; font-weight: 900; letter-spacing: .08em; }
.ani-dashboard-feature-title { align-self: end; color: #0f172a; font-size: 14px; line-height: 1.35; }
.ani-dashboard-feature-subtitle { color: #64748b; font-size: 11px; }
.ani-dashboard-feature-value { align-self: end; color: #0f172a; font-size: 19px; }
.ani-dashboard-compact-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.ani-dashboard-compact-list li { display: grid; grid-template-columns: minmax(0, 1fr) max-content; gap: 10px; align-items: center; }
.ani-dashboard-compact-label { overflow: hidden; color: #0f172a; font-size: 12px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
.ani-dashboard-compact-value { color: #64748b; font-size: 10px; }
.ani-dashboard-footprints { display: grid; gap: 10px; border-top: 1px solid #e2e8f0; padding-top: 17px; }
.ani-dashboard-footprints-title { margin: 0; color: #0f172a; font-size: 14px; }
.ani-dashboard-footprint-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.ani-dashboard-footprint-row { display: grid; gap: 9px; border: 1px solid #e2e8f0; border-radius: 12px; background: #f8fafc; padding: 12px; }
.ani-dashboard-footprint-copy { display: grid; min-width: 0; }
.ani-dashboard-footprint-copy strong { overflow: hidden; color: #0f172a; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.ani-dashboard-footprint-seasons { display: flex; flex-wrap: wrap; gap: 5px; }
.ani-dashboard-footprint-seasons span { border-radius: 999px; background: #e0f2fe; color: #075985; font-size: 9px; font-weight: 800; padding: 4px 7px; }
.ani-dashboard-platform-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.ani-dashboard-platform-row { display: grid; grid-template-columns: 42px minmax(0, 1fr) max-content; align-items: center; gap: 10px; min-width: 0; border: 1px solid #e2e8f0; border-radius: 13px; background: #f8fafc; padding: 10px; }
.ani-dashboard-platform-ranks { display: grid; grid-template-columns: repeat(2, max-content); gap: 8px; }
.ani-dashboard-platform-ranks div { display: grid; justify-items: end; }
.ani-dashboard-platform-ranks span { color: #94a3b8; font-size: 8px; }
.ani-dashboard-platform-ranks strong { color: #0f172a; font-size: 13px; }
@media (max-width: 820px) {
  .ani-dashboard-hero { align-items: flex-start; flex-direction: column; min-height: 280px; }
  .ani-dashboard-stat-grid, .ani-dashboard-season-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ani-dashboard-two-column, .ani-dashboard-profile-grid { grid-template-columns: 1fr; }
  .ani-dashboard-platform-list { grid-template-columns: 1fr; }
}
@media (max-width: 520px) {
  .ani-dashboard-hero { border-radius: 18px; padding: 26px 20px; }
  .ani-dashboard-recap-button { width: 100%; }
  .ani-dashboard-stat-grid { gap: 8px; }
  .ani-dashboard-stat { min-height: 112px; padding: 14px; }
  .ani-dashboard-stat-value { font-size: 25px; }
  .ani-dashboard-season-grid { grid-template-columns: 1fr; }
  .ani-dashboard-footprint-list { grid-template-columns: 1fr; }
  .ani-dashboard-ranked-row { grid-template-columns: 20px 36px minmax(0, 1fr); }
  .ani-dashboard-row-cover { width: 36px; }
  .ani-dashboard-row-value { grid-column: 3; text-align: left; }
  .ani-dashboard-platform-row { grid-template-columns: 36px minmax(0, 1fr); }
  .ani-dashboard-platform-ranks { grid-column: 2; justify-self: start; }
}
@media (prefers-reduced-motion: reduce) {
  .ani-dashboard-rhythm-bar { transition: none; }
}
`;
