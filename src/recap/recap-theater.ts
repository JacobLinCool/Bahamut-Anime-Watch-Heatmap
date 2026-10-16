import type { AnalyticsResult } from "../analytics";
import { formatInteger } from "../analysis-format";
import { createButton, element, textElement } from "../view-dom";
import type { RecapPresentationChapter, RecapPresentationDeck } from "./recap-deck";
import {
  clipInsetBetween,
  prefersReducedRecapMotion,
  RecapChoreographer,
  type RectLike
} from "./recap-motion";
import { registerRecapProperties, type RecapTone } from "./recap-palette";
import { buildSummaryScene } from "./recap-poster";
import {
  buildChapterScene,
  buildEvidenceVeil,
  buildIntroScene,
  chapterCoverUrls,
  type RecapSceneContext,
  type RecapSceneHandle
} from "./recap-scenes";
import type { RecapDirection, RecapUiState } from "./recap-state";
import { handleRecapStageNavigationKey, RECAP_EVIDENCE_OPENER_FOCUS_KEY } from "./recap-view";

export type RecapTheaterCallbacks = {
  readonly onStart: () => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onGoto: (chapterId: string) => void;
  readonly onOpenEvidence: () => void;
  readonly onCloseEvidence: () => void;
  readonly onRestart: () => void;
  readonly onDashboard: () => void;
};

export type RecapTheaterInput = {
  readonly state: RecapUiState<RecapPresentationDeck>;
  /** 即時分析結果：開場畫面依它就地更新。 */
  readonly result: AnalyticsResult;
  /** 由即時結果建出的 deck：開場用來判斷能不能開始。 */
  readonly liveDeck: RecapPresentationDeck;
};

export type RecapTheaterLayout = "intro" | "playback";

/** 版面切換前量好的位置，讓劇場能從開場卡片「長」成全幅（或反向）。 */
export type RecapLayoutSnapshot = {
  readonly layout: RecapTheaterLayout;
  readonly theater: DOMRect;
  readonly scene: DOMRect | null;
  /** 當下的 --rc-top-inset（播放時是標題列高度）：收回卡片時退場畫面與 chrome 維持這個上緣。 */
  readonly topInset: string;
};

type TheaterMode = "intro" | "chapter" | "summary";

type ResolvedView = {
  readonly mode: TheaterMode;
  readonly key: string;
  readonly deck: RecapPresentationDeck | null;
  readonly chapter: RecapPresentationChapter | null;
  readonly chapterIndex: number;
  readonly evidence: boolean;
  readonly stale: boolean;
  readonly direction: RecapDirection;
};

const INTRO_RADIUS = 22;
const MORPH_DURATION = 720;
/** 容器轉場用的「強調減速」曲線：起步比 expo-out 柔和，看得出卡片在長大。 */
const MORPH_EASING = "cubic-bezier(.3, 0, 0, 1)";
const IMPRINT_WIDTH = 72;
const IMPRINT_HEIGHT = 45;
const IMAGE_CACHE_LIMIT = 96;
/** 點在文字上的第一下先等這麼久：雙擊選字時第二下會取消它，不會先換章再選到新畫面的字。 */
const TEXT_CLICK_DELAY_MILLISECONDS = 300;

export type RecapZoneClickAction = "ignore" | "navigate" | "defer";

/**
 * 點畫面左右換章時怎麼處理這一下：已經選取文字、或在文字上連點（雙擊、三擊選字）時不換章；
 * 點在文字上的第一下可能是雙擊的開頭，先延後；點在空白處（連點也一樣）立即換章，快速點過好幾章不受影響。
 */
export const recapZoneClickAction = (click: {
  readonly detail: number;
  readonly onText: boolean;
  readonly hasSelection: boolean;
}): RecapZoneClickAction => {
  if (click.hasSelection || (click.onText && click.detail > 1)) return "ignore";
  return click.onText ? "defer" : "navigate";
};

/**
 * 回顧的常駐舞台：背景 field、封面 imprint、顆粒、進度與操作列只建一次，
 * 開場、每一章、資料依據與結尾海報都在同一個舞台上換「前景」。
 * 離開回顧（回總覽或關閉觀看誌）時由呼叫端 destroy。
 */
