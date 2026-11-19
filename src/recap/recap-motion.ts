import { formatCompactDuration, formatDuration, formatInteger } from "../analysis-format";
import type { RecapDirection } from "./recap-state";
import { fitPoster } from "./recap-poster";
import { fitHeadlines } from "./recap-text";

export const RC_EASE_OUT = "cubic-bezier(.16, 1, .3, 1)";
export const RC_EASE_IN = "cubic-bezier(.4, 0, 1, 1)";
/** 退場淡出：前段就掉到兩成多，新標題擦進來時舊字已經看不清，不會疊成雙重曝光。 */
export const RC_FADE_OUT = "cubic-bezier(0, 0, .2, 1)";
/** 阻尼彈簧（k≈180、c≈22）：約 1% 過衝，於六成時間內收斂。 */
export const RC_SPRING = "linear(0, .139, .385, .614, .785, .897, .961, .994, 1.007, 1.01, 1.009, 1.007, 1.004, 1.002, 1.001, 1)";

/** 換場節奏：舊畫面先退，新畫面在 enterLead 後疊上來，兩者重疊而不留空白。 */
export const RECAP_TIMING = Object.freeze({
  /** 退場：透明度前段就掉完（RC_FADE_OUT），位移用 ease-in 多走一點收尾。 */
  exitFade: 150,
  exitDuration: 260,
  exitStagger: 10,
  exitStaggerCap: 5,
  exitDistance: 16,
  /**
   * 整層退場：進結尾海報時的上一章，以及離開海報或開場這類密集畫面時，
   * 整張畫面當成一層、用這個時間淡掉。
   */
  summaryExitFade: 110,
  /** 新畫面在舊畫面淡到約兩成時就開始進場；標題緊跟在 lead 之後擦出。 */
  enterLead: 105,
  /** 離開密集畫面（整層淡出）時，新畫面的字等舊畫面幾乎消失才進來；共享元素照樣立刻起飛。 */
  layerEnterLead: 135,
  enterStagger: 48,
  enterStaggerCap: 10,
  enterDuration: 640,
  enterDistance: 28,
  assembleStagger: 40,
  /** 最後一塊磚在 enterLead + 11 × 40 ≈ 545 ms 開始，整張海報約 1 秒內落定。 */
  assembleStaggerCap: 11,
  assembleDuration: 460,
  /** 海報裡的長條（觀看時鐘、節奏）整組一起長，不逐條排隊。 */
  assembleBarDelay: 90,
  assembleBarStagger: 4,
  flipDuration: 720,
  /** 接力封面：框飛到新位置的同時，舊封面在框裡淡出、露出新封面。 */
  batonFade: 420,
  countDuration: 900,
  /** 海報上的數字跳得短一點：五十幾個零件在一秒左右全部到位。 */
  assembleCountDuration: 700,
  countLead: 140,
  /** 減少動態效果：先淡出、再淡入，兩張畫面不會同時半透明地疊在一起。 */
  reducedExit: 90,
  reducedEnter: 140,
  reducedLead: 95
});

export type RectLike = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

export type FlipDelta = {
  readonly dx: number;
  readonly dy: number;
  readonly sx: number;
  readonly sy: number;
};

/** FLIP 的 Invert：把元素從新位置（last）倒推回舊位置（first），transform-origin 為左上角。 */
export const flipDelta = (first: RectLike, last: RectLike): FlipDelta => ({
  dx: round(first.left - last.left),
  dy: round(first.top - last.top),
  sx: last.width > 0 ? round(first.width / last.width, 4) : 1,
  sy: last.height > 0 ? round(first.height / last.height, 4) : 1
});

export const flipTransform = (delta: FlipDelta): string =>
  `translate(${delta.dx}px, ${delta.dy}px) scale(${delta.sx}, ${delta.sy})`;

/**
 * 元素實際的 CSS zoom。大螢幕上海報整張放大時，量到的位置是畫面上的像素，
 * 但寫回元素的位移與寬度會再被 zoom 乘一次，所以要先換回元素自己的座標。
 */
