import type { RecapPresentationDeck } from "./recap-deck";
import { recapPaletteCss } from "./recap-palette";
import type { RecapUiState } from "./recap-state";

export const RECAP_EVIDENCE_OPENER_FOCUS_KEY = "recap-evidence-opener";

export const handleRecapStageNavigationKey = (
  event: Pick<KeyboardEvent,
    "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "preventDefault" | "stopPropagation"
  >,
  onPrevious: () => void,
  onNext: () => void
): boolean => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return false;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "ArrowLeft") onPrevious();
  else onNext();
  return true;
};

/** 換章時給螢幕報讀器的一句話：「第 N 章：標題」，結尾則報總結標題。 */
export const recapAnnouncement = (state: RecapUiState<RecapPresentationDeck>): string | null => {
  if (state.kind === "recap-chapter") {
    const index = state.deck.chapters.findIndex((chapter) => chapter.id === state.chapterId);
    const chapter = state.deck.chapters[index];
    return chapter ? `第 ${index + 1} 章：${chapter.title}` : null;
  }
  if (state.kind === "recap-summary") return `回顧總結：${state.deck.summary.title}`;
  return null;
};

const RECAP_GRAIN_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3CfeComponentTransfer%3E%3CfeFuncA type='linear' slope='0.055'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23g)'/%3E%3C/svg%3E";

const theaterCss = `
.ani-rc-theater { position: relative; isolation: isolate; display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); min-height: 100%; overflow: hidden; background: var(--rc-bg); color: var(--rc-ink);
  --rc-bg: #060a14;
  --rc-ink: #f4f7ff;
  --rc-ink-2: rgba(214, 224, 248, .84);
  --rc-ink-3: rgba(170, 186, 222, .7);
  --rc-line: rgba(148, 170, 220, .16);
  --rc-line-strong: rgba(148, 170, 220, .32);
  --rc-surface: rgba(146, 172, 228, .06);
  --rc-surface-strong: rgba(146, 172, 228, .12);
  --rc-accent: #7dd3fc;
  --rc-on-accent: #081020;
  --rc-top-inset: 0px;
  /* 與 analysis-view 的標題列共用：章節內容、進度列與標題列對齊同一條邊。 */
  --rc-gutter: clamp(28px, 5.2vw, 84px);
  --rc-stage-width: 1240px;
  --rc-poster-gutter: clamp(20px, 2.3vw, 36px);
  --rc-poster-width: 1500px;
}
.ani-rc-theater[data-layout="intro"] { border-radius: 22px; box-shadow: var(--ani-shadow-2); }
.ani-rc-theater[data-layout="playback"] { height: 100%; min-height: 0; --rc-top-inset: var(--ani-header-block, 64px); }
/* 收回開場卡片時劇場暫時蓋在標題列上（z-index 高於標題列的 20）：深色卡片一路縮回，
   亮的標題列是被「露出來」的，而不是一層淺色幕疊在深色劇場上變成灰帶。 */
.ani-rc-theater[data-morph="true"] { z-index: 21; border-radius: 0; box-shadow: none; }
${recapPaletteCss()}
/* 背景 field：色調由註冊過的 custom property 內插，三團光暈只用 transform 漂移、永不重啟。 */
.ani-rc-field { position: absolute; z-index: -3; inset: 0; overflow: hidden; contain: strict; pointer-events: none; background:
  radial-gradient(72% 64% at 86% 2%, color-mix(in oklab, var(--ani-rc-glow) 40%, transparent), transparent 70%),
  radial-gradient(78% 72% at 2% 106%, color-mix(in oklab, var(--ani-rc-haze) 15%, transparent), transparent 72%),
  linear-gradient(180deg, var(--ani-rc-base) 0%, color-mix(in oklab, var(--ani-rc-base) 52%, #03060c) 60%, #03050a 100%);
  transition: --ani-rc-base 1100ms var(--ani-ease), --ani-rc-glow 1000ms var(--ani-ease), --ani-rc-haze 1200ms var(--ani-ease); }
.ani-rc-blob { position: absolute; width: 60vmax; aspect-ratio: 1; border-radius: 50%; background: radial-gradient(closest-side, color-mix(in oklab, var(--ani-rc-haze) 18%, transparent), transparent); will-change: transform; animation: ani-rc-drift 46s ease-in-out infinite alternate; }
.ani-rc-blob:nth-child(1) { left: -20vmax; top: -26vmax; }
.ani-rc-blob:nth-child(2) { right: -24vmax; top: 4vmax; width: 52vmax; background: radial-gradient(closest-side, color-mix(in oklab, var(--ani-rc-glow) 28%, transparent), transparent); animation-duration: 58s; animation-direction: alternate-reverse; }
.ani-rc-blob:nth-child(3) { left: 30%; bottom: -36vmax; width: 56vmax; animation-duration: 64s; }
/* imprint：主角封面縮成極小的模糊點陣圖再放大，只留下一抹色，不是被拉伸的封面。 */
.ani-rc-imprint { position: absolute; z-index: -2; inset: 0; overflow: hidden; pointer-events: none; -webkit-mask-image: radial-gradient(110% 92% at 74% 40%, #000 12%, transparent 76%); mask-image: radial-gradient(110% 92% at 74% 40%, #000 12%, transparent 76%); }
.ani-rc-imprint-layer { position: absolute; inset: -10%; width: 120%; height: 120%; opacity: 0; transition: opacity 1000ms var(--ani-ease); }
.ani-rc-imprint-layer[data-visible="true"] { opacity: .3; }
.ani-rc-grain { position: absolute; z-index: -1; inset: 0; pointer-events: none; background:
  url("${RECAP_GRAIN_URI}") repeat,
  radial-gradient(125% 105% at 50% 38%, transparent 58%, rgba(2, 4, 10, .55) 100%); }
.ani-rc-viewport { position: relative; grid-area: 1 / 1; display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); min-width: 0; min-height: 0; }
.ani-rc-scene { position: relative; grid-area: 1 / 1; min-width: 0; min-height: 0; }
.ani-rc-theater[data-layout="playback"] .ani-rc-scene { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: rgba(148, 170, 220, .3) transparent; }
.ani-rc-scene[data-rc-leaving] { pointer-events: none; }
.ani-rc-scene[data-rc-pinned] { margin: 0; overflow: hidden; }
.ani-rc-theater[data-evidence="open"] :is(.ani-rc-blob, .ani-rc-intro-cover-art) { animation-play-state: paused; }
/* 常駐 chrome 與操作列：只有章節模式顯示，開場與結尾淡出但不重建。 */
.ani-rc-chrome, .ani-rc-controls { position: absolute; z-index: 3; left: 0; right: 0; width: min(100%, calc(var(--rc-stage-width) + 2 * var(--rc-gutter))); margin-inline: auto; --ani-rc-accent: var(--rc-accent);
  transition: opacity 420ms var(--ani-ease) 120ms, translate 560ms var(--ani-ease-out) 120ms, visibility 0s, --ani-rc-accent 900ms var(--ani-ease); }
.ani-rc-chrome { top: var(--rc-top-inset); display: grid; gap: 8px; padding: 16px var(--rc-gutter) 0; }
.ani-rc-controls { bottom: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 12px; padding: 16px var(--rc-gutter) max(22px, env(safe-area-inset-bottom)); }
.ani-rc-controls > :first-child { justify-self: start; }
.ani-rc-controls > :last-child { justify-self: end; }
.ani-rc-theater:not([data-mode="chapter"]) :is(.ani-rc-chrome, .ani-rc-controls) { visibility: hidden; opacity: 0; transition: opacity 220ms var(--ani-ease), translate 260ms var(--ani-ease), visibility 0s 260ms; }
.ani-rc-theater:not([data-mode="chapter"]) .ani-rc-chrome { translate: 0 -12px; }
.ani-rc-theater:not([data-mode="chapter"]) .ani-rc-controls { translate: 0 14px; }
.ani-rc-progress { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 6px; }
.ani-rc-segment { position: relative; display: block; height: 18px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; padding: 0; }
.ani-rc-segment::before { content: ""; position: absolute; left: 0; right: 0; top: 7px; height: 4px; border-radius: 999px; background: rgba(148, 170, 220, .2); transition: background var(--ani-dur-1) var(--ani-ease); }
.ani-rc-segment:hover::before { background: rgba(148, 170, 220, .38); }
.ani-rc-segment-fill { position: absolute; left: 0; right: 0; top: 7px; height: 4px; border-radius: 999px; background: var(--ani-rc-accent); transform-origin: left center; scale: 0 1; transition: scale 680ms var(--ani-ease-out), opacity 200ms var(--ani-ease), box-shadow 400ms var(--ani-ease); }
/* 往回跳（例如從結尾點回某一章）時，後面的段落直接淡掉，不讓一排縮回去的殘段停在畫面上。 */
.ani-rc-segment[data-state="upcoming"] .ani-rc-segment-fill { opacity: 0; transition: opacity 150ms cubic-bezier(0, 0, .2, 1), scale 0s linear 150ms, box-shadow 150ms var(--ani-ease); }
.ani-rc-segment[data-state="done"] .ani-rc-segment-fill { scale: 1 1; opacity: .62; }
.ani-rc-segment[data-state="current"] .ani-rc-segment-fill { scale: 1 1; box-shadow: 0 0 14px color-mix(in srgb, var(--ani-rc-accent) 60%, transparent); }
.ani-rc-segment:focus-visible { outline: 2px solid var(--ani-rc-accent); outline-offset: 2px; }
.ani-rc-chrome-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 22px; }
.ani-rc-chrome-count { color: var(--rc-ink-3); font-size: 11px; font-weight: 800; letter-spacing: .14em; font-variant-numeric: tabular-nums; }
.ani-rc-controls-center { display: grid; justify-items: center; gap: 6px; }
.ani-rc-controls-hint { color: var(--rc-ink-3); font-size: 11px; letter-spacing: .04em; }
.ani-recap-stale { width: fit-content; border: 1px solid rgba(252, 211, 77, .45); border-radius: 999px; background: rgba(252, 211, 77, .12); color: #fcd34d; font-size: 11px; font-weight: 800; padding: 4px 10px; }
.ani-recap-stale[hidden] { display: none; }
.ani-recap-primary-button, .ani-recap-ghost-button, .ani-recap-evidence-button { min-height: 44px; border-radius: var(--ani-r-pill); cursor: pointer; font: inherit; font-size: 13px; font-weight: 900; padding: 10px 22px; transition: transform var(--ani-dur-1) var(--ani-ease), background var(--ani-dur-1) var(--ani-ease), box-shadow var(--ani-dur-1) var(--ani-ease), color var(--ani-dur-1) var(--ani-ease); }
.ani-recap-primary-button { border: 0; background: #f4f7ff; color: #0a1120; box-shadow: 0 14px 34px rgba(2, 6, 18, .5); }
.ani-recap-primary-button:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 18px 40px rgba(2, 6, 18, .6), 0 0 24px color-mix(in srgb, var(--rc-accent) 32%, transparent); }
.ani-recap-ghost-button, .ani-recap-evidence-button { border: 1px solid var(--rc-line-strong); background: rgba(148, 173, 229, .06); color: var(--rc-ink-2); }
.ani-recap-ghost-button:hover:not(:disabled), .ani-recap-evidence-button:hover:not(:disabled) { background: rgba(148, 173, 229, .15); color: var(--rc-ink); }
.ani-recap-primary-button:disabled { cursor: not-allowed; opacity: .5; }
.ani-rc-theater button:focus-visible { outline: 3px solid var(--rc-accent); outline-offset: 2px; }
`;

