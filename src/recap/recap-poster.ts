import {
  formatClockHour,
  formatEpisodesPerDay,
  formatHourRange,
  formatInteger,
  formatLag,
  formatPercent,
  truncateText
} from "../analysis-format";
import { createButton, element, textElement } from "../view-dom";
import type {
  BehaviorPreferencePayload,
  DropTagPayload,
  HabitClockPayload,
  HiddenGemPayload,
  TastePayload,
  MarathonPayload,
  OverviewPayload,
  RecapChapterKind,
  RecapPresentationChapter,
  RecapPresentationDeck
} from "./recap-deck";
import {
  densitySegment,
  dropTagSentence,
  outcomeBreakdown,
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
import { taipeiWeekday } from "../time";
import type { RecapHighlight, RecapSummaryCalendar, RecapSummaryPeriod } from "./recap-summary";
import { phrasedText } from "./recap-text";

// ───────────────────────────── 版面規劃（純函式） ─────────────────────────────

export type PosterTileKind =
  | "hero"
  | "seasonal-favorites"
  | "habit-clock"
  | "marathon"
  | "timeliness"
  | "behavior-preference"
  | "completion"
  | "binge"
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
  "completion",
  "seasonal-favorites",
  "habit-clock",
  "marathon",
  "timeliness",
  "behavior-preference",
  "binge",
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
  "seasonal-favorites": 8,
  "habit-clock": 32,
  marathon: 8,
  timeliness: 8,
  "behavior-preference": 8,
  completion: 12,
  binge: 8,
  "platform-taste": 8,
  taste: 8,
  "season-breakdown": 8,
  weekday: 8
});