export class RecapTheater {
  readonly root: HTMLElement;
  readonly #callbacks: RecapTheaterCallbacks;
  readonly #field: HTMLElement;
  readonly #imprints: readonly [HTMLCanvasElement, HTMLCanvasElement];
  readonly #viewport: HTMLElement;
  readonly #chrome: HTMLElement;
  readonly #progress: HTMLElement;
  readonly #counter: HTMLElement;
  readonly #stalePill: HTMLElement;
  readonly #controls: HTMLElement;
  readonly #previousButton: HTMLButtonElement;
  readonly #nextButton: HTMLButtonElement;
  readonly #choreographer: RecapChoreographer;
  readonly #images = new Map<string, Promise<HTMLImageElement | null>>();
  #view: ResolvedView | undefined;
  #scene: RecapSceneHandle | undefined;
  /** 目前畫面的 view key（含 deck fingerprint）；相同就只更新、不重建。 */
  #sceneKey = "";
  #segmentsFingerprint = "";
  #evidence: HTMLElement | undefined;
  #evidenceKey = "";
  #suspendedFocus: HTMLElement | undefined;
  #morph: { readonly animation: Animation; readonly cleanup: () => void } | undefined;
  #imprintUrl: string | null | undefined;
  #imprintToken = 0;
  #imprintFront: 0 | 1 = 0;
  #pendingZoneClick: ReturnType<typeof setTimeout> | undefined;
  #destroyed = false;

  constructor(callbacks: RecapTheaterCallbacks) {
    registerRecapProperties();
    this.#callbacks = callbacks;
    const root = element("section", "ani-rc-theater");
    root.setAttribute("aria-label", "期間回顧");
    root.dataset.layout = "intro";
    root.dataset.mode = "intro";
    root.dataset.tone = "intro";

    const field = element("div", "ani-rc-field");
    field.dataset.tone = "intro";
    field.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 3; index += 1) field.append(element("span", "ani-rc-blob"));

    const imprint = element("div", "ani-rc-imprint");
    imprint.setAttribute("aria-hidden", "true");
    const front = element("canvas", "ani-rc-imprint-layer");
    const back = element("canvas", "ani-rc-imprint-layer");
    for (const canvas of [front, back]) {
      canvas.width = IMPRINT_WIDTH;
      canvas.height = IMPRINT_HEIGHT;
    }
    imprint.append(front, back);

    const grain = element("div", "ani-rc-grain");
    grain.setAttribute("aria-hidden", "true");