const typeCss = `
.ani-recap-eyebrow { display: flex; align-items: center; gap: 10px; margin: 0; color: var(--rc-accent); font-size: 12px; font-weight: 900; letter-spacing: .24em; text-transform: uppercase; }
.ani-recap-eyebrow::before { content: ""; width: 24px; height: 2px; border-radius: 999px; background: var(--rc-accent); }
.ani-recap-title-em { display: inline-block; max-inline-size: 100%; font-style: normal; color: var(--rc-accent); text-wrap: balance; }
/* 中文標題只在詞與詞之間（<wbr>）換行：keep-all 擋掉字與字之間的斷點，真的放不下才硬斷。 */
/* 行首的《「只佔半格（字型的 halt），換行後的左緣才和上一行對齊。 */
.ani-rc-title, .ani-rc-intro-title, .ani-rc-poster-title { color: var(--rc-ink); font-weight: 900; text-wrap: balance; word-break: keep-all; overflow-wrap: anywhere; text-spacing-trim: trim-start; }
.ani-rc-nowrap { white-space: nowrap; }
.ani-rc-title[data-wrap="plain"], .ani-rc-intro-title[data-wrap="plain"] { text-wrap: wrap; }
.ani-rc-title[data-fit="1"] { font-size: clamp(30px, 3.5vw, 52px); }
.ani-rc-title[data-fit="2"] { font-size: clamp(28px, 3vw, 44px); }
.ani-rc-intro-title[data-fit="1"] { font-size: clamp(34px, 4.6vw, 62px); }
.ani-rc-intro-title[data-fit="2"] { font-size: clamp(30px, 3.8vw, 52px); }
.ani-rc-title:focus, .ani-rc-intro-title:focus, .ani-rc-poster-title:focus, .ani-recap-evidence-title:focus { outline: none; }
.ani-rc-title { margin: 18px 0 0; max-inline-size: 14em; font-size: clamp(34px, 4.1vw, 62px); letter-spacing: -.02em; line-height: 1.14; }
.ani-rc-narrative, .ani-rc-lede { max-inline-size: 26em; margin: 20px 0 0; color: var(--rc-ink-2); font-size: clamp(15px, 1.3vw, 18px); line-height: 1.85; text-wrap: pretty; word-break: keep-all; overflow-wrap: anywhere; }
.ani-rc-unit { margin-inline: .14em .18em; font-size: .4em; font-weight: 800; letter-spacing: 0; }
.ani-rc-unit:last-child { margin-inline-end: 0; }
/* 跳動中的數字鎖住最終寬度、靠左長出來，和左對齊的標籤同一條邊。 */
.ani-rc-num { display: inline-block; font-variant-numeric: tabular-nums; text-align: start; }
.ani-rc-minor { display: inline-flex; align-items: baseline; }
`;

const introCss = `
.ani-rc-intro { display: grid; align-items: center; padding: clamp(34px, 6vw, 80px) clamp(24px, 5.6vw, 76px); }
.ani-rc-intro-grid { display: grid; grid-template-columns: minmax(0, 1.12fr) minmax(0, .88fr); align-items: center; gap: clamp(26px, 5vw, 70px); width: min(100%, 1180px); margin-inline: auto; }
.ani-rc-intro-grid[data-poster="false"] { grid-template-columns: minmax(0, 1fr); }
.ani-rc-intro-copy { min-width: 0; }
.ani-rc-intro-title { margin: 18px 0 0; max-inline-size: 14em; font-size: clamp(38px, 5.6vw, 76px); letter-spacing: -.02em; line-height: 1.1; }
.ani-rc-intro-facts { display: flex; flex-wrap: wrap; gap: 22px 36px; margin-top: 34px; border-block: 1px solid var(--rc-line); padding: 16px 0; }
.ani-rc-intro-fact { display: grid; gap: 4px; min-width: 92px; }
.ani-rc-intro-fact .ani-rc-fact-label { color: var(--rc-ink-3); font-size: 11px; font-weight: 800; letter-spacing: .1em; }
.ani-rc-intro-fact .ani-rc-fact-value { display: flex; align-items: baseline; color: var(--rc-ink); font-size: 26px; font-weight: 900; letter-spacing: -.02em; line-height: 1.1; }
.ani-rc-intro-fact .ani-rc-unit { font-size: .6em; }
.ani-rc-intro-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 32px; }
.ani-rc-intro-poster { position: relative; height: min(48vh, 440px); min-width: 0; }
.ani-rc-intro-cover { position: absolute; width: clamp(140px, 14vw, 196px); aspect-ratio: 3 / 4; }
.ani-rc-intro-cover:nth-child(1) { z-index: 3; top: 6%; right: 10%; rotate: 5deg; }
.ani-rc-intro-cover:nth-child(2) { z-index: 2; top: 30%; left: 4%; rotate: -7deg; }
.ani-rc-intro-cover:nth-child(3) { z-index: 1; bottom: 0; right: 34%; rotate: 2deg; opacity: .9; }
.ani-rc-intro-cover-art { display: grid; place-items: center; width: 100%; height: 100%; overflow: hidden; border: 1px solid rgba(255, 255, 255, .12); border-radius: 16px; background: var(--rc-surface-strong); box-shadow: 0 30px 70px rgba(0, 0, 0, .55); animation: ani-recap-float 7s ease-in-out infinite alternate; }
.ani-rc-intro-cover:nth-child(2) .ani-rc-intro-cover-art { animation-duration: 8s; animation-delay: .6s; animation-direction: alternate-reverse; }
.ani-rc-intro-cover:nth-child(3) .ani-rc-intro-cover-art { animation-duration: 9s; animation-delay: 1.1s; }
.ani-rc-intro-cover-art img { width: 100%; height: 100%; object-fit: cover; }
/* 開場封面純裝飾：載入失敗就整張收起，不留空白卡。 */
.ani-rc-intro-cover:has(> [data-empty="true"]) { display: none; }
`;