/** 每種磚可用的尺寸（欄 × 列），依偏好排序；資料越少，前面的磚越有機會長大。 */
export const POSTER_TILE_SIZES: Readonly<Record<PosterTileKind, readonly PosterTileSize[]>> = Object.freeze({
  hero: [[4, 4], [6, 4], [8, 4], [12, 4]],
  "seasonal-favorites": [[4, 2], [8, 1], [6, 1]],
  "habit-clock": [[4, 1], [4, 2], [8, 2], [8, 1], [8, 3], [4, 3], [4, 4], [8, 4], [2, 1]],
  marathon: [[4, 1], [2, 1], [4, 2], [8, 1]],
  timeliness: [[2, 1], [4, 1], [4, 2], [2, 2]],
  "behavior-preference": [[2, 1], [4, 1], [4, 2], [2, 2]],
  completion: [[4, 3], [4, 2], [2, 2], [2, 1]],
  binge: [[2, 1], [4, 1], [4, 2], [2, 2]],
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

/**
 * 章節 → 海報磚；英雄磚固定來自總覽。
 * 有熱度圖時，馬拉松的一天最多與最長連續已經畫在熱度圖上，不再另佔一塊磚；
 * 但作品資料還沒到、磚很少時留著它，免得英雄磚被撐成一大片空白。
 */
export const posterTileKinds = (deck: RecapPresentationDeck): PosterTileKind[] => {
  const kinds: PosterTileKind[] = ["hero"];
  const seasonal = hasSeasonalFavorites(deck);
  for (const chapter of deck.chapters) {
    if (chapter.kind === "overview" || chapter.kind === "runtime") continue;
    // 四季最愛的封面上已經標了私藏，不再另佔一塊磚。
    if (chapter.kind === "platform-taste" && seasonal) continue;
    kinds.push(chapter.kind === "behavior-preference" && seasonal ? "seasonal-favorites" : chapter.kind);
  }
  const others = kinds.filter((kind) => kind !== "hero" && kind !== "marathon").length;
  return deck.summary.calendar && others >= MIN_TILES_WITHOUT_MARATHON
    ? kinds.filter((kind) => kind !== "marathon")
    : kinds;
};

/** 其他磚至少這麼多塊，海報才不需要馬拉松磚幫忙填版面。 */
const MIN_TILES_WITHOUT_MARATHON = 3;

/** 至少兩季選得出最愛時，「有得選時先看」改成逐季的四季最愛。 */
const hasSeasonalFavorites = (deck: RecapPresentationDeck): boolean => {
  const chapter = deck.chapters.find((candidate) => candidate.kind === "behavior-preference");
  return chapter?.kind === "behavior-preference"
    && chapter.payload.seasons.filter((season) => season.rows.length > 0).length >= 2;
};

/** 可以拿來補白的磚：一週節奏只需要觀看時鐘已有的星期分布。 */
export const posterFillerKinds = (deck: RecapPresentationDeck): PosterTileKind[] =>
  deck.summary.weekdayCounts && deck.chapters.some((chapter) => chapter.kind === "habit-clock") ? ["weekday"] : [];

/** 磚 → 點了要回去的章節。 */
const tileChapterId = (kind: PosterTileKind): RecapChapterKind => {
  switch (kind) {
    case "hero": return "overview";
    case "seasonal-favorites": return "behavior-preference";
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

/**
 * 版面以 1440×900 視窗設計，那時海報是 1374×795。更大的舞台若只把海報拉高，磚會被撐得又高又空，
 * 所以改成以設計尺寸排版、再整張等比放大（CSS zoom），像一張放大印出的海報。
 * 比設計尺寸小時照原本的流動版面，不縮小。
 */
export const POSTER_DESIGN = Object.freeze({ width: 1374, height: 795, vh: 9, vw: 14.4 });
/** 只大一點點時不放大：避免 1440×900 附近因為捲軸或小數點在放大與不放大之間跳動。 */
const MIN_POSTER_ZOOM = 1.04;
const posterObservers = new WeakMap<HTMLElement, ResizeObserver>();

/** 舞台扣掉內距後能放多大的海報；回傳要放大的倍數，不放大時為 null。 */
export const posterZoomFor = (availableWidth: number, availableHeight: number): number | null => {
  const zoom = Math.min(availableWidth / POSTER_DESIGN.width, availableHeight / POSTER_DESIGN.height);
  return Number.isFinite(zoom) && zoom >= MIN_POSTER_ZOOM ? Math.floor(zoom * 1000) / 1000 : null;
};

const applyPosterZoom = (scene: HTMLElement, poster: HTMLElement): void => {
  const style = getComputedStyle(scene);
  const pixels = (value: string): number => Number.parseFloat(value) || 0;
  const zoom = posterZoomFor(
    scene.clientWidth - pixels(style.paddingLeft) - pixels(style.paddingRight),
    scene.clientHeight - pixels(style.paddingTop) - pixels(style.paddingBottom)
  );
  const current = poster.dataset.rcZoom ? Number(poster.dataset.rcZoom) : null;
  if (zoom === current) return;
  if (zoom === null) {
    delete poster.dataset.rcZoom;
    delete scene.dataset.rcZoomed;
    for (const property of ["zoom", "width", "height", "--rc-vh", "--rc-vw"]) poster.style.removeProperty(property);
    return;
  }
  poster.dataset.rcZoom = String(zoom);
  scene.dataset.rcZoomed = "true";
  poster.style.setProperty("zoom", String(zoom));
  poster.style.width = `${POSTER_DESIGN.width}px`;
  poster.style.height = `${POSTER_DESIGN.height}px`;
  poster.style.setProperty("--rc-vh", `${POSTER_DESIGN.vh}px`);
  poster.style.setProperty("--rc-vw", `${POSTER_DESIGN.vw}px`);
};

/**
 * 在量共享元素的位置之前呼叫：海報的大小要先定案，封面才會飛到放大後的位置。
 * 之後視窗縮放時由 ResizeObserver 重新套用。
 */
export const fitPoster = (scene: HTMLElement): void => {
  const poster = scene.querySelector<HTMLElement>(":scope > .ani-rc-poster");
  if (!poster) return;
  applyPosterZoom(scene, poster);
  if (posterObservers.has(poster) || typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(() => {
    if (!scene.isConnected) {
      observer.disconnect();
      posterObservers.delete(poster);
      return;
    }
    applyPosterZoom(scene, poster);
  });
  observer.observe(scene);
  posterObservers.set(poster, observer);
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
  if (summary.calendar) poster.append(renderCalendar(summary.calendar, deck, storyOrder.size + 1, callbacks));
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
  deck.chapters.forEach((chapter, index) => {
    if (chapter.kind === "overview") return;
    // 片長章不上海報：一部 24 集的作品自然排在前面，說不出什麼；它的封面已經在拼貼裡。
    if (chapter.kind !== "runtime") order.set(chapter.kind, index);
    if (chapter.kind === "behavior-preference") order.set("seasonal-favorites", index);
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
  const chapterId = tileChapterId(placement.kind);
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
    case "weekday": return chapter?.kind === "habit-clock" && deck.summary.weekdayCounts
      ? weekdayContent(deck.summary.weekdayCounts, chapter.payload, placement, order)
      : null;
    case "seasonal-favorites": return chapter?.kind === "behavior-preference"
      ? seasonalFavoritesContent(deck, chapter.payload, placement, order)
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
          `${formatPercent(leader.rawWinRate)} 的時候先看它`,
          `${formatInteger(leader.decisionBucketCount)} 次有得選`
        ], order + 0.2, true)]
      };
    }
    case "completion": {
      const payload = chapter.payload;
      // 期間內的作品全都還在播：改用「追到最新」當主數字，看完要等完結才算得出來。
      const onlyAiring = payload.startedCount === 0;
      const [count, caption] = onlyAiring
        ? [payload.caughtUpCount, `追到最新 · 還在播的 ${formatInteger(payload.airingCount)} 部中`]
        : [payload.finishedCount, `看完 · 從頭開始看的 ${formatInteger(payload.startedCount)} 部中`];
      const head = tileBlock("ani-rc-tile-head", order);
      head.append(
        quantity([{ value: formatInteger(count), unit: "部", countTo: count }], "ani-rc-tile-value"),
        textElement("span", "ani-rc-tile-caption", caption)
      );
      const blocks: HTMLElement[] = [head];
      if (!onlyAiring) blocks.push(outcomeBreakdown(payload, order + 0.3));
      // 大磚有空間時，把各類型的放棄比例畫出來；句子就不必再說一次。
      const table = placement.rowSpan >= 3 ? tagDropTable(payload.tagDrops, order + 0.45) : null;
      if (table) blocks.push(table);
      const nearest = payload.nearlyRows[0];
      const notes = [
        table ? null : dropTagSentence(payload),
        nearest ? `差一點就看完：《${nearest.title}》只差 ${formatInteger(nearest.totalEpisode - nearest.watchedEpisodeCount)} 集` : null,
        !onlyAiring && payload.caughtUpCount > 0 ? `還在播的作品裡，有 ${formatInteger(payload.caughtUpCount)} 部追到最新` : null
      ].filter((text): text is string => text !== null);
      const room = placement.rowSpan >= 3 ? (table ? 2 : 3) : placement.rowSpan >= 2 ? 1 : 0;
      if (room > 0 && notes.length > 0) {
        const list = part("ul", "ani-rc-tile-notes", "fade", order + 0.5);
        for (const text of notes.slice(0, room)) list.append(textElement("li", "", text));
        blocks.push(list);
      }
      return { label: "追番成績單", blocks };
    }
    case "binge": {
      const leader = chapter.payload.rows[0];
      if (!leader) return null;
      return {
        label: "補番速度",
        blocks: [workLine(leader.title, leader.coverUrl, [
          `平均 ${formatEpisodesPerDay(leader.episodesPerDay)}`
        ], order + 0.2, true)]
      };
    }
    case "platform-taste": {
      const gem = chapter.payload.gems[0];
      if (!gem) return null;
      return {
        label: "你的私藏",
        blocks: [workLine(gem.title, gem.coverUrl, [
          `同季人氣第 ${formatInteger(gem.popularityRank)} / ${formatInteger(gem.cohortSize)}`,
          `約同季最熱門的 ${formatPercent(gem.popularityRatio)}`
        ], order + 0.2, true)]
      };
    }
    case "taste": {
      const payload = chapter.payload;
      const leaderLabel = payload.tags.length > 0 ? "最常看的類型" : payload.makers.length > 0 ? "最常看的製作方" : "口味";
      // 大磚：標籤換成有部數長條的排行，旁邊列出製作名單，不留一大片空白。
      if (roomy && wide && payload.tags.length >= 3) return { label: leaderLabel, blocks: [tasteBoard(payload, order + 0.2)] };
      const chips = part("ul", "ani-rc-chips", "rise", order + 0.2);
      const chipSource = payload.tags.length > 0 ? payload.tags : payload.makers.length > 0 ? payload.makers : payload.directors.length > 0 ? payload.directors : payload.publishers;
      // 放不下的標籤整顆換到被裁掉的下一排，不會出現半顆。
      chipSource.slice(0, wide ? 6 : 4).forEach((row, index) => {
        const chip = textElement("li", "ani-rc-chip", row.label);
        chip.dataset.rank = String(index + 1);
        chips.append(chip);
      });
      const blocks: HTMLElement[] = [chips];
      // 第一名的份量：幾部作品，填在標籤與製作名單之間。
      const top = chipSource[0];
      if (top) {
        const lead = tileBlock("ani-rc-taste-lead", order + 0.3);
        lead.textContent = `${top.label} · ${formatInteger(top.animeCount)} 部作品`;
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
          textElement("span", "ani-rc-mini-season-count", `${formatInteger(row.watchCount)} 集`)
        );
        chart.append(column);
      }
      return { label: `${payload.year} 四季`, blocks: [chart] };
    }
    default:
      return null;
  }
};

