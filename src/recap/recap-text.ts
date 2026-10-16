import { element, textElement } from "../view-dom";

/**
 * 中文標題斷行：CSS 的 keep-all 讓漢字之間不再隨意斷開，再只在「詞與詞之間」插 <wbr>。
 * 詞界取自 Intl.Segmenter，但它對專有名詞常切太碎，所以只在兩側都是兩字以上的詞、
 * 標點之後，或「的／了」這類虛詞之後才允許換行；標點的避頭尾規則一律保留。
 */

/** 不可出現在行首的標點（收尾括號、逗句號等）。 */
const NO_BREAK_BEFORE = /^[，、。．：；！？）》」』】〉…％%·・]/u;
/** 不可出現在行尾的標點（開頭括號）。 */
const NO_BREAK_AFTER = /[（《「『【〈]$/u;
/** 句讀之後可以換行。 */
const BREAK_AFTER = /[，、。：；！？]$/u;
/** 單字虛詞：之後接兩字以上的詞時可以換行（「上架的／動畫」）。 */
const PARTICLES = new Set(["的", "了", "和", "與", "及", "或", "在"]);

/**
 * 斷詞器常切錯、但作品名裡很常見的詞（「會談｜戀愛」）：這些詞的內部一律不換行。
 * 只收會被切錯的詞，不是完整字典。
 */
const KEEP_TOGETHER = ["談戀愛", "異世界"] as const;

type Segment = { readonly text: string; readonly wordLike: boolean };

let segmenter: Intl.Segmenter | null | undefined;

const segmentWords = (text: string): Segment[] => {
  if (segmenter === undefined) {
    segmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter("zh-Hant", { granularity: "word" })
      : null;
  }
  if (!segmenter) return [...text].map((char) => ({ text: char, wordLike: /[\p{L}\p{N}]/u.test(char) }));
  return [...segmenter.segment(text)].map((part) => ({ text: part.segment, wordLike: part.isWordLike === true }));
};

const charCount = (text: string): number => [...text].length;

const breakAllowed = (previous: Segment, next: Segment): boolean => {
  if (/^\s/u.test(next.text) || /\s$/u.test(previous.text)) return false; // 空白本身就是換行點
  if (NO_BREAK_BEFORE.test(next.text) || NO_BREAK_AFTER.test(previous.text)) return false;
  if (BREAK_AFTER.test(previous.text)) return true;
  if (/^[（《「『【〈]/u.test(next.text)) return true;
  if (!previous.wordLike || !next.wordLike) return false;
  if (charCount(next.text) < 2) return false;
  return charCount(previous.text) >= 2 || PARTICLES.has(previous.text);
};

/**
 * 把一段文字切成「片語」：片語內不換行，片語之間才可以。空白保留在片語裡，
 * 由瀏覽器照常當作換行點。
 */
export const storyPhrases = (text: string): string[] => {
  const segments = segmentWords(text);
  const guarded = guardedOffsets(text);
  const phrases: string[] = [];
  let current = "";
  let previous: Segment | undefined;
  let offset = 0;
  for (const segment of segments) {
    if (previous && current && !guarded.has(offset) && breakAllowed(previous, segment)) {
      phrases.push(current);
      current = "";
    }
    current += segment.text;
    offset += segment.text.length;
    previous = segment;
  }
  if (current) phrases.push(current);
  return phrases;
};

/** KEEP_TOGETHER 詞內部的字元位置（UTF-16 offset）：這些位置不可換行。 */
const guardedOffsets = (text: string): Set<number> => {
  const offsets = new Set<number>();
  for (const word of KEEP_TOGETHER) {
    for (let index = text.indexOf(word); index !== -1; index = text.indexOf(word, index + 1)) {
      for (let inside = index + 1; inside < index + word.length; inside += 1) offsets.add(inside);
    }
  }
  return offsets;
};

/** 依片語插入 <wbr>；搭配 CSS 的 word-break: keep-all 使用。 */
export const appendPhrased = (node: HTMLElement, text: string): void => {
  storyPhrases(text).forEach((phrase, index) => {
    if (index > 0) node.append(element("wbr"));
    node.append(phrase);
  });
};

/**
 * 同 appendPhrased，但頭兩個字與尾兩個字各包進 nowrap：片語太長、瀏覽器只好在片語內
 * 硬斷時，也不會只剩一個字或一個括號孤零零地掛在行首行尾。
 */
const appendGuarded = (node: HTMLElement, text: string): void => {
  const phrases = storyPhrases(text);
  phrases.forEach((phrase, index) => {
    if (index > 0) node.append(element("wbr"));
    const chars = [...phrase];
    const guardHead = index === 0 && chars.length > 3;
    const guardTail = index === phrases.length - 1 && chars.length > 3;
    if (!guardHead && !guardTail) {
      node.append(phrases.length === 1 ? textElement("span", "ani-rc-nowrap", phrase) : phrase);
      return;
    }
    const head = guardHead ? chars.slice(0, 2).join("") : "";
    const tail = guardTail ? chars.slice(-2).join("") : "";
    const middle = chars.slice(head ? 2 : 0, tail ? -2 : undefined).join("");
    if (head) node.append(textElement("span", "ani-rc-nowrap", head));
    if (middle) node.append(middle);
    if (tail) node.append(textElement("span", "ani-rc-nowrap", tail));
  });
};