const chapterCss = `
/* 上緣讓出常駐 chrome（進度列＋章數／「資料有更新」膠囊，約 68px），下緣留出操作列的高度：
   內容再長也不會壓到它們。矮螢幕改收緊章節內的間距，不再吃掉這段留白。 */
.ani-rc-chapter { display: grid; align-content: safe center; padding: calc(var(--rc-top-inset) + 76px) var(--rc-gutter) 124px; }
.ani-rc-chapter-grid { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); align-items: center; gap: clamp(36px, 6vw, 108px); width: min(100%, var(--rc-stage-width)); margin-inline: auto; }
.ani-rc-chapter-grid[data-variant="wide-visual"] { grid-template-columns: minmax(0, .74fr) minmax(0, 1.26fr); }
.ani-rc-copy, .ani-rc-visual { min-width: 0; }
.ani-rc-visual { display: grid; gap: 14px; align-content: center; }
.ani-rc-lead { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 22px; max-width: 30em; margin-top: 34px; }
.ani-rc-lead-cover { position: relative; width: clamp(96px, 8.6vw, 132px); aspect-ratio: 3 / 4; }
/* 接力封面的殘影：上一章的封面疊在新框裡淡出。 */
.ani-rc-baton-ghost { position: absolute; z-index: 1; inset: 0; pointer-events: none; }
.ani-rc-lead-art { display: grid; place-items: center; width: 100%; height: 100%; overflow: hidden; border-radius: 14px; background: var(--rc-surface-strong); box-shadow: 0 24px 54px rgba(0, 0, 0, .5), 0 0 0 1px rgba(255, 255, 255, .08); }
.ani-rc-lead-art img, .ani-rc-row-cover img, .ani-rc-collage-art img, .ani-rc-work-cover img { width: 100%; height: 100%; object-fit: cover; }
.ani-rc-lead-copy { display: grid; gap: 6px; min-width: 0; }
.ani-rc-lead-label { color: var(--rc-accent); font-size: 11px; font-weight: 900; letter-spacing: .16em; }
.ani-rc-lead-title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; color: var(--rc-ink); font-size: clamp(18px, 1.6vw, 23px); font-weight: 800; line-height: 1.3; word-break: keep-all; overflow-wrap: anywhere; }
.ani-rc-lead-value { color: var(--rc-ink-2); font-size: 13px; line-height: 1.5; }
.ani-rc-meter { position: relative; display: block; overflow: hidden; width: 100%; max-width: 240px; height: 4px; margin-top: 8px; border-radius: 999px; background: rgba(148, 170, 220, .16); }
.ani-rc-meter-fill { position: absolute; inset: 0 auto 0 0; width: calc(var(--rc-level, 0) * 100%); border-radius: inherit; background: var(--rc-meter, var(--rc-accent)); box-shadow: 0 0 10px color-mix(in srgb, var(--rc-meter, var(--rc-accent)) 45%, transparent); transform-origin: left center; }
.ani-rc-meter--lead { max-width: 280px; margin-top: 4px; }
.ani-rc-hero-stat { display: grid; gap: 10px; padding-bottom: 20px; border-bottom: 1px solid var(--rc-line); }
.ani-rc-hero-value { display: flex; flex-wrap: wrap; align-items: baseline; color: var(--rc-accent); font-size: clamp(56px, 6.6vw, 104px); font-weight: 900; line-height: .98; letter-spacing: -.035em; text-shadow: 0 0 42px color-mix(in srgb, var(--rc-accent) 26%, transparent); }
.ani-rc-hero-value[data-long="true"] { font-size: clamp(46px, 5.2vw, 82px); }
.ani-rc-hero-caption { color: var(--rc-ink-3); font-size: 13px; font-weight: 700; line-height: 1.5; }
.ani-rc-row { display: grid; grid-template-columns: 22px 46px minmax(0, 1fr) max-content; align-items: center; column-gap: 16px; row-gap: 0; padding-top: 9px; }
.ani-rc-row-rule { grid-column: 1 / -1; height: 1px; margin-top: 9px; background: var(--rc-line); }
.ani-rc-row-rank { color: var(--rc-ink-3); font-size: 13px; font-weight: 900; text-align: center; font-variant-numeric: tabular-nums; }
.ani-rc-row-cover { display: grid; place-items: center; overflow: hidden; width: 46px; aspect-ratio: 3 / 4; border-radius: 8px; background: var(--rc-surface-strong); box-shadow: 0 8px 20px rgba(0, 0, 0, .35); }
.ani-rc-row-copy { display: grid; gap: 2px; min-width: 0; }
.ani-rc-row-title { overflow: hidden; color: var(--rc-ink); font-size: 14.5px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.ani-rc-row-meta { overflow: hidden; color: var(--rc-ink-3); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.ani-rc-row-copy .ani-rc-meter { margin-top: 6px; }
.ani-rc-row-value { color: var(--rc-ink-2); font-size: 13px; font-weight: 800; font-variant-numeric: tabular-nums; }
.ani-rc-row[data-lead="true"] :is(.ani-rc-row-rank, .ani-rc-row-title) { color: var(--rc-accent); }
.ani-rc-note { margin: 4px 0 0; color: var(--rc-ink-3); font-size: 12.5px; line-height: 1.6; word-break: keep-all; overflow-wrap: anywhere; }
.ani-rc-theater .ani-cover-fallback { color: var(--rc-ink-3); font-size: 16px; font-weight: 900; user-select: none; }
.ani-rc-lead-art .ani-cover-fallback, .ani-rc-collage-art .ani-cover-fallback { font-size: 30px; }
.ani-rc-stat-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 34px 44px; }
.ani-rc-stat { display: grid; gap: 8px; padding-top: 18px; border-top: 1px solid var(--rc-line-strong); }
.ani-rc-stat-label { color: var(--rc-ink-3); font-size: 12px; font-weight: 800; letter-spacing: .14em; }
.ani-rc-stat-value { display: flex; align-items: baseline; color: var(--rc-ink); font-size: clamp(46px, 5.1vw, 78px); font-weight: 900; line-height: 1; letter-spacing: -.03em; }
.ani-rc-stat-value .ani-rc-unit { color: var(--rc-accent); }
.ani-rc-stat:first-child .ani-rc-stat-value { color: var(--rc-accent); text-shadow: 0 0 40px color-mix(in srgb, var(--rc-accent) 24%, transparent); }
.ani-rc-season-chart { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: clamp(14px, 2vw, 30px); align-items: end; }
.ani-rc-season-column { display: grid; gap: 6px; --rc-season: var(--rc-accent); }
.ani-rc-season-column[data-season="winter"], .ani-rc-mini-season[data-season="winter"] { --rc-season: #7dd3fc; }
.ani-rc-season-column[data-season="spring"], .ani-rc-mini-season[data-season="spring"] { --rc-season: #6ee7b7; }
.ani-rc-season-column[data-season="summer"], .ani-rc-mini-season[data-season="summer"] { --rc-season: #fcd34d; }
.ani-rc-season-column[data-season="autumn"], .ani-rc-mini-season[data-season="autumn"] { --rc-season: #fb923c; }
.ani-rc-season-track { display: flex; align-items: flex-end; height: clamp(150px, 28vh, 260px); border-bottom: 1px solid var(--rc-line-strong); }
.ani-rc-season-bar { display: block; width: 100%; height: max(4px, calc(var(--rc-level, 0) * 100%)); border-radius: 12px 12px 3px 3px; background: linear-gradient(180deg, color-mix(in srgb, var(--rc-season) 62%, transparent), color-mix(in srgb, var(--rc-season) 14%, transparent)); transform-origin: bottom; }
.ani-rc-season-column[data-leading="true"] .ani-rc-season-bar { background: linear-gradient(180deg, var(--rc-season), color-mix(in srgb, var(--rc-season) 30%, transparent)); box-shadow: 0 0 34px color-mix(in srgb, var(--rc-season) 34%, transparent); }
.ani-rc-season-name { margin-top: 10px; color: color-mix(in srgb, var(--rc-season) 82%, #ffffff); font-size: 12px; font-weight: 900; letter-spacing: .08em; }
.ani-rc-season-count { display: flex; align-items: baseline; color: var(--rc-ink); font-size: clamp(30px, 3vw, 46px); font-weight: 900; line-height: 1; letter-spacing: -.03em; }
.ani-rc-season-detail { color: var(--rc-ink-3); font-size: 12px; }
.ani-rc-clock { display: grid; gap: 8px; min-width: 0; }
.ani-rc-clock-bars { display: grid; grid-template-columns: repeat(24, minmax(0, 1fr)); gap: 4px; align-items: end; height: clamp(110px, 19vh, 170px); border-bottom: 1px solid var(--rc-line-strong); }
.ani-rc-clock-bar { display: block; height: max(3px, calc(var(--rc-level, 0) * 100%)); border-radius: 4px 4px 2px 2px; background: color-mix(in srgb, var(--rc-accent) 42%, rgba(148, 170, 220, .2)); transform-origin: bottom; }
.ani-rc-clock-bar[data-peak="true"] { background: var(--rc-accent); box-shadow: 0 0 14px color-mix(in srgb, var(--rc-accent) 50%, transparent); }
.ani-rc-clock-labels { display: flex; justify-content: space-between; color: var(--rc-ink-3); font-size: 11px; font-variant-numeric: tabular-nums; }
.ani-rc-segments { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-top: 6px; }
.ani-rc-segment-item { display: grid; gap: 2px; border-top: 2px solid var(--rc-line); padding-top: 10px; }
.ani-rc-segment-item[data-top="true"] { border-top-color: var(--rc-accent); }
.ani-rc-segment-name { color: var(--rc-ink-3); font-size: 12px; font-weight: 800; }
.ani-rc-segment-share { color: var(--rc-ink); font-size: clamp(20px, 1.8vw, 26px); font-weight: 900; font-variant-numeric: tabular-nums; }
.ani-rc-segment-item[data-top="true"] .ani-rc-segment-share { color: var(--rc-accent); }
.ani-rc-marathon-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 26px; margin-top: 8px; }
.ani-rc-marathon-facts .ani-rc-fact { border-top: 0; padding-top: 0; }
.ani-rc-fact { display: grid; align-content: start; gap: 5px; border-top: 1px solid var(--rc-line-strong); padding-top: 14px; }
.ani-rc-fact .ani-rc-fact-value { display: flex; align-items: baseline; color: var(--rc-ink); font-size: clamp(32px, 3.2vw, 46px); font-weight: 900; line-height: 1; letter-spacing: -.03em; }
.ani-rc-fact .ani-rc-fact-label { color: var(--rc-ink-2); font-size: 12px; font-weight: 800; letter-spacing: .08em; }
.ani-rc-fact-detail { color: var(--rc-ink-3); font-size: 12px; }
.ani-recap-taste-grid, .ani-rc-taste-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 26px 36px; }
.ani-recap-taste-column h4 { margin: 0 0 12px; padding-bottom: 9px; border-bottom: 1px solid var(--rc-line); color: var(--rc-accent); font-size: 12px; font-weight: 900; letter-spacing: .16em; }
.ani-recap-taste-column ol { display: grid; gap: 11px; margin: 0; padding: 0; list-style: none; }
.ani-recap-taste-column li { display: grid; grid-template-rows: auto 7px; min-width: 0; }
.ani-recap-taste-column li .ani-recap-meter { align-self: end; height: 3px; margin-top: 0; max-width: none; }
.ani-recap-taste-column { min-width: 0; }
.ani-rc-outcomes { display: grid; gap: 12px; min-width: 0; }
.ani-rc-outcome-bar { display: flex; gap: 3px; height: 14px; overflow: hidden; border-radius: 999px; }
.ani-rc-outcome-segment { flex: 1 1 0; min-width: 4px; }
.ani-rc-outcome-legend { display: grid; grid-template-columns: repeat(4, max-content); gap: 8px 22px; margin: 0; padding: 0; list-style: none; }
.ani-rc-outcome { display: grid; grid-template-columns: 10px auto auto; align-items: center; gap: 8px; color: var(--rc-ink-2); font-size: 14px; white-space: nowrap; }
.ani-rc-outcome-swatch { width: 10px; height: 10px; border-radius: 3px; }
.ani-rc-outcome-count { color: var(--rc-ink); font-weight: 800; font-variant-numeric: tabular-nums; }
.ani-rc-outcome-segment[data-outcome="finished"], .ani-rc-outcome[data-outcome="finished"] .ani-rc-outcome-swatch { background: var(--rc-accent); }
.ani-rc-outcome-segment[data-outcome="nearly"], .ani-rc-outcome[data-outcome="nearly"] .ani-rc-outcome-swatch { background: color-mix(in srgb, var(--rc-accent) 62%, rgba(148, 170, 220, .3)); }
.ani-rc-outcome-segment[data-outcome="midway"], .ani-rc-outcome[data-outcome="midway"] .ani-rc-outcome-swatch { background: color-mix(in srgb, var(--rc-accent) 32%, rgba(148, 170, 220, .26)); }
.ani-rc-outcome-segment[data-outcome="dropped"], .ani-rc-outcome[data-outcome="dropped"] .ani-rc-outcome-swatch { background: rgba(148, 170, 220, .2); }
.ani-rc-tile .ani-rc-outcomes { gap: 8px; }
.ani-rc-tile .ani-rc-outcome-bar { height: 9px; }
.ani-rc-tile .ani-rc-outcome-legend { grid-template-columns: repeat(2, minmax(0, max-content)); gap: 5px 18px; }
.ani-rc-tile .ani-rc-outcome { font-size: 12px; }
.ani-rc-tile[data-h="1"] .ani-rc-outcome-legend { display: none; }
.ani-rc-season-picks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 36px; }
.ani-rc-season-pick { display: grid; align-content: start; gap: 10px; min-width: 0; }
.ani-rc-season-pick-name { margin: 0; padding-bottom: 8px; border-bottom: 1px solid var(--rc-line); color: var(--rc-accent); font-size: 12px; font-weight: 900; letter-spacing: .16em; }
.ani-rc-season-pick-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.ani-rc-season-pick-item { display: grid; grid-template-columns: 34px minmax(0, 1fr); align-items: center; gap: 12px; min-width: 0; }
.ani-rc-season-pick-cover { display: grid; place-items: center; overflow: hidden; width: 100%; aspect-ratio: 3 / 4; border-radius: 6px; background: var(--rc-surface-strong); box-shadow: 0 6px 16px rgba(0, 0, 0, .35); }
.ani-rc-season-pick-cover img, .ani-rc-fav-cover img { width: 100%; height: 100%; object-fit: cover; }
.ani-rc-season-pick-title { overflow: hidden; color: var(--rc-ink); font-size: 14px; font-weight: 800; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.ani-rc-season-pick-item:first-child .ani-rc-season-pick-title { font-size: 15px; }
.ani-rc-season-pick-empty { margin: 0; color: var(--rc-ink-3); font-size: 13px; }
.ani-recap-taste-line { display: flex; justify-content: space-between; gap: 10px; min-width: 0; color: var(--rc-ink-2); font-size: 13.5px; }
.ani-recap-taste-line span { min-width: 0; overflow: hidden; color: var(--rc-ink); font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.ani-recap-taste-line strong { flex: none; color: var(--rc-ink-3); font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
`;