    const viewport = element("div", "ani-rc-viewport");
    viewport.addEventListener("click", this.#handleViewportClick);

    const chrome = element("div", "ani-rc-chrome");
    const progress = element("div", "ani-rc-progress");
    progress.setAttribute("role", "group");
    progress.setAttribute("aria-label", "章節進度");
    const meta = element("div", "ani-rc-chrome-meta");
    const counter = textElement("span", "ani-rc-chrome-count", "");
    counter.setAttribute("aria-hidden", "true");
    const stalePill = textElement("span", "ani-recap-stale", "觀看資料有更新；這次回顧仍保留開場時看到的內容");
    stalePill.hidden = true;
    meta.append(counter, stalePill);
    chrome.append(progress, meta);

    const controls = element("div", "ani-rc-controls");
    const previousButton = createButton("ani-recap-ghost-button", "回到開場");
    previousButton.addEventListener("click", () => this.#callbacks.onPrevious());
    const evidenceButton = createButton("ani-recap-evidence-button", "怎麼計算");
    evidenceButton.dataset.analysisFocusKey = RECAP_EVIDENCE_OPENER_FOCUS_KEY;
    evidenceButton.addEventListener("click", () => this.#callbacks.onOpenEvidence());
    const nextButton = createButton("ani-recap-primary-button", "下一章");
    nextButton.addEventListener("click", () => this.#callbacks.onNext());
    const hint = textElement("span", "ani-rc-controls-hint", "← → 或點畫面左右切換");
    hint.setAttribute("aria-hidden", "true");
    const center = element("div", "ani-rc-controls-center");
    center.append(evidenceButton, hint);
    controls.append(previousButton, center, nextButton);

    root.append(field, imprint, grain, viewport, chrome, controls);
    root.addEventListener("keydown", this.#handleKeydown);

    this.root = root;
    this.#field = field;
    this.#imprints = [front, back];
    this.#viewport = viewport;
    this.#chrome = chrome;
    this.#progress = progress;
    this.#counter = counter;
    this.#stalePill = stalePill;
    this.#controls = controls;
    this.#previousButton = previousButton;
    this.#nextButton = nextButton;
    this.#choreographer = new RecapChoreographer(viewport);
  }

  /** 在呼叫端改動外層版面（開場 ↔ 播放）之前呼叫，記下劇場與目前畫面的位置。 */
  snapshotLayout(): RecapLayoutSnapshot | null {
    if (this.#destroyed || !this.root.isConnected) return null;
    this.#endMorph();
    const scene = this.#choreographer.current();
    return {
      layout: this.root.dataset.layout === "playback" ? "playback" : "intro",
      theater: this.root.getBoundingClientRect(),
      scene: scene ? scene.getBoundingClientRect() : null,
      topInset: getComputedStyle(this.root).getPropertyValue("--rc-top-inset").trim()
    };
  }

  render(input: RecapTheaterInput, snapshot: RecapLayoutSnapshot | null = null): void {
    if (this.#destroyed) return;
    const view = resolveView(input.state, this.#view);
    if (!view) return;
    const reduced = prefersReducedRecapMotion();
    const layout: RecapTheaterLayout = view.mode === "intro" ? "intro" : "playback";
    this.root.dataset.layout = layout;
    this.root.dataset.mode = view.mode;
    this.#syncChrome(view);
    this.#syncControls(view);

    const context = this.#sceneContext(input, view);
    if (this.#scene && this.#sceneKey === view.key) {
      // 同一個畫面的重複 render（背景資料更新、資料依據開關）：只更新，不重播。
      this.#scene.update?.(context);
    } else {
      if (this.#evidence) this.#closeEvidence(true);
      const handle = this.#buildScene(view, context);
      const direction = this.#scene ? view.direction : "forward";
      const morph = snapshot && snapshot.layout !== layout && !reduced ? snapshot : null;
      if (morph && layout === "intro") {
        this.#swapIntoIntro(handle, morph, direction);
      } else {
        const leaving = this.#choreographer.swap(handle.root, { direction, reduced });
        if (morph) this.#expandToPlayback(morph, leaving);
      }
      this.#scene = handle;
      this.#sceneKey = view.key;
      this.#setTone(handle.tone);
      this.#setImprint(handle.imprintUrl);
      this.#preloadAround(view, input);
    }
    this.#view = view;
    this.#syncEvidence(view);
    if (view.mode === "intro" && this.#scene) this.#setImprint(this.#scene.imprintUrl);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#cancelPendingZoneClick();
    this.#endMorph();
    this.#choreographer.destroy();
    this.#imprintToken += 1;
    this.root.removeEventListener("keydown", this.#handleKeydown);
    this.#viewport.removeEventListener("click", this.#handleViewportClick);
    for (const animation of this.root.getAnimations({ subtree: true })) animation.cancel();
    this.root.remove();
    this.#images.clear();
    this.#scene = undefined;
    this.#evidence = undefined;
  }

  // ── 畫面

  #sceneContext(input: RecapTheaterInput, view: ResolvedView): RecapSceneContext {
    return {
      result: input.result,
      liveDeck: input.liveDeck,
      stale: view.stale,
      onStart: this.#callbacks.onStart,
      onDashboard: this.#callbacks.onDashboard
    };
  }

  #buildScene(view: ResolvedView, context: RecapSceneContext): RecapSceneHandle {
    if (view.mode === "intro" || !view.deck) return buildIntroScene(context);
    if (view.mode === "summary") {
      return buildSummaryScene(view.deck, view.stale, {
        onRestart: this.#callbacks.onRestart,
        onPrevious: this.#callbacks.onPrevious,
        onDashboard: this.#callbacks.onDashboard,
        onGoto: this.#callbacks.onGoto
      });
    }
    return view.chapter ? buildChapterScene(view.chapter) : buildIntroScene(context);
  }

  /** 開場 → 播放：劇場已經是全幅，先用 clip-path 裁回卡片大小，再一路展開。 */
  #expandToPlayback(snapshot: RecapLayoutSnapshot, leaving: HTMLElement | null): void {
    const last = this.root.getBoundingClientRect();
    if (leaving && snapshot.scene) pinScene(leaving, snapshot.scene, last);
    const animation = this.root.animate([
      { clipPath: clipInsetBetween(last, snapshot.theater, INTRO_RADIUS) },
      { clipPath: "inset(0px 0px 0px 0px round 0px)" }
    ], { duration: MORPH_DURATION, easing: MORPH_EASING });
    this.#trackMorph(animation, () => undefined);
  }

  /**
   * 播放 → 開場：外層版面已經回到卡片，但劇場暫時以絕對定位維持全幅，
   * 新的開場畫面釘在它最終的卡片位置，再把 clip-path 收回卡片。
   */
  #swapIntoIntro(handle: RecapSceneHandle, snapshot: RecapLayoutSnapshot, direction: RecapDirection): void {
    const card = this.root.getBoundingClientRect();
    const leaving = this.#choreographer.swap(handle.root, { direction, reduced: false });
    const sceneRect = handle.root.getBoundingClientRect();
    const parent = this.root.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const full = snapshot.theater;
    this.root.dataset.morph = "true";
    Object.assign(this.root.style, {
      position: "absolute",
      left: `${full.left - parentRect.left}px`,
      top: `${full.top - parentRect.top}px`,
      width: `${full.width}px`,
      height: `${full.height}px`
    });
    // data-layout 已經是 intro（上緣歸零）：退場的章節與淡出中的 chrome 仍留在標題列下方，不往上跳。
    if (snapshot.topInset) this.root.style.setProperty("--rc-top-inset", snapshot.topInset);
    if (leaving && snapshot.scene) pinScene(leaving, snapshot.scene, full);
    pinScene(handle.root, sceneRect, full);
    const animation = this.root.animate([
      { clipPath: "inset(0px 0px 0px 0px round 0px)" },
      { clipPath: clipInsetBetween(full, card, INTRO_RADIUS) }
    ], { duration: MORPH_DURATION, easing: MORPH_EASING });
    this.#trackMorph(animation, () => {
      delete this.root.dataset.morph;
      for (const property of ["position", "left", "top", "width", "height", "--rc-top-inset"]) this.root.style.removeProperty(property);
      unpinScene(handle.root);
    });
  }

  #trackMorph(animation: Animation, cleanup: () => void): void {
    const entry = { animation, cleanup };
    this.#morph = entry;
    const settle = (): void => {
      if (this.#morph !== entry) return;
      this.#morph = undefined;
      cleanup();
    };
    animation.addEventListener("finish", settle, { once: true });
    animation.addEventListener("cancel", settle, { once: true });
  }

  #endMorph(): void {
    const morph = this.#morph;
    if (!morph) return;
    this.#morph = undefined;
    morph.animation.cancel();
    morph.cleanup();
  }

  // ── chrome 與操作列：常駐，只就地更新

  #syncChrome(view: ResolvedView): void {
    const deck = view.deck;
    const active = view.mode === "chapter";
    // 資料依據開著時只有面板能互動：背景資料 tick 也不能把進度列放回 Tab 與報讀順序。
    this.#chrome.inert = !active || view.evidence;
    if (!deck) return;
    if (deck.fingerprint !== this.#segmentsFingerprint) {
      this.#segmentsFingerprint = deck.fingerprint;
      this.#progress.replaceChildren(...deck.chapters.map((chapter, index) => {
        const segment = createButton("ani-rc-segment", "");
        segment.setAttribute("aria-label", `第 ${index + 1} 章：${chapter.title}`);
        segment.dataset.chapterId = chapter.id;
        segment.dataset.tone = chapter.kind;
        segment.append(element("span", "ani-rc-segment-fill"));
        segment.addEventListener("click", () => this.#callbacks.onGoto(chapter.id));
        return segment;
      }));
    }
    const current = view.mode === "summary" ? deck.chapters.length : view.chapterIndex;
    this.#progress.querySelectorAll<HTMLButtonElement>(".ani-rc-segment").forEach((segment, index) => {
      segment.dataset.state = index < current ? "done" : index === current ? "current" : "upcoming";
      if (index === current) segment.setAttribute("aria-current", "step");
      else segment.removeAttribute("aria-current");
    });
    if (view.mode === "chapter") {
      this.#counter.textContent = `第 ${formatInteger(view.chapterIndex + 1)} 章 / 共 ${formatInteger(deck.chapters.length)} 章`;
    }
    this.#stalePill.hidden = !view.stale;
  }

  #syncControls(view: ResolvedView): void {
    const active = view.mode === "chapter";
    this.#controls.inert = !active || view.evidence;
    if (!active || !view.deck) return;
    this.#previousButton.textContent = view.chapterIndex === 0 ? "回到開場" : "上一章";
    this.#nextButton.textContent = view.chapterIndex === view.deck.chapters.length - 1 ? "看結尾" : "下一章";
  }

  // ── 資料依據：疊在仍然可見的章節上

  #syncEvidence(view: ResolvedView): void {
    const key = view.evidence && view.chapter ? view.key : "";
    if (key && key !== this.#evidenceKey) {
      if (this.#evidence) this.#closeEvidence(true);
      this.#openEvidence(view.chapter!, key);
    } else if (!key && this.#evidence) {
      this.#closeEvidence(false);
    }
  }

  #openEvidence(chapter: RecapPresentationChapter, key: string): void {
    const veil = buildEvidenceVeil(chapter, () => this.#callbacks.onCloseEvidence());
    this.#evidence = veil;
    this.#evidenceKey = key;
    this.root.dataset.evidence = "open";
    this.#viewport.inert = true;
    this.#chrome.inert = true;
    this.#controls.inert = true;
    // 焦點契約：資料依據開著時，唯一的 data-recap-focus 是面板標題。
    const sceneFocus = this.#scene?.root.querySelector<HTMLElement>("[data-recap-focus]") ?? undefined;
    if (sceneFocus) {
      delete sceneFocus.dataset.recapFocus;
      this.#suspendedFocus = sceneFocus;
    }
    this.root.append(veil);
    if (!prefersReducedRecapMotion()) {
      veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
    }
  }

  #closeEvidence(immediate: boolean): void {
    const veil = this.#evidence;
    if (!veil) return;
    this.#evidence = undefined;
    this.#evidenceKey = "";
    delete this.root.dataset.evidence;
    this.#viewport.inert = false;
    this.#chrome.inert = this.#view?.mode !== "chapter";
    this.#controls.inert = this.#view?.mode !== "chapter";
    if (this.#suspendedFocus) {
      this.#suspendedFocus.dataset.recapFocus = "true";
      this.#suspendedFocus = undefined;
    }
    veil.inert = true;
    veil.setAttribute("aria-hidden", "true");
    for (const node of veil.querySelectorAll<HTMLElement>("[data-recap-focus]")) delete node.dataset.recapFocus;
    if (immediate || prefersReducedRecapMotion()) {
      veil.remove();
      return;
    }
    const fade = veil.animate([{ opacity: 0 }], { duration: 180, easing: "ease-in", fill: "forwards" });
    void fade.finished.then(() => veil.remove(), () => veil.remove());
  }

  // ── 背景：色調與封面 imprint

  #setTone(tone: RecapTone): void {
    this.root.dataset.tone = tone;
    this.#field.dataset.tone = tone;
  }

  /**
   * 把主角封面畫成極小的模糊點陣圖，再由 CSS 放大成背景的一抹色。
   * 只畫一次、不讀像素，所以跨來源（tainted）的圖也沒問題；載入失敗就淡出。
   */
  #setImprint(url: string | null): void {
    if (url === this.#imprintUrl) return;
    this.#imprintUrl = url;
    const token = ++this.#imprintToken;
    if (!url) {
      for (const canvas of this.#imprints) canvas.style.opacity = "0";
      return;
    }
    void this.#loadImage(url).then((image) => {
      if (token !== this.#imprintToken || this.#destroyed) return;
      if (!image) {
        for (const canvas of this.#imprints) canvas.style.opacity = "0";
        return;
      }
      const nextIndex = this.#imprintFront === 0 ? 1 : 0;
      const target = this.#imprints[nextIndex];
      const current = this.#imprints[this.#imprintFront];
      if (!target || !current) return;
      if (!drawImprint(target, image)) return;
      target.style.opacity = "";
      target.dataset.visible = "true";
      delete current.dataset.visible;
      current.style.opacity = "0";
      this.#imprintFront = nextIndex;
    });
  }

  #loadImage(url: string): Promise<HTMLImageElement | null> {
    const cached = this.#images.get(url);
    if (cached) return cached;
    const image = new Image();
    image.referrerPolicy = "no-referrer";
    image.decoding = "async";
    image.src = url;
    const pending = image.decode().then(() => image, () => null);
    if (this.#images.size >= IMAGE_CACHE_LIMIT) {
      const oldest = this.#images.keys().next().value;
      if (oldest !== undefined) this.#images.delete(oldest);
    }
    this.#images.set(url, pending);
    return pending;
  }

  /** 前後兩章的封面先解碼好，換場時新畫面不會出現空白格。 */
  #preloadAround(view: ResolvedView, input: RecapTheaterInput): void {
    const urls: string[] = [];
    const deck = view.deck;
    if (view.mode === "intro") {
      const first = input.liveDeck.chapters[0];
      if (first) urls.push(...chapterCoverUrls(first));
    } else if (deck) {
      const neighbours = view.mode === "summary"
        ? [deck.chapters.at(-1)]
        : [deck.chapters[view.chapterIndex + 1], deck.chapters[view.chapterIndex - 1]];
      for (const chapter of neighbours) if (chapter) urls.push(...chapterCoverUrls(chapter));
      if (view.mode === "chapter" && view.chapterIndex >= deck.chapters.length - 2) {
        urls.push(...deck.summary.covers.map((cover) => cover.coverUrl));
      }
    }
    for (const url of urls.slice(0, 16)) void this.#loadImage(url);
  }

  // ── 輸入

  readonly #handleKeydown = (event: KeyboardEvent): void => {
    const view = this.#view;
    if (!view || view.evidence || view.mode === "intro") return;
    handleRecapStageNavigationKey(
      event,
      () => this.#callbacks.onPrevious(),
      () => {
        // 結尾不再往後；連按 → 也不會意外重播整段回顧。
        if (view.mode === "chapter") this.#callbacks.onNext();
      }
    );
  };

  /** 點畫面左側三成回上一章，其餘往下一章；按鈕、選取文字（含雙擊選字）與資料依據開著時不觸發。 */
  readonly #handleViewportClick = (event: MouseEvent): void => {
    const view = this.#view;
    if (!view || view.mode !== "chapter" || view.evidence || event.defaultPrevented || event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    // 只看 viewport 內的祖先：外層觀看誌本身就是 role="dialog"。
    const interactive = target.closest("button, a, input, select, textarea, label, summary, [role='dialog'], [data-rc-no-zone]");
    if (interactive && this.#viewport.contains(interactive)) return;
    // 雙擊的第二下：取消第一下排好的換章，讓瀏覽器選字。
    if (event.detail > 1) this.#cancelPendingZoneClick();
    const action = recapZoneClickAction({
      detail: event.detail,
      onText: hasOwnText(target),
      hasSelection: this.#hasSelection()
    });
    if (action === "ignore") return;
    const rect = this.#viewport.getBoundingClientRect();
    const backward = event.clientX - rect.left < rect.width * 0.3;
    const navigate = (): void => {
      if (backward) this.#callbacks.onPrevious();
      else this.#callbacks.onNext();
    };
    if (action === "navigate") {
      navigate();
      return;
    }
    this.#cancelPendingZoneClick();
    const key = view.key;
    this.#pendingZoneClick = setTimeout(() => {
      this.#pendingZoneClick = undefined;
      const current = this.#view;
      // 等待中已經換了畫面（鍵盤、按鈕）或開了資料依據，這一下就不算數。
      if (this.#destroyed || !current || current.key !== key || current.evidence || this.#hasSelection()) return;
      navigate();
    }, TEXT_CLICK_DELAY_MILLISECONDS);
  };

  #cancelPendingZoneClick(): void {
    if (this.#pendingZoneClick !== undefined) clearTimeout(this.#pendingZoneClick);
    this.#pendingZoneClick = undefined;
  }

  #hasSelection(): boolean {
    const root = this.root.getRootNode();
    const selection = (root instanceof ShadowRoot && "getSelection" in root
      ? (root as ShadowRoot & { getSelection(): Selection | null }).getSelection()
      : null) ?? document.getSelection();
    return Boolean(selection && !selection.isCollapsed && selection.toString().trim().length > 0);
  }
}