/** 大的口味磚：左邊前五名類型（依部數，附長條），右邊動畫公司、導演、代理商各自的第一名。 */
const tasteBoard = (payload: TastePayload, order: number): HTMLElement => {
  const board = tileBlock("ani-rc-taste-board", order);
  const tags = payload.tags.slice(0, 5);
  const max = Math.max(1, ...tags.map((tag) => tag.animeCount));
  const list = element("ol", "ani-rc-taste-bars");
  for (const tag of tags) {
    const item = element("li", "ani-rc-bar-row");
    item.append(
      textElement("span", "ani-rc-drop-label", tag.label),
      meterBar(tag.animeCount / max),
      textElement("span", "ani-rc-drop-value", `${formatInteger(tag.animeCount)} 部`)
    );
    list.append(item);
  }
  const credits = element("ul", "ani-rc-taste-credits");
  const creditRows: readonly [string, TastePayload["makers"][number] | undefined][] = [
    ["動畫公司", payload.makers[0]],
    ["導演", payload.directors[0]],
    ["代理商", payload.publishers[0]]
  ];
  for (const [label, row] of creditRows) {
    if (!row) continue;
    const item = element("li", "ani-rc-taste-credit");
    item.append(
      textElement("span", "ani-rc-credit-label", label),
      textElement("strong", "ani-rc-taste-credit-value", row.label),
      textElement("span", "ani-rc-taste-credit-meta", `${formatInteger(row.animeCount)} 部作品`)
    );
    credits.append(item);
  }
  board.append(list);
  if (credits.childElementCount > 0) board.append(credits);
  return board;
};

