import {
  formatClockHour,
  formatCompactDuration,
  formatHourRange,
  formatInteger,
  formatLag,
  formatPercent
} from "../analysis-format";
import { createButton, element, textElement } from "../view-dom";
import type {
  HabitClockPayload,
  MarathonPayload,
  OverviewPayload,
  RecapChapterKind,
  RecapPresentationChapter,
  RecapPresentationDeck
} from "./recap-deck";
import {
  densitySegment,
  durationSegments,
  formatDateKey,
  formatShortDateKey,
  lagSegments,
  meterBar,
  part,
  percentSegments,
  quantity,
  recapCover,
  type QuantitySegment,
  type RecapSceneHandle
} from "./recap-scenes";
import type { RecapSummaryLedger, RecapSummaryPeriod, RecapSummaryRhythm } from "./recap-summary";
import { phrasedText } from "./recap-text";

// ───────────────────────────── 版面規劃（純函式） ─────────────────────────────

export type PosterTileKind =
  | "hero"
  | "ledger"
  | "habit-clock"
  | "marathon"
  | "timeliness"
  | "behavior-preference"
  | "completion"
  | "platform-taste"
  | "taste"
  | "season-breakdown"
  | "weekday";

export type PosterTileSize = readonly [columns: number, rows: number];

export type PosterPlacement = {
  readonly kind: PosterTileKind;
  /** 0-based 欄、列起點。 */
  readonly column: number;
  readonly row: number;
  readonly columnSpan: number;
  readonly rowSpan: number;
};

export const POSTER_COLUMNS = 12;
export const POSTER_ROWS = 4;

/**
 * 擺放優先序：越前面越重要，空間不夠時從尾端開始捨棄。進場順序另依故事順序。
 * 英雄磚一定在左上角，排行榜緊鄰其右，其餘依序填入。
 */
export const POSTER_PLACEMENT_ORDER: readonly PosterTileKind[] = Object.freeze([
  "hero",
  "ledger",
  "habit-clock",
  "marathon",
  "timeliness",
  "behavior-preference",
  "completion",
  "platform-taste",
  "taste",
  "season-breakdown"
]);

/**
 * 補白磚：只有主要的磚都以首選尺寸鋪完、仍有空位時才加入（例如作品資料還沒到）。
 * 用更多真實資料填滿留白，而不是把其他磚撐成大片空白。
 */
export const POSTER_FILLER_KINDS: readonly PosterTileKind[] = Object.freeze(["weekday"]);

/** 每種磚的內容最多撐得起幾格；尺寸表不得超過，資料少時磚不會被撐成空殼。 */
export const POSTER_TILE_CAPACITY: Readonly<Record<PosterTileKind, number>> = Object.freeze({
  hero: 48,
  ledger: 16,
  "habit-clock": 32,
  marathon: 8,
  timeliness: 8,
  "behavior-preference": 8,
  completion: 8,
  "platform-taste": 8,
  taste: 8,
  "season-breakdown": 8,
  weekday: 8
});

/** 每種磚可用的尺寸（欄 × 列），依偏好排序；資料越少，前面的磚越有機會長大。 */
export const POSTER_TILE_SIZES: Readonly<Record<PosterTileKind, readonly PosterTileSize[]>> = Object.freeze({
  hero: [[4, 4], [6, 4], [8, 4], [12, 4]],
  ledger: [[4, 3], [4, 4], [4, 2]],
  "habit-clock": [[4, 1], [4, 2], [8, 2], [8, 1], [8, 3], [4, 3], [4, 4], [8, 4], [2, 1]],
  marathon: [[4, 1], [2, 1], [4, 2], [8, 1]],
  timeliness: [[2, 1], [4, 1], [4, 2], [2, 2]],
  "behavior-preference": [[2, 1], [4, 1], [4, 2], [2, 2]],
  completion: [[2, 1], [4, 1], [4, 2], [2, 2]],
  "platform-taste": [[2, 1], [4, 1], [4, 2], [2, 2]],
  taste: [[4, 1], [2, 1], [4, 2]],
  "season-breakdown": [[4, 1], [2, 1], [4, 2]],
  weekday: [[4, 2], [4, 1], [2, 1]]
});

const area = (size: PosterTileSize): number => size[0] * size[1];

/**
 * 把現有的磚精確鋪滿 12×4 格：每塊磚放在第一個空格（列優先），依偏好嘗試尺寸，
 * 鋪不滿就回溯。所有組合都找不到解時，從優先序尾端捨棄一塊再試，所以不會留洞。
 * 補白磚排在最後，只在主要磚以首選尺寸鋪完還有空位時才考慮。
 */
export const planPosterTiles = (
  present: Iterable<PosterTileKind>,
  fillers: Iterable<PosterTileKind> = []
): readonly PosterPlacement[] => {
  const wanted = new Set(present);
  wanted.add("hero");
  const primary = POSTER_PLACEMENT_ORDER.filter((kind) => wanted.has(kind));
  const preferredArea = primary.reduce((sum, kind) => sum + area(POSTER_TILE_SIZES[kind][0]!), 0);
  let slack = POSTER_COLUMNS * POSTER_ROWS - preferredArea;
  const extras: PosterTileKind[] = [];
  for (const kind of new Set(fillers)) {
    if (!POSTER_FILLER_KINDS.includes(kind) || wanted.has(kind)) continue;
    const smallest = Math.min(...POSTER_TILE_SIZES[kind].map(area));
    if (slack < smallest) continue;
    extras.push(kind);
    slack -= smallest;
  }
  let tiles = [...primary, ...extras];
  while (tiles.length > 0) {
    const placements = packExactly(tiles);
    if (placements) return placements;
    tiles = tiles.slice(0, -1);
  }
  return [];
};