/** 作品標題等純文字欄位：同樣只在詞界換行，頭尾不留單字孤行。 */
export const phrasedText = <K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text: string
): HTMLElementTagNameMap[K] => {
  const node = element(tagName, className);
  node.dataset.rcPhrased = "true";
  appendGuarded(node, text);
  return node;
};

export type StoryToken =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "em"; readonly text: string; readonly numeral: boolean };

/** 標題裡被引用的作品（《…》「…」）與數字是重點，其餘是一般文字。 */
export const tokenizeStoryTitle = (title: string): StoryToken[] => {
  // 日期整串、「69 小時 43 分鐘」這類時長、時間區間（23:00–05:00）與帶千分位的數字，
  // 都視為一個不可拆的數字。
  const pattern = /(\d{4} 年 \d{1,2} 月 \d{1,2} 日|\d[\d,]* 小時 \d{1,2} 分鐘?|《[^《》]*》|「[^「」]*」|[0-9][0-9,.:]*(?:[–-][0-9][0-9,.:]*)?)/g;
  const tokens: StoryToken[] = [];
  let cursor = 0;
  for (const match of title.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ kind: "text", text: title.slice(cursor, index) });
    tokens.push({ kind: "em", text: match[0], numeral: /^[0-9]/.test(match[0]) });
    cursor = index + match[0].length;
  }
  if (cursor < title.length) tokens.push({ kind: "text", text: title.slice(cursor) });
  return tokens;
};

/**
 * 把標題寫進 heading：一般文字依片語插 <wbr>；數字與後面的量詞片語（「55 部作品」）
 * 黏成一組；引用的作品名內部也依片語斷行，但括號永遠黏著相鄰的字。
 * emphasize 為 false 時（敘述段落）規則相同，只是不加強調色。
 */
export const appendStoryTitle = (heading: HTMLElement, title: string, emphasize = true): void => {
  const tokens = tokenizeStoryTitle(title);
  let pending: string | null = null;
  tokens.forEach((token, index) => {
    if (token.kind === "text") {
      const text = pending ?? token.text;
      pending = null;
      if (text) appendPhrased(heading, text);
      return;
    }
    const em = emphasize ? element("em", "ani-recap-title-em") : element("span", "ani-rc-token");
    if (!token.numeral) {
      appendGuarded(em, token.text);
      heading.append(em);
      return;
    }
    em.textContent = token.text;
    // 敘述裡的日期與時長內含空白：整串不換行（標題的強調字本身是 inline-block）。
    if (!emphasize) em.classList.add("ani-rc-nowrap");
    const following = tokens[index + 1];
    const match = following?.kind === "text" ? following.text.match(/^(\s?)(\S.*)?$/su) : null;
    const rest = match?.[2] ?? "";
    const firstPhrase = rest ? storyPhrases(rest)[0] ?? "" : "";
    if (!following || following.kind !== "text" || !firstPhrase || NO_BREAK_AFTER.test(firstPhrase) || /^[《「]/u.test(firstPhrase)) {
      heading.append(em);
      return;
    }
    // 片語太長時只黏量詞本身，不把整串拖進同一行。
    const wholePhrase = charCount(firstPhrase.trimEnd()) <= 4;
    const glue = wholePhrase ? firstPhrase.trimEnd() : [...rest][0] ?? "";
    const glued = element("span", "ani-rc-nowrap");
    glued.append(em, `${match?.[1] ?? ""}${glue}`);
    heading.append(glued);
    const remainder = rest.slice(glue.length);
    if (remainder && wholePhrase && !/^\s/u.test(remainder)) heading.append(element("wbr"));
    pending = remainder;
  });
};

/** 標題最多幾行；再多就逐級縮小字級（見 CSS 的 data-fit）。 */
export const HEADLINE_MAX_LINES = 3;
const HEADLINE_FIT_STEPS = ["1", "2"] as const;

/**
 * 依實際行數幫標題挑字級：超過三行就往下一級縮，最多兩級。
 * 必須在 scene 掛上版面之後、量共享元素位置之前呼叫。
 */
export const fitHeadlines = (scene: HTMLElement): void => {
  for (const heading of scene.querySelectorAll<HTMLElement>("[data-rc-fit]")) {
    delete heading.dataset.fit;
    delete heading.dataset.wrap;
    // Chrome 的 text-wrap: balance 遇到不可斷的片語（「2025 夏季」）時，可能為了平衡把一行
    // 撐出欄寬、壓到旁邊的圖表；這時退回一般換行。
    if (heading.scrollWidth > heading.clientWidth + 1) heading.dataset.wrap = "plain";
    for (const step of HEADLINE_FIT_STEPS) {
      if (headlineLines(heading) <= HEADLINE_MAX_LINES) break;
      heading.dataset.fit = step;
      if (heading.dataset.wrap !== "plain" && heading.scrollWidth > heading.clientWidth + 1) heading.dataset.wrap = "plain";
    }
  }
};

const headlineLines = (heading: HTMLElement): number => {
  const lineHeight = Number.parseFloat(getComputedStyle(heading).lineHeight);
  const height = heading.getBoundingClientRect().height;
  if (!(lineHeight > 0) || !(height > 0)) return 0;
  return Math.round(height / lineHeight);
};