const evidenceCss = `
/* 整片幕只用預先調暗的純色：淡入時瀏覽器不必每格重算全螢幕的 backdrop blur；面板本身幾乎不透明。 */
.ani-recap-evidence-veil { position: absolute; z-index: 6; display: grid; place-items: center; inset: 0; background: rgba(4, 8, 16, .74); padding: calc(var(--rc-top-inset) + 20px) 20px 20px; }
.ani-recap-evidence-panel { width: min(620px, 100%); max-height: min(720px, calc(100dvh - var(--rc-top-inset) - 80px)); overflow-y: auto; border: 1px solid var(--rc-line-strong); border-radius: var(--ani-r-lg); background: linear-gradient(180deg, rgba(23, 33, 60, .97), rgba(11, 17, 33, .97)); box-shadow: 0 40px 110px rgba(0, 0, 0, .6); color: var(--rc-ink); padding: 22px; animation: ani-pop-in var(--ani-dur-2) var(--ani-ease-out) both; }
.ani-recap-evidence-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.ani-recap-evidence-title { margin: 0; font-size: 20px; font-weight: 800; }
.ani-recap-evidence-close { display: grid; place-items: center; width: 38px; height: 38px; border: 1px solid var(--rc-line-strong); border-radius: 50%; background: transparent; color: var(--rc-ink); cursor: pointer; font: inherit; font-size: 23px; transition: background var(--ani-dur-1) var(--ani-ease); }
.ani-recap-evidence-close:hover { background: rgba(148, 173, 229, .14); }
.ani-recap-evidence-chapter { margin: 5px 0 18px; color: var(--rc-ink-3); font-size: 12px; }
.ani-recap-evidence-list { display: grid; grid-template-columns: minmax(0, 1fr) max-content; gap: 0; margin: 0; }
.ani-recap-evidence-list dt, .ani-recap-evidence-list dd { border-bottom: 1px solid var(--rc-line); margin: 0; padding: 10px 0; font-size: 12px; overflow-wrap: anywhere; }
.ani-recap-evidence-list dt { color: var(--rc-ink-3); }
.ani-recap-evidence-list dd { color: var(--rc-ink); font-weight: 850; text-align: right; font-variant-numeric: tabular-nums; }
`;