const packExactly = (tiles: readonly PosterTileKind[]): PosterPlacement[] | null => {
  const grid: boolean[] = Array.from({ length: POSTER_COLUMNS * POSTER_ROWS }, () => false);
  const placements: PosterPlacement[] = [];
  const minAreas = tiles.map((kind) => Math.min(...POSTER_TILE_SIZES[kind].map(area)));
  const maxAreas = tiles.map((kind) => Math.max(...POSTER_TILE_SIZES[kind].map(area)));
  const suffix = (values: readonly number[]): number[] => {
    const sums = Array.from({ length: values.length + 1 }, () => 0);
    for (let index = values.length - 1; index >= 0; index -= 1) sums[index] = (sums[index + 1] ?? 0) + (values[index] ?? 0);
    return sums;
  };
  const minRemaining = suffix(minAreas);
  const maxRemaining = suffix(maxAreas);
  let free = grid.length;

  const fits = (column: number, row: number, [width, height]: PosterTileSize): boolean => {
    if (column + width > POSTER_COLUMNS || row + height > POSTER_ROWS) return false;
    for (let y = row; y < row + height; y += 1) {
      for (let x = column; x < column + width; x += 1) {
        if (grid[y * POSTER_COLUMNS + x]) return false;
      }
    }
    return true;
  };
  const mark = (column: number, row: number, [width, height]: PosterTileSize, value: boolean): void => {
    for (let y = row; y < row + height; y += 1) {
      for (let x = column; x < column + width; x += 1) grid[y * POSTER_COLUMNS + x] = value;
    }
    free += value ? -width * height : width * height;
  };

  const place = (index: number): boolean => {
    if (index === tiles.length) return free === 0;
    if (free < (minRemaining[index] ?? 0) || free > (maxRemaining[index] ?? 0)) return false;
    const cell = grid.indexOf(false);
    if (cell < 0) return false;
    const column = cell % POSTER_COLUMNS;
    const row = Math.floor(cell / POSTER_COLUMNS);
    const kind = tiles[index]!;
    for (const size of POSTER_TILE_SIZES[kind]) {
      if (!fits(column, row, size)) continue;
      mark(column, row, size, true);
      placements.push({ kind, column, row, columnSpan: size[0], rowSpan: size[1] });
      if (place(index + 1)) return true;
      placements.pop();
      mark(column, row, size, false);
    }
    return false;
  };

  return place(0) ? placements : null;
};

/** 章節 → 海報磚；英雄磚固定來自總覽，排行榜來自 summary.ledger 指定的章節。 */
export const posterTileKinds = (deck: RecapPresentationDeck): PosterTileKind[] => {
  const kinds: PosterTileKind[] = ["hero"];
  if (deck.summary.ledger) kinds.push("ledger");
  for (const chapter of deck.chapters) {
    if (chapter.kind === "overview" || chapter.kind === "runtime") continue;
    kinds.push(chapter.kind);
  }
  return kinds;
};

/** 可以拿來補白的磚：一週節奏只需要觀看時鐘已有的星期分布。 */
export const posterFillerKinds = (deck: RecapPresentationDeck): PosterTileKind[] =>
  deck.summary.weekdayCounts && deck.chapters.some((chapter) => chapter.kind === "habit-clock") ? ["weekday"] : [];

/** 磚 → 點了要回去的章節。 */
const tileChapterId = (deck: RecapPresentationDeck, kind: PosterTileKind): RecapChapterKind => {
  switch (kind) {
    case "hero": return "overview";
    case "ledger": return deck.summary.ledger?.chapterId ?? "runtime";
    case "weekday": return "habit-clock";
    default: return kind;
  }
};

// ───────────────────────────── DOM ─────────────────────────────

export type PosterCallbacks = {
  readonly onRestart: () => void;
  readonly onPrevious: () => void;
  readonly onDashboard: () => void;
  readonly onGoto: (chapterId: string) => void;
};

/** 同一個 shadow root 裡可能先後建出好幾張海報：id 用流水號避免撞名。 */
let posterSerial = 0;

export const buildSummaryScene = (
  deck: RecapPresentationDeck,
  stale: boolean,
  callbacks: PosterCallbacks
): RecapSceneHandle => {
  const summary = deck.summary;
  const serial = ++posterSerial;
  const root = element("section", "ani-rc-scene ani-rc-summary");
  root.dataset.tone = "summary";
  root.dataset.scene = "summary";
  root.dataset.rcTempo = "assemble";
  // 海報有五十多個零件：離開時整張當成一層淡出，新章節才不會疊在半透明的磚上。
  root.dataset.rcExit = "layer";
  const poster = element("div", "ani-rc-poster");

  // ── 抬頭：期間、標題、觀看型態、動作
  const head = element("header", "ani-rc-poster-head");
  const titles = element("div", "ani-rc-poster-titles");
  const eyebrow = part("p", "ani-rc-poster-eyebrow", "fade", 0);
  eyebrow.append(
    textElement("span", "", deck.scope.label),
    textElement("span", "ani-rc-poster-range", summary.rangeLabel)
  );
  const heading = part("h3", "ani-rc-poster-title", "title", 0.3);
  heading.textContent = summary.title;
  heading.tabIndex = -1;
  heading.dataset.recapFocus = "true";
  titles.append(eyebrow, heading);
  head.append(titles);

  if (summary.persona) {
    const trait = summary.persona.primary;
    // 型態框在舊畫面退乾淨之後才出現，不會疊在上一章的大數字上。
    const persona = part("div", "ani-rc-persona", "rise", 2);
    persona.dataset.tone = trait.chapterId;
    const nameRow = element("p", "ani-rc-persona-name-row");
    nameRow.append(
      textElement("span", "ani-rc-persona-label", "你的觀看型態"),
      textElement("strong", "ani-rc-persona-name", trait.label)
    );
    if (summary.persona.others.length > 0) {
      const others = element("span", "ani-rc-persona-others");
      others.append(textElement("span", "", "也是"));
      for (const other of summary.persona.others) {
        const chip = textElement("span", "ani-rc-persona-chip", other.label);
        chip.dataset.tone = other.chapterId;
        others.append(chip);
      }
      nameRow.append(others);
    }
    persona.append(nameRow, textElement("p", "ani-rc-persona-reason", trait.reason));
    const chapterIndex = deck.chapters.findIndex((chapter) => chapter.id === trait.chapterId);
    const chapter = deck.chapters[chapterIndex];
    if (chapter) persona.append(stretchedLink(chapterIndex, chapter, () => callbacks.onGoto(chapter.id)));
    head.append(persona);
  }

  const actions = part("div", "ani-rc-poster-actions", "fade", 1.2);
  const restart = createButton("ani-recap-primary-button", "從頭再看一次");
  restart.addEventListener("click", callbacks.onRestart);
  const previous = createButton("ani-recap-ghost-button", "回上一章");
  previous.addEventListener("click", callbacks.onPrevious);
  const dashboard = createButton("ani-recap-ghost-button", "查看完整分析");
  dashboard.addEventListener("click", callbacks.onDashboard);
  actions.append(restart, previous, dashboard);
  head.append(actions);

  const staleNote = textElement("p", "ani-rc-poster-stale", "觀看資料有了新的變化；從頭播放即可查看最新回顧。");
  staleNote.hidden = !stale;
  head.append(staleNote);

  // ── 磚
  const grid = element("div", "ani-rc-poster-grid");
  const placements = planPosterTiles(posterTileKinds(deck), posterFillerKinds(deck));
  const placed = new Set(placements.map((placement) => placement.kind));
  const storyOrder = storyOrderOf(deck);
  for (const placement of placements) {
    const tile = renderTile(deck, placement, storyOrder, placed, `ani-rc-tile-${serial}-${placement.kind}`, callbacks);
    if (tile) grid.append(tile);
  }

  poster.append(head, grid);
  if (summary.rhythm) poster.append(renderRhythm(summary.rhythm, deck, storyOrder.size + 1));
  root.append(poster);

  return {
    key: "summary",
    root,
    tone: "summary",
    imprintUrl: null,
    update: (context) => {
      staleNote.hidden = !context.stale;
    }
  };
};