/**
 * 各類型的放棄比例：類型太多時列最常放棄的三個，再接最能看完的一個，讓兩端的對比留在畫面上。
 * 少於三個類型時不畫，比例條沒有可以比較的對象。
 */
const tagDropTable = (tags: readonly DropTagPayload[], order: number): HTMLElement | null => {
  if (tags.length < 3) return null;
  const shown = tags.length > 4 ? [...tags.slice(0, 3), tags.at(-1)!] : tags;
  const block = tileBlock("ani-rc-drops", order);
  block.append(textElement("span", "ani-rc-drops-title", "各類型的放棄比例"));
  const list = element("ol", "ani-rc-drops-list");
  shown.forEach((tag, index) => {
    const item = element("li", "ani-rc-drop");
    if (tags.length > 4 && index === 3) item.dataset.gap = "true";
    item.append(
      textElement("span", "ani-rc-drop-label", tag.label),
      // 依實際比例畫：放棄三成的類型不該畫成滿格。
      meterBar(tag.dropRate),
      textElement("span", "ani-rc-drop-value", `${formatInteger(tag.droppedCount)} / ${formatInteger(tag.startedCount)} 部`)
    );
    list.append(item);
  });
  block.append(list);
  return block;
};

/**
 * 四季最愛：每季一欄、前三名的封面，下面寫第一名的作品名。私藏的封面加框並掛上標籤，
 * 底部用一行說明它為什麼算私藏。窄而高的磚排成兩欄兩列，寬而矮的排成一列。
 */