/* 結尾海報：一張 12×4 的 bento，每塊磚帶著它那一章的顏色；全部塞進一個桌機畫面。 */
const posterCss = `
/* 海報在大螢幕上整張等比放大（見 recap-poster 的 fitPoster）：放大時 --rc-vh／--rc-vw 固定在
   設計基準（1440×900 視窗）的值，視窗單位才不會被 zoom 再乘一次。 */
.ani-rc-summary[data-rc-zoomed="true"] { align-content: center; }
.ani-rc-summary { display: grid; padding: calc(var(--rc-top-inset) + 12px) var(--rc-poster-gutter) 20px; }
.ani-rc-poster { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 12px; width: min(100%, var(--rc-poster-width)); height: 100%; min-height: 600px; margin-inline: auto; }
.ani-rc-poster-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 24px; min-width: 0; }
.ani-rc-poster-titles { display: grid; gap: 2px; min-width: 0; }
.ani-rc-poster-eyebrow { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 0; color: var(--rc-ink-3); font-size: 12px; font-weight: 800; letter-spacing: .14em; }
.ani-rc-poster-range { font-variant-numeric: tabular-nums; letter-spacing: .04em; }
.ani-rc-poster-title { margin: 0; font-size: clamp(28px, calc(4.4 * var(--rc-vh, 1vh)), 42px); letter-spacing: -.02em; line-height: 1.12; white-space: nowrap; }
.ani-rc-poster-stale { grid-column: 1 / -1; margin: 0; color: #fcd34d; font-size: 12px; font-weight: 800; }
.ani-rc-poster-stale[hidden] { display: none; }
/* 磚與型態框都是一般容器（內容照常被報讀），導覽交給一顆蓋滿整塊的按鈕。 */
.ani-rc-sr-only { position: absolute; overflow: hidden; width: 1px; height: 1px; margin: -1px; clip-path: inset(50%); white-space: nowrap; }
.ani-rc-stretch { position: absolute; z-index: 2; inset: 0; border: 0; border-radius: inherit; background: transparent; cursor: pointer; font: inherit; padding: 0; }
.ani-rc-theater .ani-rc-stretch:focus-visible { outline: 3px solid var(--rc-accent); outline-offset: -3px; }
.ani-rc-persona { position: relative; justify-self: center; display: grid; gap: 3px; min-width: 0; max-width: 560px; border: 1px solid color-mix(in srgb, var(--rc-accent) 42%, transparent); border-radius: 16px; background: linear-gradient(120deg, color-mix(in srgb, var(--rc-accent) 15%, transparent), rgba(146, 172, 228, .04)); color: var(--rc-ink); padding: 9px 18px 10px; transition: background var(--ani-dur-1) var(--ani-ease), border-color var(--ani-dur-1) var(--ani-ease); }
.ani-rc-persona:hover { border-color: color-mix(in srgb, var(--rc-accent) 70%, transparent); background: linear-gradient(120deg, color-mix(in srgb, var(--rc-accent) 22%, transparent), rgba(146, 172, 228, .06)); }
.ani-rc-persona-name-row { display: flex; align-items: center; gap: 12px; min-width: 0; margin: 0; }
.ani-rc-persona-label { color: var(--rc-ink-3); font-size: 11px; font-weight: 800; letter-spacing: .16em; white-space: nowrap; }
.ani-rc-persona-name { color: var(--rc-accent); font-size: clamp(20px, calc(3 * var(--rc-vh, 1vh)), 26px); font-weight: 900; letter-spacing: .02em; line-height: 1.15; white-space: nowrap; }
.ani-rc-persona-reason { overflow: hidden; margin: 0; color: var(--rc-ink-2); font-size: 12.5px; line-height: 1.45; text-overflow: ellipsis; white-space: nowrap; }
.ani-rc-persona-others { display: flex; align-items: center; gap: 6px; min-width: 0; margin-inline-start: 4px; overflow: hidden; color: var(--rc-ink-3); font-size: 11px; font-weight: 700; white-space: nowrap; }
.ani-rc-persona-chip { border: 1px solid color-mix(in srgb, var(--rc-accent) 46%, transparent); border-radius: 999px; color: var(--rc-accent); font-weight: 800; padding: 1px 9px; }
.ani-rc-poster-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.ani-rc-poster-actions :is(.ani-recap-primary-button, .ani-recap-ghost-button) { min-height: 40px; padding: 8px 18px; }
.ani-rc-poster-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); grid-template-rows: repeat(4, minmax(0, 1fr)); gap: 12px; min-height: 0; }
.ani-rc-tile { position: relative; isolation: isolate; container-type: size; display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; overflow: hidden; border-radius: 18px; color: var(--rc-ink); line-height: 1.4; padding: clamp(12px, calc(1.7 * var(--rc-vh, 1vh)), 16px) clamp(14px, calc(1.2 * var(--rc-vw, 1vw)), 18px); transition: translate 220ms var(--ani-ease); }
.ani-rc-tile:has(> .ani-rc-stretch):hover { translate: 0 -2px; }
.ani-rc-tile ul { margin: 0; padding: 0; list-style: none; }
.ani-rc-tile-surface { position: absolute; z-index: -1; inset: 0; border: 1px solid color-mix(in oklab, var(--rc-accent) 24%, rgba(148, 170, 220, .14)); border-radius: inherit; background: linear-gradient(155deg, color-mix(in oklab, var(--rc-accent) 16%, transparent) 0%, rgba(146, 172, 228, .045) 58%, rgba(146, 172, 228, .03) 100%); transition: border-color 220ms var(--ani-ease), background 220ms var(--ani-ease); }
.ani-rc-tile:has(> .ani-rc-stretch):hover .ani-rc-tile-surface { border-color: color-mix(in oklab, var(--rc-accent) 52%, transparent); background: linear-gradient(155deg, color-mix(in oklab, var(--rc-accent) 24%, transparent) 0%, rgba(146, 172, 228, .06) 60%, rgba(146, 172, 228, .04) 100%); }
.ani-rc-tile-label { flex: none; overflow: hidden; margin: 0; color: var(--rc-accent); font-size: 11.5px; font-weight: 900; letter-spacing: .14em; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.ani-rc-tile-head { display: grid; gap: 3px; min-width: 0; }
.ani-rc-tile-value { display: flex; flex-wrap: wrap; align-items: baseline; color: var(--rc-ink); font-size: clamp(25px, calc(4.1 * var(--rc-vh, 1vh)), 38px); font-weight: 900; line-height: 1.04; letter-spacing: -.03em; }
.ani-rc-tile-value .ani-rc-unit { color: color-mix(in srgb, var(--rc-accent) 82%, #ffffff); font-size: .46em; }
.ani-rc-tile-word { letter-spacing: .02em; }
.ani-rc-tile-caption { overflow: hidden; color: var(--rc-ink-3); font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.ani-rc-fav-board { display: grid; flex: 1; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: minmax(0, 1fr); gap: 10px 14px; min-height: 0; }
.ani-rc-fav-board[data-layout="row"] { grid-template-columns: repeat(var(--rc-seasons, 4), minmax(0, 1fr)); }
.ani-rc-fav-season { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 4px; min-width: 0; min-height: 0; }
.ani-rc-fav-season-name { color: var(--rc-ink-3); font-size: 11.5px; font-weight: 800; letter-spacing: .08em; }
.ani-rc-fav-covers { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); justify-content: start; gap: 6px; height: 100%; min-height: 0; margin: 0; padding: 0; list-style: none; }
.ani-rc-fav-item { position: relative; display: grid; align-items: start; min-width: 0; min-height: 0; }
.ani-rc-fav-cover { display: grid; place-items: center; overflow: hidden; width: 100%; max-height: 100%; aspect-ratio: 3 / 4; border-radius: 6px; background: var(--rc-surface-strong); box-shadow: 0 6px 14px rgba(0, 0, 0, .35); }
.ani-rc-fav-item[data-gem="true"] .ani-rc-fav-cover { outline: 2px solid var(--rc-accent); outline-offset: 1px; }
.ani-rc-fav-gem { position: absolute; bottom: 3px; left: 50%; translate: -50% 0; border-radius: 999px; background: var(--rc-accent); color: #0b0f1a; font-size: 11px; font-weight: 900; line-height: 16px; padding: 0 6px; white-space: nowrap; }
.ani-rc-fav-title { overflow: hidden; color: var(--rc-ink-2); font-size: 12px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
.ani-rc-fav-empty { align-self: center; color: var(--rc-ink-3); font-size: 12px; }
.ani-rc-tile-foot { flex: none; margin-top: auto; overflow: hidden; color: var(--rc-ink-2); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.ani-rc-tile-pair { display: flex; flex-wrap: wrap; gap: 6px 30px; }
.ani-rc-tile-meter .ani-rc-meter { max-width: none; margin-top: 2px; }
.ani-rc-tile-segments { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.ani-rc-tile-segment { display: grid; gap: 1px; border-top: 2px solid var(--rc-line); padding-top: 6px; color: var(--rc-ink-3); font-size: 11px; font-weight: 800; }
.ani-rc-tile-segment strong { color: var(--rc-ink); font-size: 17px; font-weight: 900; font-variant-numeric: tabular-nums; }
.ani-rc-tile-segment[data-top="true"] { border-top-color: var(--rc-accent); }
.ani-rc-tile-segment[data-top="true"] strong { color: var(--rc-accent); }
/* 英雄磚：封面拼貼（或期間）+ 最大的數字 + 觀看日占比 + KPI，上下平均分配，不留空帶。 */
/* 拼貼的封面會從上一章的位置飛進來：英雄磚不裁切、疊在其他磚上面，飛行途中不會被磚緣切掉。 */
.ani-rc-tile[data-tile="hero"] { z-index: 1; overflow: visible; justify-content: space-between; gap: clamp(8px, calc(1.4 * var(--rc-vh, 1vh)), 12px); padding: clamp(14px, calc(2.2 * var(--rc-vh, 1vh)), 22px) clamp(16px, calc(1.5 * var(--rc-vw, 1vw)), 24px); }
.ani-rc-collage { position: relative; flex: none; height: calc(var(--rc-cover-w) * 4 / 3 + 12px); margin-top: 2px; --rc-cover-w: clamp(70px, calc(11.5 * var(--rc-vh, 1vh)), 112px); }
.ani-rc-collage-item { position: absolute; top: calc(mod(var(--rc-i, 0), 2) * 12px); left: calc(var(--rc-i, 0) * (100% - var(--rc-cover-w)) / max(1, var(--rc-n, 1) - 1)); z-index: calc(20 - var(--rc-i, 0)); width: var(--rc-cover-w); aspect-ratio: 3 / 4; }
.ani-rc-collage-art { display: grid; place-items: center; width: 100%; height: 100%; overflow: hidden; border-radius: 12px; background: var(--rc-surface-strong); box-shadow: 0 16px 34px rgba(0, 0, 0, .5), 0 0 0 1px rgba(255, 255, 255, .1); rotate: calc((var(--rc-i, 0) - (var(--rc-n, 1) - 1) / 2) * 2.5deg); }
.ani-rc-hero-period { display: grid; gap: 4px; flex: none; }
.ani-rc-hero-period-range { color: var(--rc-ink); font-size: clamp(18px, calc(2.7 * var(--rc-vh, 1vh)), 24px); font-weight: 900; letter-spacing: .01em; font-variant-numeric: tabular-nums; }
.ani-rc-hero-period-days { color: var(--rc-ink-3); font-size: 12px; font-weight: 700; letter-spacing: .1em; }
.ani-rc-hero-number { display: grid; gap: 6px; min-width: 0; }
.ani-rc-hero-figure { display: flex; flex-wrap: wrap; align-items: baseline; color: var(--rc-accent); font-size: clamp(64px, calc(12 * var(--rc-vh, 1vh)), 118px); font-weight: 900; line-height: 1.04; letter-spacing: -.045em; padding-bottom: .04em; text-shadow: 0 0 44px color-mix(in srgb, var(--rc-accent) 30%, transparent); }
.ani-rc-hero-figure[data-long="true"] { font-size: clamp(50px, calc(8.6 * var(--rc-vh, 1vh)), 84px); }
/* 沒有拼貼時數字就是整塊磚的主角：再放大一級。 */
.ani-rc-tile[data-tile="hero"]:not(:has(.ani-rc-collage)) .ani-rc-hero-figure:not([data-long="true"]) { font-size: clamp(64px, min(calc(14 * var(--rc-vh, 1vh)), calc(8.4 * var(--rc-vw, 1vw))), 136px); }
.ani-rc-hero-figure .ani-rc-unit { font-size: .34em; }
.ani-rc-hero-note { color: var(--rc-ink-2); font-size: 12.5px; font-weight: 800; letter-spacing: .12em; }
.ani-rc-days { display: grid; gap: 7px; min-width: 0; }
.ani-rc-days-line { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.ani-rc-days-label { flex: none; color: var(--rc-ink-3); font-size: 12px; font-weight: 700; }
.ani-rc-days-value { display: flex; align-items: baseline; margin-inline-start: auto; color: var(--rc-ink); font-size: clamp(20px, calc(3.2 * var(--rc-vh, 1vh)), 28px); font-weight: 900; letter-spacing: -.02em; line-height: 1; white-space: nowrap; }
.ani-rc-days-value .ani-rc-num ~ .ani-rc-num { margin-inline-start: .28em; color: var(--rc-ink-3); font-size: .6em; letter-spacing: 0; }
.ani-rc-days-value .ani-rc-unit { color: var(--rc-ink-3); font-size: .5em; }
.ani-rc-days-share { flex: none; color: var(--rc-accent); font-size: 13px; font-weight: 900; font-variant-numeric: tabular-nums; }
.ani-rc-days-meter { max-width: none; height: 6px; margin-top: 0; }
.ani-rc-kpis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: clamp(8px, calc(1.4 * var(--rc-vh, 1vh)), 14px) 18px; }
.ani-rc-kpis[data-columns="3"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.ani-rc-kpis[data-columns="4"] { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.ani-rc-kpi { display: grid; gap: 2px; min-width: 0; border-top: 1px solid var(--rc-line-strong); padding-top: clamp(6px, calc(1.1 * var(--rc-vh, 1vh)), 10px); }
.ani-rc-kpi-value { display: flex; align-items: baseline; color: var(--rc-ink); font-size: clamp(23px, calc(3.8 * var(--rc-vh, 1vh)), 34px); font-weight: 900; line-height: 1.04; letter-spacing: -.03em; }
.ani-rc-kpi-value .ani-rc-unit { font-size: .5em; color: var(--rc-ink-2); }
.ani-rc-kpi-label { overflow: hidden; color: var(--rc-ink-3); font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
/* 亮點：只對這個人成立的一兩句話，放在英雄磚的大數字和 KPI 之間。 */
.ani-rc-tile .ani-rc-highlights { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.ani-rc-highlight { display: grid; grid-template-columns: clamp(30px, calc(4.2 * var(--rc-vh, 1vh)), 38px) minmax(0, 1fr); align-items: center; gap: 12px; min-width: 0; }
.ani-rc-highlight-cover { display: grid; place-items: center; overflow: hidden; width: 100%; aspect-ratio: 3 / 4; border-radius: 6px; background: var(--rc-surface-strong); box-shadow: 0 6px 14px rgba(0, 0, 0, .35); }
.ani-rc-highlight-cover img { width: 100%; height: 100%; object-fit: cover; }
.ani-rc-highlight-copy { display: grid; gap: 2px; min-width: 0; }
.ani-rc-highlight-label { color: var(--rc-accent); font-size: 11.5px; font-weight: 900; letter-spacing: .1em; }
.ani-rc-highlight-text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; color: var(--rc-ink-2); font-size: 12.5px; line-height: 1.45; word-break: keep-all; overflow-wrap: anywhere; }
/* 矮的英雄磚只放得下一則亮點。 */
@container (max-height: 510px) { .ani-rc-highlight + .ani-rc-highlight { display: none; } }
/* 磚底的補充說明：貼齊磚底。 */
.ani-rc-tile .ani-rc-tile-notes { display: grid; gap: 7px; margin: auto 0 0; padding: 0; list-style: none; color: var(--rc-ink-2); font-size: 12.5px; line-height: 1.45; }
.ani-rc-drops { display: grid; gap: 6px; min-height: 0; margin-top: 4px; }
.ani-rc-drops-title { color: var(--rc-ink-3); font-size: 11.5px; font-weight: 800; letter-spacing: .08em; }
.ani-rc-tile .ani-rc-drops-list { display: grid; gap: 5px; margin: 0; padding: 0; list-style: none; }
.ani-rc-drop, .ani-rc-bar-row { display: grid; grid-template-columns: minmax(56px, 5.5em) minmax(0, 1fr) max-content; align-items: center; gap: 10px; font-size: 12.5px; }
.ani-rc-drop[data-gap="true"] { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--rc-line); }
.ani-rc-drop-label { overflow: hidden; color: var(--rc-ink); font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
.ani-rc-drop .ani-rc-meter, .ani-rc-bar-row .ani-rc-meter { max-width: none; height: 5px; margin-top: 0; }
.ani-rc-taste-board { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); align-items: start; gap: 14px 22px; min-height: 0; margin-top: 2px; }
.ani-rc-tile .ani-rc-taste-bars { display: grid; gap: 9px; margin: 0; padding: 0; list-style: none; }
.ani-rc-tile .ani-rc-taste-credits { display: grid; gap: 10px; margin: 0; padding: 0 0 0 18px; border-left: 1px solid var(--rc-line); list-style: none; }
.ani-rc-taste-credit { display: grid; gap: 1px; min-width: 0; }
.ani-rc-taste-credit .ani-rc-credit-label { color: var(--rc-ink-3); font-size: 11.5px; font-weight: 800; letter-spacing: .08em; }
.ani-rc-taste-credit-value { overflow: hidden; color: var(--rc-ink); font-size: 13.5px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
.ani-rc-taste-credit-meta { color: var(--rc-ink-3); font-size: 11.5px; }
.ani-rc-drop-value { color: var(--rc-ink-3); font-variant-numeric: tabular-nums; }
.ani-rc-tile .ani-rc-tile-notes li { padding-top: 7px; border-top: 1px solid var(--rc-line); }
/* 時鐘磚：每種尺寸都有 00/06/12/18 刻度 */
.ani-rc-mini-clock { display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 3px; min-height: 0; flex: 1 1 auto; }
.ani-rc-mini-bars { display: grid; grid-template-columns: repeat(24, minmax(0, 1fr)); gap: 2px; align-items: end; min-height: 28px; border-bottom: 1px solid var(--rc-line-strong); }
.ani-rc-mini-bar { display: block; height: max(2px, calc(var(--rc-level, 0) * 100%)); border-radius: 2px 2px 1px 1px; background: color-mix(in srgb, var(--rc-accent) 40%, rgba(148, 170, 220, .2)); transform-origin: bottom; }
.ani-rc-mini-bar[data-segment="late-night"] { background: color-mix(in srgb, var(--rc-accent) 62%, rgba(148, 170, 220, .2)); }
.ani-rc-mini-bar[data-peak="true"] { background: var(--rc-accent); box-shadow: 0 0 10px color-mix(in srgb, var(--rc-accent) 50%, transparent); }
.ani-rc-mini-ticks { display: flex; justify-content: space-between; color: var(--rc-ink-3); font-size: 11px; line-height: 1.2; font-variant-numeric: tabular-nums; }
/* 寬版時鐘：左欄數字與時段，右欄 24 小時長條與星期分布。 */
.ani-rc-tile[data-tile="habit-clock"]:is([data-w="6"], [data-w="8"]):not([data-h="1"]) { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); grid-template-rows: auto auto minmax(0, 1fr) auto; column-gap: 30px; row-gap: 10px; }
.ani-rc-tile[data-tile="habit-clock"]:is([data-w="6"], [data-w="8"]):not([data-h="1"]) > .ani-rc-tile-label { grid-column: 1; grid-row: 1; }
.ani-rc-tile[data-tile="habit-clock"]:is([data-w="6"], [data-w="8"]):not([data-h="1"]) > .ani-rc-tile-head { grid-column: 1; grid-row: 2; }
.ani-rc-tile[data-tile="habit-clock"]:is([data-w="6"], [data-w="8"]):not([data-h="1"]) > .ani-rc-tile-segments { grid-column: 1; grid-row: 3; align-self: end; }
.ani-rc-tile[data-tile="habit-clock"]:is([data-w="6"], [data-w="8"]):not([data-h="1"]) > .ani-rc-tile-foot { grid-column: 1; grid-row: 4; }
.ani-rc-tile[data-tile="habit-clock"]:is([data-w="6"], [data-w="8"]):not([data-h="1"]) > .ani-rc-mini-clock { grid-column: 2; grid-row: 1 / 4; }
.ani-rc-tile[data-tile="habit-clock"]:is([data-w="6"], [data-w="8"]):not([data-h="1"]):not(:has(> .ani-rc-weekdays)) > .ani-rc-mini-clock { grid-row: 1 / -1; }
.ani-rc-tile[data-tile="habit-clock"]:is([data-w="6"], [data-w="8"]):not([data-h="1"]) > .ani-rc-weekdays { grid-column: 2; grid-row: 4; }
.ani-rc-tile[data-tile="habit-clock"]:not([data-h="1"]) .ani-rc-mini-clock { min-height: 56px; }
.ani-rc-tile:not([data-h="1"]) .ani-rc-tile-value { font-size: clamp(30px, calc(5.4 * var(--rc-vh, 1vh)), 52px); }
.ani-rc-tile[data-tile="habit-clock"][data-h="1"] { display: grid; grid-template-columns: minmax(0, .95fr) minmax(0, 1.05fr); grid-template-rows: auto auto minmax(0, 1fr); column-gap: 16px; row-gap: 6px; }
.ani-rc-tile[data-tile="habit-clock"][data-h="1"] .ani-rc-mini-clock { grid-column: 2; grid-row: 1 / -1; }
.ani-rc-tile[data-tile="habit-clock"][data-h="1"] .ani-rc-tile-foot { align-self: end; white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.ani-rc-weekdays { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; flex: none; height: clamp(44px, calc(7 * var(--rc-vh, 1vh)), 64px); }
.ani-rc-weekday { display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 3px; min-height: 0; text-align: center; }
.ani-rc-weekdays[data-counts="true"] .ani-rc-weekday { grid-template-rows: minmax(0, 1fr) auto auto; gap: 1px; }
.ani-rc-weekday-track { display: flex; align-items: flex-end; min-height: 0; }
.ani-rc-weekday-bar { display: block; width: 100%; height: max(2px, calc(var(--rc-level, 0) * 100%)); border-radius: 3px 3px 1px 1px; background: color-mix(in srgb, var(--rc-accent) 34%, rgba(148, 170, 220, .2)); transform-origin: bottom; }
.ani-rc-weekday[data-top="true"] .ani-rc-weekday-bar { background: var(--rc-accent); }
.ani-rc-weekday-name { margin-top: 2px; color: var(--rc-ink-3); font-size: 11px; font-weight: 800; }
.ani-rc-weekday[data-top="true"] .ani-rc-weekday-name { color: var(--rc-accent); }
.ani-rc-weekday-count { color: var(--rc-ink-2); font-size: 11px; font-weight: 800; font-variant-numeric: tabular-nums; }
/* 一週節奏磚（補白）：星期長條撐滿剩下的高度 */
.ani-rc-tile[data-tile="weekday"] .ani-rc-weekdays { flex: 1 1 auto; height: auto; min-height: 56px; }
/* 馬拉松磚：數字 + 整段期間的時間軸（亮帶＝最長連續，圓點＝單日最高） */
/* 大馬拉松磚：數字與時間軸整組垂直置中，不把時間軸推到底、中間留一片空。 */
.ani-rc-tile[data-tile="marathon"]:not([data-h="1"]) { gap: clamp(14px, calc(2.6 * var(--rc-vh, 1vh)), 24px); }
.ani-rc-tile[data-tile="marathon"]:not([data-h="1"]) > .ani-rc-tile-label + * { margin-top: auto; }
.ani-rc-tile[data-tile="marathon"]:not([data-h="1"]) > :nth-last-child(2) { margin-bottom: auto; }
.ani-rc-tile[data-tile="marathon"]:not([data-h="1"]) .ani-rc-ribbon { margin-top: 0; }
.ani-rc-tile[data-tile="marathon"]:not([data-h="1"]) .ani-rc-tile-pair { gap: 12px 40px; }
.ani-rc-tile[data-tile="marathon"][data-w="8"][data-h="1"] { display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); column-gap: 40px; align-items: center; }
.ani-rc-tile[data-tile="marathon"][data-w="8"][data-h="1"] > .ani-rc-tile-label { grid-column: 1 / -1; }
.ani-rc-ribbon { display: grid; gap: 4px; flex: none; min-width: 0; margin-top: auto; }
.ani-rc-ribbon-track { position: relative; display: block; height: 6px; border-radius: 999px; background: rgba(148, 170, 220, .16); }
.ani-rc-ribbon-streak { position: absolute; top: 0; bottom: 0; left: calc(var(--rc-from, 0) * 100%); width: max(6px, calc((var(--rc-to, 0) - var(--rc-from, 0)) * 100%)); border-radius: inherit; background: var(--rc-accent); box-shadow: 0 0 12px color-mix(in srgb, var(--rc-accent) 50%, transparent); transform-origin: left center; }
.ani-rc-ribbon-peak { position: absolute; top: 50%; left: calc(var(--rc-at, 0) * 100%); width: 12px; height: 12px; border: 2px solid #ffffff; border-radius: 50%; background: var(--rc-accent); translate: -50% -50%; box-shadow: 0 0 10px color-mix(in srgb, var(--rc-accent) 60%, transparent); }
.ani-rc-ribbon-track[data-ticks="true"] { height: 8px; }
.ani-rc-ribbon-months { position: relative; display: block; height: 15px; color: var(--rc-ink-3); font-size: 11px; line-height: 15px; font-variant-numeric: tabular-nums; }
.ani-rc-ribbon-months span { position: absolute; left: calc(var(--rc-at, 0) * 100%); translate: -50% 0; white-space: nowrap; }
.ani-rc-ribbon-months span::before { content: ""; position: absolute; left: 50%; top: -9px; width: 1px; height: 5px; background: var(--rc-line-strong); }
.ani-rc-ribbon-ends { display: flex; justify-content: space-between; gap: 10px; color: var(--rc-ink-3); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ani-rc-ribbon-legend { overflow: hidden; text-overflow: ellipsis; }
/* 單列高的磚：日期放在時間軸兩端同一行，省下一整行高度；圖例只在大磚出現。 */
.ani-rc-tile[data-h="1"] .ani-rc-ribbon { grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; column-gap: 10px; }
.ani-rc-tile[data-h="1"] .ani-rc-ribbon-track { grid-column: 2; grid-row: 1; }
.ani-rc-tile[data-h="1"] .ani-rc-ribbon-ends { display: contents; }
.ani-rc-tile[data-h="1"] .ani-rc-ribbon-ends > :first-child { grid-column: 1; grid-row: 1; }
.ani-rc-tile[data-h="1"] .ani-rc-ribbon-ends > :last-child { grid-column: 3; grid-row: 1; }
.ani-rc-tile[data-h="1"] .ani-rc-ribbon-legend { display: none; }
/* 作品型磚：封面 + 標題 + 細節（窄磚時細節各占一行，數字不被省略） */
.ani-rc-work { display: grid; grid-template-columns: clamp(34px, calc(5 * var(--rc-vh, 1vh)), 46px) minmax(0, 1fr); align-items: center; gap: 12px; min-width: 0; }
.ani-rc-work-cover { display: grid; place-items: center; overflow: hidden; width: 100%; aspect-ratio: 3 / 4; border-radius: 8px; background: var(--rc-surface-strong); box-shadow: 0 10px 22px rgba(0, 0, 0, .4); }
.ani-rc-work-copy { display: grid; gap: 3px; min-width: 0; }
.ani-rc-work-title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; color: var(--rc-ink); font-size: 13.5px; font-weight: 800; line-height: 1.3; word-break: keep-all; overflow-wrap: anywhere; }
.ani-rc-work-details { display: grid; gap: 0; min-width: 0; }
/* 只有一段作品資訊的小磚（先看、私藏）：作品列在標籤下方的空間裡垂直置中，不在底部留一條空帶。 */
.ani-rc-tile > .ani-rc-work--stacked:nth-last-child(2) { margin-block: auto; }
.ani-rc-work-detail { overflow: hidden; color: var(--rc-ink-3); font-size: 11.5px; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.ani-rc-work-details .ani-rc-work-detail:first-child { color: var(--rc-ink-2); font-weight: 800; }
/* 口味磚：放不下的標籤整顆換到被裁掉的下一排，不會出現半顆 */
.ani-rc-chips { display: flex; flex-wrap: wrap; align-content: flex-start; gap: 6px; min-width: 0; max-height: 58px; overflow: hidden; }
.ani-rc-tile[data-h="1"] .ani-rc-chips { max-height: 26px; }
.ani-rc-chip { max-width: 100%; overflow: hidden; border: 1px solid color-mix(in srgb, var(--rc-accent) 40%, transparent); border-radius: 999px; color: var(--rc-ink); font-size: 13px; font-weight: 800; line-height: 18px; padding: 3px 11px; text-overflow: ellipsis; white-space: nowrap; }
.ani-rc-chip[data-rank="1"] { border-color: transparent; background: var(--rc-accent); color: var(--rc-on-accent); }
.ani-rc-tile[data-tile="taste"] { gap: 6px; }
.ani-rc-taste-lead { flex: none; overflow: hidden; color: var(--rc-ink-2); font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.ani-rc-credits { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 3px 16px; margin-top: auto; min-width: 0; }
.ani-rc-credit { display: flex; gap: 8px; min-width: 0; font-size: 12px; }
.ani-rc-credit-label { flex: none; color: var(--rc-ink-3); font-weight: 700; }
.ani-rc-credit-value { overflow: hidden; color: var(--rc-ink); font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
/* 四季磚 */
.ani-rc-mini-seasons { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; flex: 1 1 auto; min-height: 0; }
.ani-rc-mini-season { display: grid; grid-template-rows: minmax(0, 1fr) auto auto; gap: 1px; min-height: 0; text-align: center; }
.ani-rc-mini-season-track { display: flex; align-items: flex-end; min-height: 0; border-bottom: 1px solid var(--rc-line-strong); }
.ani-rc-mini-season-bar { display: block; width: 100%; height: max(3px, calc(var(--rc-level, 0) * 100%)); border-radius: 6px 6px 2px 2px; background: color-mix(in srgb, var(--rc-season) 46%, transparent); transform-origin: bottom; }
.ani-rc-mini-season[data-leading="true"] .ani-rc-mini-season-bar { background: var(--rc-season); box-shadow: 0 0 16px color-mix(in srgb, var(--rc-season) 40%, transparent); }
.ani-rc-mini-season-name { margin-top: 3px; color: color-mix(in srgb, var(--rc-season) 82%, #ffffff); font-size: 11px; font-weight: 900; }
.ani-rc-mini-season-count { color: var(--rc-ink-2); font-size: 11.5px; font-weight: 800; font-variant-numeric: tabular-nums; }
/* 磚太矮時（小螢幕）先收起次要的註腳與圖例，保住數字與標題不被裁切；查詢的是磚的內容高度。 */
/* 標題縮成一行只在數字確定放不下時才做：先保住細節裡的數字。 */
@container (max-height: 90px) {
  .ani-rc-tile[data-h="1"] .ani-rc-work-title { -webkit-line-clamp: 1; }
  .ani-rc-taste-lead { display: none; }
}
@container (max-height: 104px) {
  .ani-rc-tile-foot { display: none; }
  .ani-rc-tile[data-tile="habit-clock"] .ani-rc-tile-foot { display: block; }
  .ani-rc-tile-caption { font-size: 11.5px; }
}
@container (max-height: 86px) {
  .ani-rc-tile[data-tile="habit-clock"] .ani-rc-tile-foot, .ani-rc-tile-meter, .ani-rc-credits, .ani-rc-ribbon { display: none; }
}
/* 節奏條：呼應擴充功能本身的熱度圖 */
.ani-rc-calendar { --rc-cell: clamp(7px, calc(1.02 * var(--rc-vh, 1vh)), 10px); --rc-cell-gap: 2px; position: relative; display: grid; grid-template-columns: minmax(140px, 200px) max-content minmax(0, 1fr); align-items: center; gap: 28px; margin: 0; border: 1px solid rgba(148, 170, 220, .14); border-radius: 18px; background: rgba(146, 172, 228, .04); padding: 7px 20px 8px; }
.ani-rc-calendar-caption { display: grid; gap: 3px; }
.ani-rc-calendar-days { display: flex; align-items: baseline; gap: 6px; color: var(--rc-ink); font-size: clamp(20px, calc(3 * var(--rc-vh, 1vh)), 26px); font-weight: 900; letter-spacing: -.02em; line-height: 1; white-space: nowrap; }
.ani-rc-calendar-total { color: var(--rc-ink-3); font-size: .55em; letter-spacing: 0; }
.ani-rc-calendar-detail { color: var(--rc-ink-3); font-size: 12px; }
.ani-rc-calendar-chart { display: grid; gap: 2px; }
.ani-rc-calendar-months, .ani-rc-calendar-grid, .ani-rc-calendar-band { display: grid; grid-template-columns: repeat(var(--rc-columns, 53), var(--rc-cell)); column-gap: var(--rc-cell-gap); }
.ani-rc-calendar[data-layout="strip"] { grid-template-columns: minmax(140px, 200px) minmax(0, 1fr) max-content; }
.ani-rc-calendar[data-layout="strip"] :is(.ani-rc-calendar-months, .ani-rc-calendar-grid, .ani-rc-calendar-band) { grid-template-columns: repeat(var(--rc-columns, 30), minmax(0, 1fr)); column-gap: 3px; }
.ani-rc-calendar[data-layout="strip"] .ani-rc-calendar-grid { grid-template-rows: clamp(22px, calc(3.4 * var(--rc-vh, 1vh)), 32px); }
.ani-rc-calendar[data-layout="strip"] .ani-rc-cal-day { border-radius: 4px; }
.ani-rc-calendar[data-layout="strip"] .ani-rc-calendar-months { order: 1; }
.ani-rc-calendar-months { height: 13px; color: var(--rc-ink-3); font-size: 11px; line-height: 13px; font-variant-numeric: tabular-nums; }
.ani-rc-calendar-months span { grid-row: 1; overflow: visible; white-space: nowrap; }
.ani-rc-calendar-grid { grid-template-rows: repeat(7, var(--rc-cell)); grid-auto-flow: column; row-gap: var(--rc-cell-gap); }
.ani-rc-cal-day { display: block; border-radius: 2px; background: rgba(148, 170, 220, .1); }
.ani-rc-cal-day[data-pad="true"] { background: transparent; }
.ani-rc-cal-day[data-level="1"] { background: color-mix(in srgb, var(--rc-accent) 34%, rgba(148, 170, 220, .12)); }
.ani-rc-cal-day[data-level="2"] { background: color-mix(in srgb, var(--rc-accent) 56%, rgba(148, 170, 220, .12)); }
.ani-rc-cal-day[data-level="3"] { background: color-mix(in srgb, var(--rc-accent) 78%, rgba(148, 170, 220, .12)); }
.ani-rc-cal-day[data-level="4"] { background: var(--rc-accent); }
.ani-rc-cal-day[data-peak="true"] { outline: 2px solid var(--rc-ink); outline-offset: 1px; }
.ani-rc-calendar-band { height: 3px; }
.ani-rc-calendar-streak { display: block; border-radius: 999px; background: var(--rc-ink); opacity: .8; }
.ani-rc-calendar-facts { display: grid; grid-template-columns: 12px max-content max-content; justify-self: center; gap: 8px 10px; margin: 0; padding: 0; list-style: none; }
.ani-rc-calendar-fact { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: baseline; white-space: nowrap; }
.ani-rc-calendar-fact strong { color: var(--rc-ink); font-size: 17px; font-weight: 900; font-variant-numeric: tabular-nums; }
.ani-rc-calendar-fact > span:last-child { color: var(--rc-ink-3); font-size: 12px; }
.ani-rc-calendar-mark { align-self: center; width: 12px; height: 10px; border-radius: 2px; }
.ani-rc-calendar-fact[data-mark="streak"] .ani-rc-calendar-mark { height: 3px; border-radius: 999px; background: var(--rc-ink); opacity: .8; }
.ani-rc-calendar-fact[data-mark="peak"] .ani-rc-calendar-mark { width: 9px; height: 9px; outline: 2px solid var(--rc-ink); outline-offset: 1px; background: var(--rc-accent); }
`;