/** 磚依故事（章節）順序組裝：總覽在前，最後一章最後。 */
const storyOrderOf = (deck: RecapPresentationDeck): Map<PosterTileKind, number> => {
  const order = new Map<PosterTileKind, number>([["hero", 0]]);
  const ledgerChapter = deck.summary.ledger?.chapterId;
  deck.chapters.forEach((chapter, index) => {
    if (chapter.kind === "overview") return;
    if (chapter.kind === ledgerChapter) order.set("ledger", index);
    // 片長章只以排行榜的形式出現在海報上。
    if (chapter.kind !== "runtime") order.set(chapter.kind, index);
    if (chapter.kind === "habit-clock") order.set("weekday", index + 0.5);
  });
  return order;
};

/**
 * 「回到第 N 章」的按鈕蓋滿整塊磚（或型態框），但磚本身是一般容器：
 * 螢幕報讀器照常讀到磚裡的每個數字，按鈕只負責導覽。
 */
const stretchedLink = (chapterIndex: number, chapter: RecapPresentationChapter, onClick: () => void): HTMLButtonElement => {
  const link = createButton("ani-rc-stretch", "");
  link.append(textElement("span", "ani-rc-sr-only", `回到第 ${chapterIndex + 1} 章：${chapter.eyebrow}`));
  link.dataset.rcNoZone = "true";
  link.addEventListener("click", onClick);
  return link;
};

type TileSpec = {
  readonly label: string;
  readonly blocks: readonly HTMLElement[];
};

const renderTile = (
  deck: RecapPresentationDeck,
  placement: PosterPlacement,
  storyOrder: ReadonlyMap<PosterTileKind, number>,
  placed: ReadonlySet<PosterTileKind>,
  id: string,
  callbacks: PosterCallbacks
): HTMLElement | null => {
  const chapterId = tileChapterId(deck, placement.kind);
  const chapterIndex = deck.chapters.findIndex((chapter) => chapter.id === chapterId);
  const chapter = deck.chapters[chapterIndex];
  const order = storyOrder.get(placement.kind) ?? 0;
  const spec = tileContent(deck, placement, chapter, placed, order + 0.5);
  if (!spec) return null;
  const tile = element("article", "ani-rc-tile");
  tile.dataset.tile = placement.kind;
  tile.dataset.tone = chapterId;
  tile.dataset.w = String(placement.columnSpan);
  tile.dataset.h = String(placement.rowSpan);
  tile.style.gridColumn = `${placement.column + 1} / span ${placement.columnSpan}`;
  tile.style.gridRow = `${placement.row + 1} / span ${placement.rowSpan}`;
  const surface = part("span", "ani-rc-tile-surface", "surface", order);
  surface.setAttribute("aria-hidden", "true");
  const label = part("h4", "ani-rc-tile-label", "fade", order + 0.5);
  label.id = `${id}-label`;
  label.textContent = spec.label;
  tile.setAttribute("aria-labelledby", label.id);
  tile.append(surface, label, ...spec.blocks);
  if (chapter) tile.append(stretchedLink(chapterIndex, chapter, () => callbacks.onGoto(chapter.id)));
  return tile;
};

const tileBlock = (className: string, order: number, kind = "rise"): HTMLElement => part("span", className, kind, order);