export const cssZoom = (element: Element): number => {
  const zoom = (element as Element & { readonly currentCSSZoom?: number }).currentCSSZoom;
  return typeof zoom === "number" && zoom > 0 ? zoom : 1;
};

const localDelta = (delta: FlipDelta, element: Element): FlipDelta => {
  const zoom = cssZoom(element);
  return zoom === 1 ? delta : { ...delta, dx: round(delta.dx / zoom), dy: round(delta.dy / zoom) };
};

export const isNoopFlip = (delta: FlipDelta): boolean =>
  Math.abs(delta.dx) < 0.5 && Math.abs(delta.dy) < 0.5
  && Math.abs(delta.sx - 1) < 0.005 && Math.abs(delta.sy - 1) < 0.005;

/** 以 outer 為參考框，算出把畫面裁成 inner 的 clip-path（容器轉場用）。 */
export const clipInsetBetween = (outer: RectLike, inner: RectLike, radius: number): string => {
  const top = Math.max(0, round(inner.top - outer.top));
  const left = Math.max(0, round(inner.left - outer.left));
  const right = Math.max(0, round(outer.left + outer.width - (inner.left + inner.width)));
  const bottom = Math.max(0, round(outer.top + outer.height - (inner.top + inner.height)));
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${round(radius)}px)`;
};

export const exitDelay = (index: number): number =>
  Math.min(index, RECAP_TIMING.exitStaggerCap) * RECAP_TIMING.exitStagger;

export const enterDelay = (
  index: number,
  tempo: "story" | "assemble" = "story",
  lead: number = RECAP_TIMING.enterLead
): number => tempo === "assemble"
  ? lead + Math.min(index, RECAP_TIMING.assembleStaggerCap) * RECAP_TIMING.assembleStagger
  : lead + Math.min(index, RECAP_TIMING.enterStaggerCap) * RECAP_TIMING.enterStagger;

/** 舊畫面是開場或結尾海報這類「整層退場」的密集畫面嗎？依離開的那張判斷，不看進來的。 */
export const exitsAsLayer = (scene: { readonly dataset: DOMStringMap } | null): boolean =>
  scene?.dataset.rcExit === "layer";

/** 往前：內容往上推走、新內容由下方進來；往後完全對稱。 */
export const travelOffsets = (direction: RecapDirection): { readonly exit: number; readonly enter: number } =>
  direction === "forward"
    ? { exit: -RECAP_TIMING.exitDistance, enter: RECAP_TIMING.enterDistance }
    : { exit: RECAP_TIMING.exitDistance, enter: -RECAP_TIMING.enterDistance };

export const countUpFormatter = (format: string | undefined): (value: number) => string => {
  switch (format) {
    case "duration": return (value) => formatDuration(Math.max(0, Math.round(value)));
    case "compact-duration": return (value) => formatCompactDuration(Math.max(0, Math.round(value)));
    case "decimal": return (value) => decimalFormatter.format(Math.round(value * 10) / 10);
    default: return (value) => formatInteger(Math.round(value));
  }
};

const decimalFormatter = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 });

export const prefersReducedRecapMotion = (): boolean => typeof window !== "undefined"
  && typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type RecapSwapOptions = {
  readonly direction: RecapDirection;
  readonly reduced: boolean;
  /** false：直接換上新畫面，不播進退場（例如測試或重新掛載）。 */
  readonly animate?: boolean;
};

type CountJob = {
  readonly node: HTMLElement;
  readonly lock: HTMLElement;
  readonly from: number;
  readonly to: number;
  readonly format: (value: number) => string;
  readonly timer: Animation;
  last: string;
};

/**
 * 換場編排：只動前景 scene 的零件（transform / opacity / clip-path），背景與 chrome
 * 由劇場常駐。任何一次 swap 都會先把進行中的動畫定格在當下的畫面（commitStyles）再接手，
 * 所以連按、倒退、跳章都能即時改道，不需要鎖住輸入。
 */
export class RecapChoreographer {
  readonly #viewport: HTMLElement;
  readonly #live = new Set<Animation>();
  #countJobs: CountJob[] = [];
  #countFrame = 0;

  constructor(viewport: HTMLElement) {
    this.#viewport = viewport;
  }

  current(): HTMLElement | null {
    return this.#viewport.querySelector<HTMLElement>(":scope > .ani-rc-scene:not([data-rc-leaving])");
  }

  /** 換上新 scene；回傳正在退場的舊 scene（若有），讓呼叫端可以釘住它的位置。 */
  swap(next: HTMLElement, options: RecapSwapOptions): HTMLElement | null {
    const previous = this.current();
    this.#interrupt();

    // READ：舊 scene 的共享元素位置與數字，必須在任何寫入之前讀完。
    const reduced = options.reduced;
    const animate = options.animate !== false;
    const sharedRects = previous && animate && !reduced ? readSharedRects(previous) : new Map<string, DOMRect>();
    const previousBaton = previous && animate && !reduced ? readBaton(previous) : null;
    const previousCounts = previous && animate && !reduced ? readCountTargets(previous) : new Map<string, number>();

    // WRITE
    if (previous) markLeaving(previous);
    this.#viewport.append(next);
    // 標題字級與海報的放大倍數要在量位置之前定案，否則共享元素會飛到縮放前的位置。
    fitHeadlines(next);
    fitPoster(next);
    if (!animate) {
      previous?.remove();
      return null;
    }

    if (reduced) {
      if (previous) this.#exitReduced(previous);
      this.#track(next.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: RECAP_TIMING.reducedEnter,
        delay: previous ? RECAP_TIMING.reducedLead : 0,
        easing: "ease-out",
        fill: "backwards"
      }));
      return previous;
    }

    // READ（第二批）：新 scene 已在版面上，一次量完共享元素、接力封面與數字寬度。
    const flips = collectFlips(next, sharedRects);
    const baton = collectBaton(next, previousBaton, flips);
    const countNodes = [...next.querySelectorAll<HTMLElement>("[data-count-to]")];
    const countWidths = countNodes.map((node) => (node.parentElement ?? node).getBoundingClientRect().width);

    // WRITE（第二批）
    const tempo = next.dataset.rcTempo === "assemble" ? "assemble" : "story";
    const layer = exitsAsLayer(previous);
    if (previous) this.#exit(previous, options.direction, flips.map((flip) => flip.key), tempo, baton?.source ?? null);
    const flying = new Set(flips.map((flip) => flip.element));
    if (baton) flying.add(baton.element);
    const partDelays = this.#enter(next, options.direction, flying, layer ? RECAP_TIMING.layerEnterLead : RECAP_TIMING.enterLead);
    for (const flip of flips) this.#flip(flip);
    if (baton) this.#passBaton(baton);
    this.#startCounts(countNodes, countWidths, partDelays, previousCounts,
      tempo === "assemble" ? RECAP_TIMING.assembleCountDuration : RECAP_TIMING.countDuration);
    return previous;
  }

  /** 中斷所有進行中的換場：定格在目前畫面，清掉殘留的退場 scene。 */
  #interrupt(): void {
    for (const animation of this.#live) {
      try {
        if (animation.effect instanceof KeyframeEffect && animation.effect.getKeyframes().length > 0) {
          animation.commitStyles();
        }
      } catch {
        // 目標已離開版面時 commitStyles 會丟錯；直接取消即可。
      }
      animation.cancel();
    }
    this.#live.clear();
    this.#stopCounts();
    for (const stale of this.#viewport.querySelectorAll<HTMLElement>(":scope > [data-rc-leaving]")) stale.remove();
  }

  destroy(): void {
    this.#interrupt();
  }

  #exit(
    scene: HTMLElement,
    direction: RecapDirection,
    handedOff: readonly string[],
    tempo: "story" | "assemble",
    batonSource: HTMLElement | null
  ): void {
    const { exit } = travelOffsets(direction);
    const layer = exitsAsLayer(scene);
    const parts = layer ? [] : topLevelParts(scene);
    // 密集畫面整張當一層退場：一組動畫取代五十多個零件各自淡出，也不會殘留半透明的磚。
    const targets = parts.length > 0 ? parts : [scene];
    const fade = layer || tempo === "assemble" ? RECAP_TIMING.summaryExitFade : RECAP_TIMING.exitFade;
    const animations = targets.flatMap((part, index) => [
      part.animate([{ opacity: 0 }], {
        duration: fade,
        delay: exitDelay(index),
        easing: RC_FADE_OUT,
        fill: "forwards"
      }),
      part.animate([{ translate: `0 ${exit}px` }], {
        duration: RECAP_TIMING.exitDuration,
        delay: exitDelay(index),
        easing: RC_EASE_IN,
        fill: "forwards"
      })
    ]);
    // 被新 scene 接手的共享元素立刻藏起來，由新的那一份從這裡飛走。
    for (const key of handedOff) {
      for (const twin of scene.querySelectorAll<HTMLElement>(`[data-rc-shared="${cssEscape(key)}"]`)) {
        twin.style.visibility = "hidden";
      }
    }
    if (batonSource) batonSource.style.visibility = "hidden";
    this.#track(...animations);
    removeAfter(scene, animations);
  }

  #exitReduced(scene: HTMLElement): void {
    const animation = scene.animate([{ opacity: 0 }], {
      duration: RECAP_TIMING.reducedExit,
      easing: "ease-in",
      fill: "forwards"
    });
    this.#track(animation);
    removeAfter(scene, [animation]);
  }

  /** 依零件類型播進場；回傳每個零件的起始延遲，讓數字在該零件出現後才開始跳。 */
  #enter(
    scene: HTMLElement,
    direction: RecapDirection,
    flipping: ReadonlySet<HTMLElement>,
    lead: number
  ): Map<HTMLElement, number> {
    const { enter } = travelOffsets(direction);
    const tempo = scene.dataset.rcTempo === "assemble" ? "assemble" : "story";
    const duration = tempo === "assemble" ? RECAP_TIMING.assembleDuration : RECAP_TIMING.enterDuration;
    const delays = new Map<HTMLElement, number>();
    const parts = orderedParts(scene);
    parts.forEach((part, index) => {
      const order = Number(part.dataset.rcOrder);
      const slot = Number.isFinite(order) && part.dataset.rcOrder !== undefined ? order : index;
      const delay = enterDelay(slot, tempo, lead);
      delays.set(part, delay);
      if (flipping.has(part)) return;
      this.#track(...enterPart(part, part.dataset.rcPart ?? "rise", enter, delay, duration, tempo));
    });
    return delays;
  }

  #flip(flip: PendingFlip): void {
    const delta = localDelta(flipDelta(flip.first, flip.last), flip.element);
    if (isNoopFlip(delta)) return;
    flip.element.style.transformOrigin = "0 0";
    this.#track(flip.element.animate(
      [{ transform: flipTransform(delta) }, { transform: "none" }],
      { duration: RECAP_TIMING.flipDuration, easing: RC_SPRING }
    ));
  }

  /** 接力：新封面框從舊封面的位置彈到定位，舊封面的圖蓋在框裡淡出。 */
  #passBaton(baton: PendingBaton): void {
    const element = baton.element;
    const delta = localDelta(flipDelta(baton.first, baton.last), element);
    if (!isNoopFlip(delta)) {
      element.style.transformOrigin = "0 0";
      this.#track(element.animate(
        [{ transform: flipTransform(delta) }, { transform: "none" }],
        { duration: RECAP_TIMING.flipDuration, easing: RC_SPRING }
      ));
    }
    const ghost = baton.art.cloneNode(true) as HTMLElement;
    ghost.classList.add("ani-rc-baton-ghost");
    ghost.setAttribute("aria-hidden", "true");
    element.append(ghost);
    const fade = ghost.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: RECAP_TIMING.batonFade,
      delay: 60,
      easing: "cubic-bezier(.4, 0, .2, 1)",
      fill: "both"
    });
    this.#track(fade);
    const remove = (): void => ghost.remove();
    fade.addEventListener("finish", remove, { once: true });
    fade.addEventListener("cancel", remove, { once: true });
  }

  #startCounts(
    nodes: readonly HTMLElement[],
    widths: readonly number[],
    partDelays: ReadonlyMap<HTMLElement, number>,
    previous: ReadonlyMap<string, number>,
    duration: number
  ): void {
    nodes.forEach((node, index) => {
      const to = Number(node.dataset.countTo);
      if (!Number.isFinite(to) || to <= 0) return;
      const key = node.dataset.countKey;
      const from = key !== undefined ? previous.get(key) ?? 0 : 0;
      if (from === to) return;
      const format = countUpFormatter(node.dataset.countFormat);
      const part = node.closest<HTMLElement>("[data-rc-part]");
      const delay = (part ? partDelays.get(part) ?? 0 : 0) + RECAP_TIMING.countLead;
      // 鎖住整個數量（數字＋單位）的最終寬度：單位緊貼著數字，旁邊的磚與文字不會被推動，
      // 數字從標籤那條邊往右長。跳完就解鎖，之後視窗縮放也不會被舊寬度卡住。
      const lock = node.parentElement ?? node;
      lock.style.minInlineSize = `${Math.ceil((widths[index] ?? 0) / cssZoom(lock))}px`;
      const text = format(from);
      node.textContent = text;
      // 用空 keyframes 的 Animation 當計時器：跟其他動畫共用時間軸，可暫停、可 seek、可取消。
      const timer = node.animate([], {
        duration,
        delay,
        easing: "cubic-bezier(.22, 1, .36, 1)",
        fill: "both"
      });
      this.#track(timer);
      // 「9 小時 12 分」的分鐘不跟著跳：跳動中先藏起來，主數字到位才補上，不會出現「0 小時 12 分」。
      for (const minor of node.parentElement?.querySelectorAll<HTMLElement>(":scope > [data-count-minor]") ?? []) {
        this.#track(minor.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 220,
          delay: delay + duration * 0.85,
          easing: "ease-out",
          fill: "backwards"
        }));
      }
      this.#countJobs.push({ node, lock, from, to, format, timer, last: text });
    });
    if (this.#countJobs.length > 0 && this.#countFrame === 0) {
      this.#countFrame = requestAnimationFrame(this.#tickCounts);
    }
  }

  readonly #tickCounts = (): void => {
    this.#countFrame = 0;
    const pending: CountJob[] = [];
    for (const job of this.#countJobs) {
      const state = job.timer.playState;
      if (state === "idle") continue;
      const progress = state === "finished" ? 1 : job.timer.effect?.getComputedTiming().progress ?? 0;
      const text = job.format(job.from + (job.to - job.from) * (progress ?? 0));
      if (text !== job.last) {
        job.node.textContent = text;
        job.last = text;
      }
      if (state !== "finished") pending.push(job);
      else job.lock.style.removeProperty("min-inline-size");
    }
    this.#countJobs = pending;
    if (pending.length > 0) this.#countFrame = requestAnimationFrame(this.#tickCounts);
  };

  #stopCounts(): void {
    if (this.#countFrame !== 0) cancelAnimationFrame(this.#countFrame);
    this.#countFrame = 0;
    this.#countJobs = [];
  }

  #track(...animations: readonly Animation[]): void {
    for (const animation of animations) {
      this.#live.add(animation);
      animation.addEventListener("finish", () => this.#live.delete(animation), { once: true });
      animation.addEventListener("cancel", () => this.#live.delete(animation), { once: true });
    }
  }
}

type PendingFlip = {
  readonly key: string;
  readonly element: HTMLElement;
  readonly first: DOMRect;
  readonly last: DOMRect;
};

type BatonSource = {
  readonly element: HTMLElement;
  readonly rect: DOMRect;
};

type PendingBaton = {
  readonly source: HTMLElement;
  readonly element: HTMLElement;
  /** 舊封面框裡的那張圖（含失敗時的字元 fallback），複製一份當淡出的殘影。 */
  readonly art: HTMLElement;
  readonly first: DOMRect;
  readonly last: DOMRect;
};

const enterPart = (
  part: HTMLElement,
  kind: string,
  offset: number,
  delay: number,
  duration: number,
  tempo: "story" | "assemble"
): Animation[] => {
  const timing = (extraDelay = 0, ownDuration = duration, easing = RC_EASE_OUT): KeyframeAnimationOptions => ({
    duration: ownDuration,
    delay: delay + extraDelay,
    easing,
    fill: "backwards"
  });
  const animations: Animation[] = [];
  switch (kind) {
    case "title": {
      // CJK 斷行在版面完成前無法預知，所以整塊標題一起擦出，強調字再各自彈一下。
      animations.push(part.animate([
        { opacity: 0, translate: `0 ${Math.round(offset * 0.8)}px`, clipPath: "inset(-18% -4% 100% -4%)", offset: 0 },
        { opacity: 1, offset: 0.28 },
        { opacity: 1, translate: "0 0", clipPath: "inset(-18% -4% -18% -4%)", offset: 1 }
      ], timing(0, duration + 80)));
      // 強調字只做尺寸上的彈跳、不從透明開始，擦出時句子不會出現空洞。
      part.querySelectorAll<HTMLElement>(".ani-recap-title-em").forEach((em, index) => {
        animations.push(em.animate(
          [{ scale: 0.9 }, { scale: 1.035, offset: 0.55 }, { scale: 1 }],
          timing(120 + index * 70, 620, RC_EASE_OUT)
        ));
      });
      break;
    }
    case "cover":
      animations.push(part.animate(
        [{ opacity: 0, scale: 0.92, translate: `0 ${offset}px` }, { opacity: 1, scale: 1, translate: "0 0" }],
        timing(0, duration + 120, RC_SPRING)
      ));
      break;
    case "fly": {
      // 結尾拼貼：封面先疊在拼貼中央，再像攤開一手牌那樣散到各自的位置；
      // 全程留在拼貼範圍內，不會掃過下方的大數字，也不會被磚的邊緣裁掉。
      const collage = part.parentElement;
      const toCenter = collage ? (collage.clientWidth - part.offsetWidth) / 2 - part.offsetLeft : 0;
      animations.push(part.animate(
        [
          { opacity: 0, translate: `${Math.round(toCenter)}px 14px`, scale: 0.86 },
          { opacity: 1, offset: 0.3 },
          { opacity: 1, translate: "0 0", scale: 1 }
        ],
        timing(0, 820, RC_SPRING)
      ));
      break;
    }
    case "surface":
      animations.push(part.animate(
        [{ opacity: 0, scale: 0.965 }, { opacity: 1, scale: 1 }],
        timing(0, duration + 60)
      ));
      break;
    case "fade":
      animations.push(part.animate([{ opacity: 0 }, { opacity: 1 }], timing()));
      break;
    default:
      animations.push(part.animate(
        [{ opacity: 0, translate: `0 ${offset}px` }, { opacity: 1, translate: "0 0" }],
        timing()
      ));
  }
  // 量表與長條：零件出現後才長出來。
  part.querySelectorAll<HTMLElement>("[data-rc-meter]").forEach((fill, index) => {
    animations.push(fill.animate([{ scale: "0 1" }, { scale: "1 1" }], timing(220 + index * 60, 760)));
  });
  part.querySelectorAll<HTMLElement>("[data-rc-bar]").forEach((bar, index) => {
    const barDelay = tempo === "assemble"
      ? RECAP_TIMING.assembleBarDelay + Math.min(index, 24) * RECAP_TIMING.assembleBarStagger
      : 160 + Math.min(index, 30) * 12;
    animations.push(bar.animate([{ scale: "1 0" }, { scale: "1 1" }], timing(barDelay, tempo === "assemble" ? 440 : 560)));
  });
  return animations;
};

const markLeaving = (scene: HTMLElement): void => {
  scene.dataset.rcLeaving = "true";
  scene.inert = true;
  scene.setAttribute("aria-hidden", "true");
  // 焦點契約：畫面上只留一個 data-recap-focus，永遠指向目前的 scene。
  for (const node of scene.querySelectorAll<HTMLElement>("[data-recap-focus]")) delete node.dataset.recapFocus;
};

const removeAfter = (scene: HTMLElement, animations: readonly Animation[]): void => {
  void Promise.all(animations.map((animation) => animation.finished)).then(
    () => scene.remove(),
    () => {
      // 被下一次 swap 中斷：殘留 scene 由 #interrupt 移除。
    }
  );
};

/** 零件不巢狀：被包在另一個零件裡的節點跟著外層一起動，不另外編排。 */
const topLevelParts = (scene: HTMLElement): HTMLElement[] =>
  [...scene.querySelectorAll<HTMLElement>("[data-rc-part]")]
    .filter((part) => (part.parentElement?.closest("[data-rc-part]") ?? null) === null);

const orderedParts = (scene: HTMLElement): HTMLElement[] => topLevelParts(scene);

const readSharedRects = (scene: HTMLElement): Map<string, DOMRect> => {
  const rects = new Map<string, DOMRect>();
  for (const node of scene.querySelectorAll<HTMLElement>("[data-rc-shared]")) {
    const key = node.dataset.rcShared;
    if (!key || rects.has(key)) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) rects.set(key, rect);
  }
  return rects;
};

const readBaton = (scene: HTMLElement): BatonSource | null => {
  const element = scene.querySelector<HTMLElement>("[data-rc-baton]");
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? { element, rect } : null;
};

/** 兩章都有主角封面、但沒有任何共享元素接上它時，才用接力棒。 */
const collectBaton = (
  scene: HTMLElement,
  source: BatonSource | null,
  flips: readonly PendingFlip[]
): PendingBaton | null => {
  if (!source) return null;
  const element = scene.querySelector<HTMLElement>("[data-rc-baton]");
  const art = source.element.firstElementChild;
  if (!element || !(art instanceof HTMLElement)) return null;
  if (flips.some((flip) => flip.element === element)) return null;
  const sourceKey = source.element.dataset.rcShared;
  if (sourceKey && flips.some((flip) => flip.key === sourceKey)) return null;
  if (!element.hasAttribute("data-rc-part") || (element.parentElement?.closest("[data-rc-part]") ?? null) !== null) return null;
  const last = element.getBoundingClientRect();
  if (last.width <= 0 || last.height <= 0) return null;
  return { source: source.element, element, art, first: source.rect, last };
};

const readCountTargets = (scene: HTMLElement): Map<string, number> => {
  const values = new Map<string, number>();
  for (const node of scene.querySelectorAll<HTMLElement>("[data-count-key][data-count-to]")) {
    const value = Number(node.dataset.countTo);
    if (node.dataset.countKey && Number.isFinite(value)) values.set(node.dataset.countKey, value);
  }
  return values;
};

const collectFlips = (scene: HTMLElement, first: ReadonlyMap<string, DOMRect>): PendingFlip[] => {
  if (first.size === 0) return [];
  const flips: PendingFlip[] = [];
  const used = new Set<string>();
  for (const element of scene.querySelectorAll<HTMLElement>("[data-rc-shared]")) {
    const key = element.dataset.rcShared;
    // 共享元素必須是頂層零件，否則外層零件的淡入會把飛行中的它一起藏起來。
    if (!key || used.has(key) || !element.hasAttribute("data-rc-part")) continue;
    if ((element.parentElement?.closest("[data-rc-part]") ?? null) !== null) continue;
    const from = first.get(key);
    if (!from) continue;
    const last = element.getBoundingClientRect();
    if (last.width <= 0 || last.height <= 0) continue;
    used.add(key);
    flips.push({ key, element, first: from, last });
  }
  return flips;
};

const cssEscape = (value: string): string => typeof CSS !== "undefined" && typeof CSS.escape === "function"
  ? CSS.escape(value)
  : value.replace(/["\\]/g, "\\$&");

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