/** 點擊落在元素自己的文字上（不是空白處或封面）：可能是要選字。 */
const hasOwnText = (node: Element): boolean => Array.from(node.childNodes)
  .some((child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim().length > 0);

const resolveView = (
  state: RecapUiState<RecapPresentationDeck>,
  previous: ResolvedView | undefined
): ResolvedView | null => {
  switch (state.kind) {
    case "recap-intro":
      return {
        mode: "intro",
        key: "intro",
        deck: null,
        chapter: null,
        chapterIndex: -1,
        evidence: false,
        stale: false,
        // 從第一章退回開場時，維持「往回」的空間方向。
        direction: previous && previous.mode !== "intro" ? "backward" : "forward"
      };
    case "recap-chapter":
    case "recap-evidence": {
      const chapterIndex = state.deck.chapters.findIndex((chapter) => chapter.id === state.chapterId);
      const chapter = state.deck.chapters[chapterIndex];
      if (!chapter) return null;
      return {
        mode: "chapter",
        key: `${state.deck.fingerprint}:${chapter.id}`,
        deck: state.deck,
        chapter,
        chapterIndex,
        evidence: state.kind === "recap-evidence",
        stale: state.stale,
        direction: state.kind === "recap-chapter" ? state.direction : previous?.direction ?? "forward"
      };
    }
    case "recap-summary":
      return {
        mode: "summary",
        key: `${state.deck.fingerprint}:summary`,
        deck: state.deck,
        chapter: null,
        chapterIndex: state.deck.chapters.length,
        evidence: false,
        stale: state.stale,
        direction: state.direction
      };
    default:
      return null;
  }
};

/** 退場中的畫面釘在它原本的螢幕位置，外層版面怎麼變都不會跳。 */
const pinScene = (scene: HTMLElement, rect: RectLike, container: RectLike): void => {
  Object.assign(scene.style, {
    position: "absolute",
    left: `${rect.left - container.left}px`,
    top: `${rect.top - container.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  });
  scene.dataset.rcPinned = "true";
};

const unpinScene = (scene: HTMLElement): void => {
  for (const property of ["position", "left", "top", "width", "height"]) scene.style.removeProperty(property);
  delete scene.dataset.rcPinned;
};

const drawImprint = (canvas: HTMLCanvasElement, image: HTMLImageElement): boolean => {
  const context = canvas.getContext("2d");
  if (!context || image.naturalWidth <= 0 || image.naturalHeight <= 0) return false;
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.filter = "blur(3px) saturate(1.45)";
  // 稍微超出畫布邊界，模糊後邊緣才不會透明。
  const overscan = 6;
  const scale = Math.max((width + overscan * 2) / image.naturalWidth, (height + overscan * 2) / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  try {
    context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  } catch {
    return false;
  }
  context.filter = "none";
  return true;
};