const tileContent = (
  deck: RecapPresentationDeck,
  placement: PosterPlacement,
  chapter: RecapPresentationChapter | undefined,
  placed: ReadonlySet<PosterTileKind>,
  order: number
): TileSpec | null => {
  const roomy = placement.rowSpan >= 2;
  const wide = placement.columnSpan >= 4;
  switch (placement.kind) {
    case "hero": return heroContent(deck, placement, order);
    case "ledger": return deck.summary.ledger ? ledgerContent(deck.summary.ledger, placement, order) : null;
    case "weekday": return chapter?.kind === "habit-clock" && deck.summary.weekdayCounts
      ? weekdayContent(deck.summary.weekdayCounts, chapter.payload, placement, order)
      : null;
    default: break;
  }
  if (!chapter) return null;
  switch (chapter.kind) {
    case "habit-clock": return clockContent(chapter.payload, deck, placement, !placed.has("weekday"), order);
    case "marathon": return marathonContent(chapter.payload, deck.summary.period, placement, order);
    case "timeliness": {
      const payload = chapter.payload;
      const head = tileBlock("ani-rc-tile-head", order);
      head.append(
        quantity(lagSegments(payload.overallMedianLagMinutes), "ani-rc-tile-value"),
        textElement("span", "ani-rc-tile-caption", `通常等待 · ${formatPercent(payload.overallWithin24HoursRate)} 在 24 小時內`)
      );
      const fastest = payload.rows[0];
      const blocks: HTMLElement[] = [head];
      if (fastest) {
        blocks.push(roomy
          ? workLine(fastest.title, fastest.coverUrl, ["最快", `通常等 ${formatLag(fastest.medianLagMinutes)}`], order + 0.4)
          : tileFoot(`最快《${fastest.title}》`, order + 0.4));
      }
      return { label: "上架後多久看", blocks };
    }
    case "behavior-preference": {
      const leader = chapter.payload.rows[0];
      if (!leader) return null;
      return {
        label: "有得選時先看",
        blocks: [workLine(leader.title, leader.coverUrl, [
          `先看率 ${formatPercent(leader.rawWinRate)}`,
          `${formatInteger(leader.comparisons)} 次比較`
        ], order + 0.2, true)]
      };
    }
    case "completion": {
      const payload = chapter.payload;
      const head = tileBlock("ani-rc-tile-head", order);
      head.append(
        quantity([{ value: formatInteger(payload.completedCount), unit: "部", countTo: payload.completedCount }], "ani-rc-tile-value"),
        textElement("span", "ani-rc-tile-caption", `完食 · 共 ${formatInteger(payload.sampledCount)} 部可核對`)
      );
      const blocks: HTMLElement[] = [head];
      if (payload.sampledCount > 0) {
        const meter = tileBlock("ani-rc-tile-meter", order + 0.3);
        meter.append(meterBar(payload.completedCount / payload.sampledCount));
        blocks.push(meter);
      }
      if (payload.tastedCount > 0) blocks.push(tileFoot(`另有 ${formatInteger(payload.tastedCount)} 部只看了一集`, order + 0.4));
      return { label: "完食清單", blocks };
    }
    case "platform-taste": {
      const payload = chapter.payload;
      const lead = payload.hiddenGem ?? payload.rows[0];
      if (!lead) return null;
      // 兩個名次併成一行，第二行說出差距（或次數），小磚的下半部不會空著。
      return {
        label: payload.hiddenGem ? "你的私藏" : "你最常看",
        blocks: [workLine(lead.title, lead.coverUrl, [
          `你 #${formatInteger(lead.personalWatchRank)} · 平台 #${formatInteger(lead.platformRank)}`,
          payload.hiddenGem
            ? `排得比大眾前面 ${formatInteger(payload.hiddenGem.gap)} 名`
            : `看了 ${formatInteger(lead.personalWatchCount)} 次`
        ], order + 0.2, true)]
      };
    }
    case "taste": {
      const payload = chapter.payload;
      const leaderLabel = payload.tags.length > 0 ? "最常看的類型" : payload.makers.length > 0 ? "最常看的製作方" : "口味";
      const chips = part("ul", "ani-rc-chips", "rise", order + 0.2);
      const chipSource = payload.tags.length > 0 ? payload.tags : payload.makers.length > 0 ? payload.makers : payload.directors.length > 0 ? payload.directors : payload.publishers;
      // 放不下的標籤整顆換到被裁掉的下一排，不會出現半顆。
      chipSource.slice(0, wide ? 6 : 4).forEach((row, index) => {
        const chip = textElement("li", "ani-rc-chip", row.label);
        chip.dataset.rank = String(index + 1);
        chips.append(chip);
      });
      const blocks: HTMLElement[] = [chips];
      // 第一名的份量：幾部作品、幾次觀看，填在標籤與製作名單之間。
      const top = chipSource[0];
      if (top) {
        const lead = tileBlock("ani-rc-taste-lead", order + 0.3);
        lead.textContent = `${top.label} · ${formatInteger(top.animeCount)} 部作品 · ${formatInteger(top.watchCount)} 次觀看`;
        blocks.push(lead);
      }
      const credits = tileBlock("ani-rc-credits", order + 0.4);
      const creditRows: [string, string | undefined][] = [
        ["動畫公司", payload.makers[0]?.label],
        ["導演", payload.directors[0]?.label],
        ["代理商", payload.publishers[0]?.label]
      ];
      const creditLimit = wide ? (roomy ? 3 : 2) : 1;
      for (const [label, value] of creditRows.filter(([, value]) => value).slice(0, creditLimit)) {
        const line = element("span", "ani-rc-credit");
        line.append(textElement("span", "ani-rc-credit-label", label), textElement("span", "ani-rc-credit-value", value ?? ""));
        credits.append(line);
      }
      if (credits.childElementCount > 0) blocks.push(credits);
      return { label: leaderLabel, blocks };
    }
    case "season-breakdown": {
      const payload = chapter.payload;
      const max = Math.max(1, ...payload.rows.map((row) => row.watchCount));
      const chart = tileBlock("ani-rc-mini-seasons", order + 0.2);
      for (const row of payload.rows) {
        const column = element("span", "ani-rc-mini-season");
        column.dataset.season = row.season;
        column.dataset.leading = String(payload.leadingSeasons.includes(row.season));
        const track = element("span", "ani-rc-mini-season-track");
        track.setAttribute("aria-hidden", "true");
        const bar = element("span", "ani-rc-mini-season-bar");
        bar.dataset.rcBar = "true";
        bar.style.setProperty("--rc-level", String(row.watchCount / max));
        track.append(bar);
        column.append(
          track,
          textElement("span", "ani-rc-mini-season-name", row.label.replace(/^\d+\s*/, "").replace("季", "")),
          textElement("span", "ani-rc-mini-season-count", `${formatInteger(row.watchCount)} 次`)
        );
        chart.append(column);
      }
      return { label: `${payload.year} 四季`, blocks: [chart] };
    }
    default:
      return null;
  }
};