export const recapCss = `
${theaterCss}
${typeCss}
${introCss}
${chapterCss}
${evidenceCss}
${posterCss}
.ani-recap-invalid { display: grid; place-items: center; align-content: center; gap: 8px; min-height: 60vh; background: #060a14; color: #f4f7ff; padding: 30px; text-align: center; }
.ani-recap-invalid h3, .ani-recap-invalid p { margin: 0; }
@keyframes ani-rc-drift { from { translate: -3vmax -2vmax; scale: 1; } to { translate: 7vmax 5vmax; scale: 1.14; } }
@keyframes ani-recap-float { from { translate: 0 -6px; } to { translate: 0 8px; } }
@media (max-height: 860px) {
  .ani-rc-summary { padding-top: calc(var(--rc-top-inset) + 6px); padding-bottom: 14px; }
  .ani-rc-poster, .ani-rc-poster-grid { gap: 10px; }
  .ani-rc-calendar { --rc-cell: 8px; padding-block: 5px 6px; }
  .ani-rc-visual { gap: 10px; }
  .ani-rc-hero-stat { gap: 6px; padding-bottom: 14px; }
  .ani-rc-hero-value { font-size: clamp(48px, 9vh, 84px); }
  .ani-rc-hero-value[data-long="true"] { font-size: clamp(42px, 7.4vh, 66px); }
  .ani-rc-row { grid-template-columns: 22px 40px minmax(0, 1fr) max-content; column-gap: 14px; padding-top: 6px; }
  .ani-rc-row-cover { width: 40px; }
  .ani-rc-row-rule { margin-top: 6px; }
}
@media (max-width: 1100px) {
  .ani-rc-poster-head { grid-template-columns: minmax(0, 1fr) auto; }
  .ani-rc-persona { grid-column: 1 / -1; grid-row: 2; justify-self: stretch; max-width: none; }
}
@media (max-width: 960px) {
  .ani-rc-chapter-grid, .ani-rc-chapter-grid[data-variant="wide-visual"] { grid-template-columns: 1fr; gap: 28px; }
  .ani-rc-intro-grid { grid-template-columns: 1fr; }
  .ani-rc-intro-poster { display: none; }
  .ani-rc-poster { min-width: 900px; }
}
@media (forced-colors: active) {
  /* 半透明的 color-mix 長條在強制色彩下會被換成 Canvas 而消失：每根長條都要給系統色。 */
  .ani-rc-clock-bar, .ani-rc-mini-bar, .ani-rc-mini-bar[data-segment], .ani-rc-cal-day[data-level]:not([data-level="0"]), .ani-rc-outcome-segment, .ani-rc-outcome-swatch, .ani-rc-weekday-bar, .ani-rc-season-bar, .ani-rc-mini-season-bar { background: CanvasText; }
  .ani-rc-cal-day[data-level="0"] { outline: 1px solid GrayText; outline-offset: -1px; }
  .ani-rc-calendar-streak, .ani-rc-calendar-fact[data-mark="streak"] .ani-rc-calendar-mark { background: Highlight; opacity: 1; }
  .ani-rc-segment-fill, .ani-rc-meter-fill, .ani-rc-clock-bar[data-peak="true"], .ani-rc-mini-bar[data-peak="true"], .ani-rc-cal-day[data-peak="true"], .ani-rc-weekday[data-top="true"] .ani-rc-weekday-bar, .ani-rc-season-column[data-leading="true"] .ani-rc-season-bar, .ani-rc-mini-season[data-leading="true"] .ani-rc-mini-season-bar { background: Highlight; }
  .ani-rc-segment::before, .ani-rc-tile-surface, .ani-rc-persona { border: 1px solid CanvasText; }
  .ani-rc-ribbon-streak, .ani-rc-ribbon-peak { background: Highlight; }
  .ani-recap-primary-button { border: 1px solid ButtonText; }
}
`;