const seasonalFavoritesContent = (
  deck: RecapPresentationDeck,
  payload: BehaviorPreferencePayload,
  placement: PosterPlacement,
  order: number
): TileSpec => {
  const platform = deck.chapters.find((chapter) => chapter.kind === "platform-taste");
  const gems = new Map((platform?.kind === "platform-taste" ? platform.payload.gems : []).map((gem) => [gem.animeSn, gem]));
  const board = tileBlock("ani-rc-fav-board", order + 0.2);
  board.dataset.layout = placement.rowSpan >= 2 ? "grid" : "row";
  board.style.setProperty("--rc-seasons", String(payload.seasons.length));
  let shownGem: HiddenGemPayload | null = null;
  for (const season of payload.seasons) {
    const column = element("section", "ani-rc-fav-season");
    column.append(textElement("span", "ani-rc-fav-season-name", season.label));
    const leader = season.rows[0];
    if (!leader) {
      column.append(textElement("span", "ani-rc-fav-empty", "還看不出來"));
    } else {
      const covers = element("ol", "ani-rc-fav-covers");
      for (const row of season.rows) {
        const item = element("li", "ani-rc-fav-item");
        item.append(recapCover(row.coverUrl, row.title, "ani-rc-fav-cover"));
        const gem = gems.get(row.animeSn);
        if (gem) {
          item.dataset.gem = "true";
          item.append(textElement("span", "ani-rc-fav-gem", "私藏"));
          shownGem ??= gem;
        }
        covers.append(item);
      }
      column.append(covers, textElement("span", "ani-rc-fav-title", leader.title));
    }
    board.append(column);
  }
  const blocks: HTMLElement[] = [board];
  if (shownGem) {
    blocks.push(tileFoot(`私藏《${shownGem.title}》：同季 ${formatInteger(shownGem.cohortSize)} 部裡人氣第 ${formatInteger(shownGem.popularityRank)}`, order + 0.6));
  }
  return { label: payload.seasons.length === 4 ? "四季最愛" : "每季最愛", blocks };
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
    quantity([{ value: formatInteger(payload.peakDay.watchCount), unit: "集", countTo: payload.peakDay.watchCount }], "ani-rc-tile-value"),
    textElement("span", "ani-rc-tile-caption", roomy
      ? `一天最多 · ${formatDateKey(payload.peakDay.dateKey)}`
      : `一天最多 · ${formatShortDateKey(payload.peakDay.dateKey)}`)
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
      textElement("span", "ani-rc-tile-caption", "當天觀看時間")
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
    textElement("span", "ani-rc-tile-caption", `${formatInteger(top.watchCount)} 集 · 一週裡最常看`)
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
    : [{ value: formatInteger(summary.hero.count), unit: "集", countTo: summary.hero.count, countKey: "watch-count" }];
  hero.dataset.rcShared = summary.hero.kind === "known-runtime" ? "metric-runtime" : "metric-watch";
  const figure = quantity(segments, "ani-rc-hero-figure");
  const length = segments.reduce((sum, segment) => sum + [...segment.value].length + [...(segment.unit ?? "")].length * 0.4, 0);
  if (length > 6.5) figure.dataset.long = "true";
  hero.append(
    figure,
    textElement("span", "ani-rc-hero-note", summary.hero.kind === "known-runtime" ? "觀看時間" : "看過的集數")
  );
  blocks.push(hero);
  if (summary.highlights.length > 0) blocks.push(highlightsBlock(summary.highlights, order + 0.7));
  if (overview && overview.kind === "overview") {
    const payload = overview.payload;
    // 有熱度圖時，「幾天有看」寫在熱度圖旁，英雄磚不再重複。
    const meter = summary.calendar ? null : activeDaysMeter(payload, summary.period, order + 0.75);
    if (meter) blocks.push(meter);
    blocks.push(heroKpis(payload, summary, placement, meter !== null || summary.calendar !== null, order + 0.9));
  }
  return { label: `${deck.scope.label}的你`, blocks };
};