const clockContent = (
  payload: HabitClockPayload,
  deck: RecapPresentationDeck,
  placement: PosterPlacement,
  ownsWeekdays: boolean,
  order: number
): TileSpec => {
  const roomy = placement.rowSpan >= 2;
  const wide = placement.columnSpan >= 4;
  const top = payload.topSegment;
  const head = tileBlock("ani-rc-tile-head", order);
  head.append(
    quantity(percentSegments(top.share), "ani-rc-tile-value"),
    textElement("span", "ani-rc-tile-caption", `${top.label} ${formatHourRange(top.startHour, top.endHour)}`)
  );
  const clock = tileBlock("ani-rc-mini-clock", order + 0.3);
  const bars = element("span", "ani-rc-mini-bars");
  bars.setAttribute("aria-hidden", "true");
  const max = Math.max(1, ...payload.hourCounts);
  payload.hourCounts.forEach((count, hour) => {
    const bar = element("span", "ani-rc-mini-bar");
    bar.dataset.rcBar = "true";
    bar.dataset.peak = String(hour === payload.peakHour);
    bar.dataset.segment = segmentKeyForHour(hour);
    bar.style.setProperty("--rc-level", String(count / max));
    bars.append(bar);
  });
  // 刻度在每種尺寸都畫：沒有刻度的 24 根長條讀不出幾點。
  const ticks = element("span", "ani-rc-mini-ticks");
  ticks.setAttribute("aria-hidden", "true");
  for (const hour of [0, 6, 12, 18, 24]) ticks.append(textElement("span", "", pad(hour % 24)));
  clock.append(bars, ticks);
  const blocks: HTMLElement[] = [head, clock];
  if (roomy) {
    const segments = part("ul", "ani-rc-tile-segments", "rise", order + 0.5);
    for (const segment of payload.segments) {
      const item = element("li", "ani-rc-tile-segment");
      item.dataset.top = String(segment.key === top.key);
      item.append(textElement("span", "", segment.label), textElement("strong", "", formatPercent(segment.share)));
      segments.append(item);
    }
    blocks.push(segments);
    const weekdays = deck.summary.weekdayCounts;
    if (ownsWeekdays && weekdays && (wide || placement.rowSpan >= 3)) {
      blocks.push(weekdayStrip(weekdays, payload.topWeekday.weekday, order + 0.7, false));
    }
  }
  blocks.push(tileFoot(`高峰 ${formatClockHour(payload.peakHour)} · ${payload.topWeekday.label}最常看`, order + 0.6));
  return { label: "觀看時鐘", blocks };
};

const marathonContent = (
  payload: MarathonPayload,
  period: RecapSummaryPeriod,
  placement: PosterPlacement,
  order: number
): TileSpec => {
  const roomy = placement.rowSpan >= 2;
  const wide = placement.columnSpan >= 4;
  const blocks: HTMLElement[] = [];
  const peak = tileBlock("ani-rc-tile-head", order);
  peak.append(
    quantity([{ value: formatInteger(payload.peakDay.watchCount), unit: "次", countTo: payload.peakDay.watchCount }], "ani-rc-tile-value"),
    textElement("span", "ani-rc-tile-caption", roomy
      ? `單日最高 · ${formatDateKey(payload.peakDay.dateKey)}`
      : `單日最高 · ${formatShortDateKey(payload.peakDay.dateKey)}`)
  );
  const pair = element("span", "ani-rc-tile-pair");
  pair.append(peak);
  const streak = payload.longestStreak;
  if (streak && wide) {
    const streakBlock = tileBlock("ani-rc-tile-head", order + 0.3);
    streakBlock.append(
      quantity([{ value: formatInteger(streak.days), unit: "天", countTo: streak.days }], "ani-rc-tile-value"),
      textElement("span", "ani-rc-tile-caption", streak.days > 1
        ? `最長連續 · ${formatShortDateKey(streak.fromDateKey)}–${formatShortDateKey(streak.toDateKey)}`
        : "最長連續")
    );
    pair.append(streakBlock);
  }
  if (roomy && payload.peakDay.knownContentMinutes > 0) {
    const minutesBlock = tileBlock("ani-rc-tile-head", order + 0.45);
    minutesBlock.append(
      quantity(durationSegments(payload.peakDay.knownContentMinutes), "ani-rc-tile-value"),
      textElement("span", "ani-rc-tile-caption", "當日已知片長")
    );
    pair.append(minutesBlock);
  }
  blocks.push(pair);
  if (streak && !wide) blocks.push(tileFoot(`最長連續 ${formatInteger(streak.days)} 天`, order + 0.4));
  const ribbon = wide ? marathonRibbon(payload, period, roomy, order + 0.5) : null;
  if (ribbon) blocks.push(ribbon);
  const run = payload.topSingleDayRun;
  if (run && roomy) {
    blocks.push(workLine(run.title, run.coverUrl, [`一天連看 ${formatInteger(run.watchCount)} 集`, formatShortDateKey(run.dateKey)], order + 0.6));
  }
  return { label: "觀看馬拉松", blocks };
};

/**
 * 整段期間畫成一條時間軸：最長連續觀看是一段亮帶、單日最高是一個點。
 * 日期不在期間內（依上架時間歸類時，觀看日可能落在期間之後）就不畫，避免畫錯位置。
 */
const marathonRibbon = (
  payload: MarathonPayload,
  period: RecapSummaryPeriod,
  withMonths: boolean,
  order: number
): HTMLElement | null => {
  if (period.dayCount < 7) return null;
  const inRange = (key: string): boolean => key >= period.startDateKey && key <= period.endDateKey;
  const position = (key: string): number => dayOffset(period.startDateKey, key) / Math.max(1, period.dayCount - 1);
  const streak = payload.longestStreak && payload.longestStreak.days > 1
    && inRange(payload.longestStreak.fromDateKey) && inRange(payload.longestStreak.toDateKey)
    ? payload.longestStreak
    : null;
  const peakInRange = inRange(payload.peakDay.dateKey);
  if (!streak && !peakInRange) return null;
  const ribbon = tileBlock("ani-rc-ribbon", order, "fade");
  ribbon.setAttribute("aria-hidden", "true");
  const track = element("span", "ani-rc-ribbon-track");
  if (streak) {
    const band = element("span", "ani-rc-ribbon-streak");
    band.dataset.rcMeter = "true";
    band.style.setProperty("--rc-from", String(position(streak.fromDateKey)));
    band.style.setProperty("--rc-to", String(position(streak.toDateKey)));
    track.append(band);
  }
  if (peakInRange) {
    const dot = element("span", "ani-rc-ribbon-peak");
    dot.style.setProperty("--rc-at", String(position(payload.peakDay.dateKey)));
    track.append(dot);
  }
  // 大磚在時間軸下標出每個月的起點，讀得出亮帶與圓點落在哪個月。
  const months = withMonths ? monthStarts(period) : [];
  if (months.length >= 2) {
    const ticks = element("span", "ani-rc-ribbon-months");
    for (const key of months) {
      const tick = textElement("span", "", `${Number(key.slice(5, 7))}月`);
      tick.style.setProperty("--rc-at", String(position(key)));
      ticks.append(tick);
    }
    track.dataset.ticks = "true";
    ribbon.append(track, ticks);
  } else {
    ribbon.append(track);
  }
  const ends = element("span", "ani-rc-ribbon-ends");
  ends.append(
    textElement("span", "", formatShortDateKey(period.startDateKey)),
    textElement("span", "ani-rc-ribbon-legend", streak ? "亮帶＝最長連續 · 圓點＝單日最高" : "圓點＝單日最高"),
    textElement("span", "", formatShortDateKey(period.endDateKey))
  );
  ribbon.append(ends);
  return ribbon;
};

const weekdayContent = (
  counts: readonly number[],
  payload: HabitClockPayload,
  placement: PosterPlacement,
  order: number
): TileSpec => {
  const total = counts.reduce((sum, count) => sum + count, 0);
  const top = payload.topWeekday;
  const head = tileBlock("ani-rc-tile-head", order);
  head.append(
    textElement("strong", "ani-rc-tile-value ani-rc-tile-word", top.label),
    textElement("span", "ani-rc-tile-caption", `${formatInteger(top.watchCount)} 次 · 一週裡最常看`)
  );
  const pair = element("span", "ani-rc-tile-pair");
  pair.append(head);
  if (total > 0 && placement.columnSpan >= 4) {
    const weekend = ((counts[0] ?? 0) + (counts[6] ?? 0)) / total;
    const share = tileBlock("ani-rc-tile-head", order + 0.3);
    share.append(
      quantity(percentSegments(weekend), "ani-rc-tile-value"),
      textElement("span", "ani-rc-tile-caption", "落在週末（六、日）")
    );
    pair.append(share);
  }
  const blocks: HTMLElement[] = [pair];
  if (placement.rowSpan >= 2) blocks.push(weekdayStrip(counts, top.weekday, order + 0.5, true));
  return { label: "一週節奏", blocks };
};

const heroContent = (deck: RecapPresentationDeck, placement: PosterPlacement, order: number): TileSpec => {
  const summary = deck.summary;
  const overview = deck.chapters.find((chapter) => chapter.kind === "overview");
  const blocks: HTMLElement[] = [];
  if (summary.covers.length > 0) {
    const collage = element("span", "ani-rc-collage");
    collage.setAttribute("aria-hidden", "true");
    collage.dataset.count = String(summary.covers.length);
    summary.covers.forEach((cover, index) => {
      const item = part("span", "ani-rc-collage-item", "fly", order + 0.1 + index * 0.35);
      item.dataset.rcShared = `anime-${cover.animeSn}`;
      item.style.setProperty("--rc-i", String(index));
      item.style.setProperty("--rc-n", String(summary.covers.length));
      item.append(recapCover(cover.coverUrl, cover.title, "ani-rc-collage-art"));
      collage.append(item);
    });
    blocks.push(collage);
  } else {
    // 沒有封面（作品資料還沒到）：拼貼的位置換成期間本身，數字不會懸在一片空白裡。
    const span = tileBlock("ani-rc-hero-period", order + 0.1);
    span.append(
      textElement("span", "ani-rc-hero-period-range", summary.rangeLabel),
      textElement("span", "ani-rc-hero-period-days", `共 ${formatInteger(summary.period.dayCount)} 天`)
    );
    blocks.push(span);
  }
  const hero = part("span", "ani-rc-hero-number", "rise", order + 0.6);
  // 上百小時時分鐘只是雜訊：海報只留小時，精確值在片長章與資料依據裡。
  const segments: QuantitySegment[] = summary.hero.kind === "known-runtime"
    ? summary.hero.minutes >= 100 * 60
      ? durationSegments(summary.hero.minutes, "runtime-total").slice(0, 1)
      : durationSegments(summary.hero.minutes, "runtime-total")
    : [{ value: formatInteger(summary.hero.count), unit: "次", countTo: summary.hero.count, countKey: "watch-count" }];
  hero.dataset.rcShared = summary.hero.kind === "known-runtime" ? "metric-runtime" : "metric-watch";
  const figure = quantity(segments, "ani-rc-hero-figure");
  const length = segments.reduce((sum, segment) => sum + [...segment.value].length + [...(segment.unit ?? "")].length * 0.4, 0);
  if (length > 6.5) figure.dataset.long = "true";
  hero.append(
    figure,
    textElement("span", "ani-rc-hero-note", summary.hero.kind === "known-runtime" ? "已知片長合計" : "觀看次數")
  );
  blocks.push(hero);
  if (overview && overview.kind === "overview") {
    const payload = overview.payload;
    const meter = activeDaysMeter(payload, summary.period, order + 0.75);
    if (meter) blocks.push(meter);
    blocks.push(heroKpis(payload, summary, placement, meter !== null, order + 0.9));
  }
  return { label: `${deck.scope.label}的你`, blocks };
};