/** 只對這個人成立的亮點：封面縮圖加一句話，沒過門檻的根本不會進來。 */
const highlightsBlock = (highlights: readonly RecapHighlight[], order: number): HTMLElement => {
  const list = part("ul", "ani-rc-highlights", "rise", order);
  for (const highlight of highlights) {
    const [label, text, coverUrl, coverTitle] = highlightCopy(highlight);
    const item = element("li", "ani-rc-highlight");
    item.dataset.kind = highlight.kind;
    const copy = element("span", "ani-rc-highlight-copy");
    copy.append(textElement("span", "ani-rc-highlight-label", label), phrasedText("span", "ani-rc-highlight-text", text));
    item.append(recapCover(coverUrl, coverTitle, "ani-rc-highlight-cover"), copy);
    list.append(item);
  }
  return list;
};

const highlightCopy = (highlight: RecapHighlight): readonly [label: string, text: string, coverUrl: string | null, coverTitle: string] => {
  const work = (title: string): string => `《${truncateText(title, 12)}》`;
  switch (highlight.kind) {
    case "new-year": {
      const { before, after } = highlight;
      const lead = after ?? before!;
      const text = before && after
        ? `${before.time} 還在看${work(before.title)}${before.episode}，過了午夜 ${after.time} 接著看${work(after.title)}${after.episode}`
        : after
          ? `新年第一集：${after.time}${work(after.title)}${after.episode}`
          : `跨年那一刻，你在看${work(lead.title)}${lead.episode}（${lead.time}）`;
      return [`看著動畫跨進 ${highlight.year}`, text, lead.coverUrl, lead.title];
    }
    case "dawn": {
      const { last } = highlight;
      return [
        "天亮了還在看",
        `${last.dateLabel} 從 ${highlight.startTime} 一路看了 ${formatInteger(highlight.episodeCount)} 集，最後是早上 ${last.time} 的${work(last.title)}${last.episode}`,
        last.coverUrl,
        last.title
      ];
    }
    case "old-works":
      return [
        "補舊作",
        `看了 ${formatInteger(highlight.workCount)} 部開播兩年以上的作品，最老的是 ${highlight.oldest.premiereYear} 年的${work(highlight.oldest.title)}`,
        highlight.oldest.coverUrl,
        highlight.oldest.title
      ];
  }
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
  const watchCell: KpiCell = ["集", [{ value: formatInteger(payload.watchCount), countTo: payload.watchCount, countKey: "watch-count" }], "metric-watch"];
  const episodeCell: KpiCell = ["不同單集", [{ value: formatInteger(payload.uniqueEpisodeCount), countTo: payload.uniqueEpisodeCount, countKey: "episode-count" }], undefined];
  const rewatchCell: KpiCell = ["重看", [{ value: formatInteger(rewatchCount), unit: "次", countTo: rewatchCount }], undefined];
  const animeCell: KpiCell = ["部作品", [{ value: formatInteger(payload.identifiableAnimeCount), countTo: payload.identifiableAnimeCount, countKey: "anime-count" }], "metric-anime"];
  const daysCell: KpiCell = [activeDayLabel, [{ value: formatInteger(payload.activeDayCount), unit: "天", countTo: payload.activeDayCount, countKey: "active-days" }], "metric-days"];
  const densityCell: KpiCell = [payload.axis === "released-at" ? "有上架的日子平均" : "有看的日子平均", [densitySegment(payload.watchCount, payload.activeDayCount)], undefined];
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

/**
 * 熱度圖的四階顏色。一年裡總有幾天特別瘋狂：若照最大值等分，其他日子會全擠在最淺的一階，
 * 所以改用有看的日子的四分位數分級；最多只看幾集時，直接一集一階。
 */
const calendarLevels = (days: readonly { readonly count: number }[]): ((count: number) => number) => {
  const counts = days.map((day) => day.count).filter((count) => count > 0).sort((left, right) => left - right);
  const max = counts.at(-1) ?? 0;
  if (max <= 4) return (count) => Math.max(0, Math.min(4, count));
  const quantile = (ratio: number): number => counts[Math.min(counts.length - 1, Math.floor(ratio * counts.length))]!;
  const [q1, q2, q3] = [quantile(0.25), quantile(0.5), quantile(0.75)];
  return (count) => count <= 0 ? 0 : count <= q1 ? 1 : count <= q2 ? 2 : count <= q3 ? 3 : 4;
};

/**
 * 整段期間的熱度圖：一天一格、一欄一週（週日在上）。
 * 一天最多的那格加框，最長連續在格子下方畫一條亮帶；兩者的數字寫在右側，
 * 不需要另外的圖例。
 */
/** 這麼短的期間改用一列一天的熱度圖。 */
const CALENDAR_STRIP_MAX_DAYS = 62;

const renderCalendar = (
  calendar: RecapSummaryCalendar,
  deck: RecapPresentationDeck,
  order: number,
  callbacks: PosterCallbacks
): HTMLElement => {
  const releaseAxis = deck.scope.axis === "released-at";
  const figure = part("figure", "ani-rc-calendar", "rise", order);
  // 沿用擴充功能熱度圖的天藍色。
  figure.dataset.tone = "overview";

  const total = calendar.days.length;
  const caption = element("figcaption", "ani-rc-calendar-caption");
  const days = element("strong", "ani-rc-calendar-days");
  days.append(
    textElement("span", "", formatInteger(calendar.activeDayCount)),
    textElement("span", "ani-rc-calendar-total", `/ ${formatInteger(total)} 天`)
  );
  caption.append(
    textElement("span", "ani-rc-tile-label", "每一天"),
    days,
    textElement("span", "ani-rc-calendar-detail", `${releaseAxis ? "有上架集數" : "有看動畫"} · ${formatPercent(calendar.activeDayCount / Math.max(1, total))}`)
  );

  const chart = element("div", "ani-rc-calendar-chart");
  chart.setAttribute("aria-hidden", "true");
  // 兩個月以內的期間只有幾欄：改成一天一格排成一列，才不會縮成角落的一小塊。
  const strip = total <= CALENDAR_STRIP_MAX_DAYS;
  figure.dataset.layout = strip ? "strip" : "weeks";
  const firstKey = calendar.days[0]!.dateKey;
  const lead = strip ? 0 : taipeiWeekday(firstKey);
  const weekCount = Math.ceil((lead + total) / 7);
  const columnCount = strip ? total : weekCount;
  chart.style.setProperty("--rc-columns", String(columnCount));
  const weekOf = (index: number): number => strip ? index : Math.floor((lead + index) / 7);

  const months = element("div", "ani-rc-calendar-months");
  const monthLabels = calendar.days.flatMap((day, index) => {
    const dayOfMonth = Number(day.dateKey.slice(8, 10));
    const month = Number(day.dateKey.slice(5, 7));
    if (strip) {
      // 一列的版本標日期：第一天、每月一號，其餘每五天一個。
      if (index === 0 || dayOfMonth === 1) return [{ column: index, text: `${month}/${dayOfMonth}` }];
      return dayOfMonth % 5 === 0 ? [{ column: index, text: String(dayOfMonth) }] : [];
    }
    if (index !== 0 && dayOfMonth !== 1) return [];
    // 第一天落在週中時，月份標在下一欄。
    const column = index === 0 && lead > 3 ? weekOf(index) + 1 : weekOf(index);
    return column < weekCount ? [{ column, text: `${month}月` }] : [];
  });
  // 期間從月底開始時，第一個月份離下個月太近：省略它，不讓兩個標籤疊在一起。
  monthLabels.forEach((month, index) => {
    const following = monthLabels[index + 1];
    if (following && following.column - month.column < 3) return;
    const label = textElement("span", "", month.text);
    label.style.gridColumn = String(month.column + 1);
    months.append(label);
  });

  const level = calendarLevels(calendar.days);
  const grid = element("div", "ani-rc-calendar-grid");
  const streak = calendar.longestStreak;
  const inStreak = (key: string): boolean => streak !== null && key >= streak.fromDateKey && key <= streak.toDateKey;
  for (let pad = 0; pad < lead; pad += 1) {
    const blank = element("span", "ani-rc-cal-day");
    blank.dataset.pad = "true";
    grid.append(blank);
  }
  for (const day of calendar.days) {
    const cell = element("span", "ani-rc-cal-day");
    cell.dataset.level = String(level(day.count));
    if (day.dateKey === calendar.peak.dateKey) cell.dataset.peak = "true";
    if (inStreak(day.dateKey)) cell.dataset.streak = "true";
    cell.title = `${formatShortDateKey(day.dateKey)} · ${formatInteger(day.count)} 集`;
    grid.append(cell);
  }
  chart.append(months, grid);
  if (streak) {
    const band = element("div", "ani-rc-calendar-band");
    const bar = element("span", "ani-rc-calendar-streak");
    const fromIndex = calendar.days.findIndex((day) => day.dateKey === streak.fromDateKey);
    const toIndex = calendar.days.findIndex((day) => day.dateKey === streak.toDateKey);
    bar.style.gridColumn = `${weekOf(fromIndex) + 1} / ${weekOf(toIndex) + 2}`;
    band.append(bar);
    chart.append(band);
  }

  const facts = element("ul", "ani-rc-calendar-facts");
  const fact = (mark: "streak" | "peak", value: string, label: string): HTMLElement => {
    const item = element("li", "ani-rc-calendar-fact");
    item.dataset.mark = mark;
    const swatch = element("span", "ani-rc-calendar-mark");
    swatch.setAttribute("aria-hidden", "true");
    item.append(swatch, textElement("strong", "", value), textElement("span", "", label));
    return item;
  };
  if (streak) {
    facts.append(fact("streak", `${formatInteger(streak.days)} 天`, `最長連續 · ${formatShortDateKey(streak.fromDateKey)}–${formatShortDateKey(streak.toDateKey)}`));
  }
  facts.append(fact("peak", `${formatInteger(calendar.peak.count)} 集`, `${releaseAxis ? "上架最多的一天" : "一天最多"} · ${formatShortDateKey(calendar.peak.dateKey)}`));

  figure.append(caption, chart, facts);
  // 熱度圖接手了馬拉松磚：點它回到馬拉松章（沒有時回到總覽）。
  const marathonIndex = deck.chapters.findIndex((chapter) => chapter.kind === "marathon");
  const index = marathonIndex >= 0 ? marathonIndex : deck.chapters.findIndex((chapter) => chapter.kind === "overview");
  const target = deck.chapters[index];
  if (target) figure.append(stretchedLink(index, target, () => callbacks.onGoto(target.id)));
  return figure;
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