/** 有觀看（或有上架）的日子占整段期間多少：取代單獨的「觀看日」數字。 */
const activeDaysMeter = (payload: OverviewPayload, period: RecapSummaryPeriod, order: number): HTMLElement | null => {
  if (period.dayCount <= 0 || payload.activeDayCount > period.dayCount) return null;
  const label = payload.axis === "released-at" ? "有上架集數的日子" : "有看動畫的日子";
  const block = tileBlock("ani-rc-days", order);
  block.dataset.rcShared = "metric-days";
  const line = element("span", "ani-rc-days-line");
  const value = quantity([
    { value: formatInteger(payload.activeDayCount), countTo: payload.activeDayCount, countKey: "active-days" },
    { value: `/ ${formatInteger(period.dayCount)}`, unit: "天" }
  ], "ani-rc-days-value");
  // 百分比和天數同一個零件、同一條時間軸一起跳：不會一邊是 0 天、一邊已經是 82%。
  const sharePercent = Math.round((payload.activeDayCount / period.dayCount) * 100);
  const share = element("span", "ani-rc-days-share");
  const shareValue = textElement("span", "ani-rc-num", formatInteger(sharePercent));
  shareValue.dataset.countTo = String(sharePercent);
  share.append(shareValue, "%");
  line.append(textElement("span", "ani-rc-days-label", label), value, share);
  block.append(line, meterBar(payload.activeDayCount / period.dayCount, "ani-rc-meter ani-rc-days-meter"));
  return block;
};

type KpiCell = readonly [label: string, segments: QuantitySegment[], shared: string | undefined];

const heroKpis = (
  payload: OverviewPayload,
  summary: RecapPresentationDeck["summary"],
  placement: PosterPlacement,
  daysInMeter: boolean,
  order: number
): HTMLElement => {
  const activeDayLabel = payload.axis === "released-at" ? "上架日" : "觀看日";
  // 沒有重看時「觀看」與「不同單集」是同一個數字：換成日均密度，不重複佔位。
  const rewatchCount = payload.watchCount - payload.uniqueEpisodeCount;
  const hasAnime = payload.identifiableAnimeCount > 0;
  const watchCell: KpiCell = ["次觀看", [{ value: formatInteger(payload.watchCount), countTo: payload.watchCount, countKey: "watch-count" }], "metric-watch"];
  const episodeCell: KpiCell = ["不同單集", [{ value: formatInteger(payload.uniqueEpisodeCount), countTo: payload.uniqueEpisodeCount, countKey: "episode-count" }], undefined];
  const rewatchCell: KpiCell = ["重看", [{ value: formatInteger(rewatchCount), unit: "次", countTo: rewatchCount }], undefined];
  const animeCell: KpiCell = ["部作品", [{ value: formatInteger(payload.identifiableAnimeCount), countTo: payload.identifiableAnimeCount, countKey: "anime-count" }], "metric-anime"];
  const daysCell: KpiCell = [activeDayLabel, [{ value: formatInteger(payload.activeDayCount), unit: "天", countTo: payload.activeDayCount, countKey: "active-days" }], "metric-days"];
  const densityCell: KpiCell = [`平均每個${activeDayLabel}`, [densitySegment(payload.watchCount, payload.activeDayCount)], undefined];
  const weeks = summary.period.dayCount / 7;
  const weeklyCell: KpiCell = ["平均每週", [densitySegment(payload.watchCount, weeks)], undefined];
  const candidates: KpiCell[] = summary.hero.kind === "known-runtime"
    ? [watchCell, ...(rewatchCount > 0 ? [episodeCell] : []), ...(hasAnime ? [animeCell] : []), densityCell]
    : [...(rewatchCount > 0 ? [episodeCell, rewatchCell] : []), ...(hasAnime ? [animeCell] : []), densityCell];
  if (!daysInMeter) candidates.push(daysCell);
  // 作品資料還沒到時格子太少：補上整段期間的週平均（與日均分母不同，兩者並不重複）。
  if (candidates.length < 2 && weeks >= 2) candidates.push(weeklyCell);
  const cells = candidates.slice(0, 4);
  const kpis = element("span", "ani-rc-kpis");
  kpis.dataset.columns = cells.length >= 4 && placement.columnSpan >= 6 ? "4" : cells.length === 3 ? "3" : "2";
  cells.forEach(([label, segments, shared], index) => {
    const cell = part("span", "ani-rc-kpi", "rise", order + index * 0.25);
    if (shared) cell.dataset.rcShared = shared;
    cell.append(quantity(segments, "ani-rc-kpi-value"), textElement("span", "ani-rc-kpi-label", label));
    kpis.append(cell);
  });
  return kpis;
};

const ledgerContent = (ledger: RecapSummaryLedger, placement: PosterPlacement, order: number): TileSpec => {
  const rowLimit = Math.max(2, Math.min(5, placement.rowSpan + 2));
  const max = Math.max(...ledger.rows.map((row) => row.value), 0) || 1;
  const list = element("ol", "ani-rc-ledger-list");
  ledger.rows.slice(0, rowLimit).forEach((row, index) => {
    const line = part("li", "ani-rc-ledger-row", "rise", order + 0.2 + index * 0.3);
    const copy = element("span", "ani-rc-ledger-copy");
    copy.append(phrasedText("span", "ani-rc-ledger-title", row.title));
    const meta = row.watchCount !== null && ledger.metric !== "watch-count"
      ? `${formatInteger(row.watchCount)} 次觀看`
      : null;
    if (meta) copy.append(textElement("span", "ani-rc-ledger-meta", meta));
    copy.append(meterBar(ledger.metric === "median-lag" ? (ledger.rows[0]!.value + 1) / (row.value + 1) : row.value / max));
    line.append(
      textElement("span", "ani-rc-ledger-rank", String(row.rank)),
      recapCover(row.coverUrl, row.title, "ani-rc-ledger-cover"),
      copy,
      textElement("span", "ani-rc-ledger-value", ledgerValue(ledger, row.value))
    );
    list.append(line);
  });
  return { label: ledger.label, blocks: [list] };
};

const ledgerValue = (ledger: RecapSummaryLedger, value: number): string => {
  switch (ledger.metric) {
    case "known-minutes": return formatCompactDuration(value);
    case "watch-count": return `${formatInteger(value)} 次`;
    case "win-rate":
    case "completion": return formatPercent(value);
    case "median-lag": return formatLag(value);
  }
};

/**
 * 作品型磚：封面 + 標題 + 細節。stacked（窄磚）時每項細節各占一行，
 * 數字不會因為擠在同一行而被省略號吃掉。
 */
const workLine = (
  title: string,
  coverUrl: string | null,
  details: readonly string[],
  order: number,
  stacked = false
): HTMLElement => {
  const line = tileBlock(stacked ? "ani-rc-work ani-rc-work--stacked" : "ani-rc-work", order);
  const copy = element("span", "ani-rc-work-copy");
  copy.append(phrasedText("span", "ani-rc-work-title", title));
  if (stacked) {
    const list = element("span", "ani-rc-work-details");
    for (const detail of details) list.append(textElement("span", "ani-rc-work-detail", detail));
    copy.append(list);
  } else {
    copy.append(textElement("span", "ani-rc-work-detail", details.join(" · ")));
  }
  line.append(recapCover(coverUrl, title, "ani-rc-work-cover"), copy);
  return line;
};

const tileFoot = (text: string, order: number): HTMLElement => {
  const foot = tileBlock("ani-rc-tile-foot", order, "fade");
  foot.textContent = text;
  return foot;
};

const WEEKDAY_SHORT = ["日", "一", "二", "三", "四", "五", "六"] as const;

const weekdayStrip = (counts: readonly number[], topWeekday: number, order: number, withCounts: boolean): HTMLElement => {
  const strip = tileBlock("ani-rc-weekdays", order);
  strip.dataset.counts = String(withCounts);
  strip.setAttribute("aria-hidden", "true");
  const max = Math.max(1, ...counts);
  counts.forEach((count, weekday) => {
    const column = element("span", "ani-rc-weekday");
    column.dataset.top = String(weekday === topWeekday);
    const track = element("span", "ani-rc-weekday-track");
    const bar = element("span", "ani-rc-weekday-bar");
    bar.dataset.rcBar = "true";
    bar.style.setProperty("--rc-level", String(count / max));
    track.append(bar);
    column.append(track, textElement("span", "ani-rc-weekday-name", WEEKDAY_SHORT[weekday] ?? ""));
    if (withCounts) column.append(textElement("span", "ani-rc-weekday-count", formatInteger(count)));
    strip.append(column);
  });
  return strip;
};

const renderRhythm = (rhythm: RecapSummaryRhythm, deck: RecapPresentationDeck, order: number): HTMLElement => {
  const figure = part("figure", "ani-rc-rhythm", "rise", order);
  figure.dataset.granularity = rhythm.granularity;
  // 節奏條沿用擴充功能熱度圖的天藍色。
  figure.dataset.tone = "overview";
  const caption = element("figcaption", "ani-rc-rhythm-caption");
  caption.append(
    textElement("span", "ani-rc-tile-label", rhythm.granularity === "week" ? "每週節奏" : "觀看節奏"),
    textElement("strong", "ani-rc-rhythm-peak", `${rhythmLabel(rhythm.peak.key, rhythm.granularity)}最多`),
    textElement("span", "ani-rc-rhythm-detail", `${formatInteger(rhythm.peak.count)} 次${deck.scope.axis === "released-at" ? " · 依上架時間" : ""}`)
  );
  const chart = element("div", "ani-rc-rhythm-chart");
  chart.setAttribute("aria-hidden", "true");
  chart.style.setProperty("--rc-points", String(rhythm.points.length));
  const bars = element("div", "ani-rc-rhythm-bars");
  const ticks = element("div", "ani-rc-rhythm-ticks");
  const max = Math.max(1, rhythm.peak.count);
  rhythm.points.forEach((point, index) => {
    const bar = element("span", "ani-rc-rhythm-bar");
    bar.dataset.rcBar = "true";
    bar.dataset.peak = String(point.key === rhythm.peak.key);
    bar.dataset.empty = String(point.count === 0);
    bar.style.setProperty("--rc-level", String(point.count / max));
    bar.title = `${rhythmLabel(point.key, rhythm.granularity)} · ${formatInteger(point.count)} 次`;
    bars.append(bar);
    ticks.append(textElement("span", "", rhythmTick(point.key, rhythm.granularity, index)));
  });
  chart.append(bars, ticks);
  figure.append(caption, chart);
  return figure;
};

const rhythmLabel = (key: string, granularity: RecapSummaryRhythm["granularity"]): string => {
  const [year, month, day] = key.split("-").map(Number);
  if (granularity === "month") return `${year} 年 ${month} 月`;
  if (granularity === "week") return `${month}/${day} 起的那一週`;
  return `${month} 月 ${day} 日`;
};

const rhythmTick = (key: string, granularity: RecapSummaryRhythm["granularity"], index: number): string => {
  const [, month, day] = key.split("-").map(Number);
  if (granularity === "month") return `${month}月`;
  if (granularity === "week") return `${month}/${day}`;
  // 日刻度：每月第一天標月份，其餘每 5 天標一次日期，避免擠成一團。
  if (day === 1 || index === 0) return `${month}/${day}`;
  return (day ?? 0) % 5 === 0 ? String(day) : "";
};

const segmentKeyForHour = (hour: number): string => {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "daytime";
  if (hour >= 17 && hour < 23) return "evening";
  return "late-night";
};

/** 期間內每個月一號的日期（不含期間第一天本身）；超過一年份的期間不標。 */
const monthStarts = (period: RecapSummaryPeriod): string[] => {
  const keys: string[] = [];
  let [year, month] = period.startDateKey.split("-").map(Number) as [number, number];
  for (let guard = 0; guard < 14; guard += 1) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    const key = `${year}-${String(month).padStart(2, "0")}-01`;
    if (key > period.endDateKey) break;
    keys.push(key);
  }
  return keys.length <= 12 ? keys : [];
};

const dayOffset = (fromKey: string, toKey: string): number => {
  const utc = (key: string): number => {
    const [year, month, day] = key.split("-").map(Number);
    return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  };
  return Math.round((utc(toKey) - utc(fromKey)) / 86_400_000);
};

const pad = (value: number): string => String(value).padStart(2, "0");
