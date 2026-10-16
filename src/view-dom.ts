export const element = <K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  return node;
};

export const textElement = <K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text: string
): HTMLElementTagNameMap[K] => {
  const node = element(tagName, className);
  node.textContent = text;
  return node;
};

export const createButton = (className: string, label: string): HTMLButtonElement => {
  const button = element("button", className);
  button.type = "button";
  button.textContent = label;
  return button;
};

export type CoverOptions = {
  /** 立即載入：回顧會預先解碼下一章的封面，lazy 反而會在換場時留下空白格。 */
  readonly eager?: boolean;
  /** 沒有封面時的代表字跳過開頭的括號與標點（【我推的孩子】顯示「我」而不是「【」）。 */
  readonly readableGlyph?: boolean;
};

const LEADING_PUNCTUATION = /^[\s\p{P}\p{S}]+/u;

/** 封面載入失敗時代表作品的那一個字。 */
export const coverFallbackGlyph = (alt: string, readable = false): string | undefined => {
  const trimmed = alt.trim();
  const source = readable ? trimmed.replace(LEADING_PUNCTUATION, "") || trimmed : trimmed;
  return [...source][0];
};

export const createCover = (
  url: string | null,
  alt: string,
  className: string,
  options: CoverOptions = {}
): HTMLElement => {
  const frame = element("div", className);
  const markEmpty = (): void => {
    frame.dataset.empty = "true";
    frame.setAttribute("aria-hidden", "true");
    const glyph = coverFallbackGlyph(alt, options.readableGlyph);
    frame.replaceChildren(...(glyph ? [textElement("span", "ani-cover-fallback", glyph)] : []));
  };
  if (url === null) {
    markEmpty();
    return frame;
  }
  const image = element("img");
  image.src = url;
  image.alt = alt;
  image.loading = options.eager ? "eager" : "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", markEmpty, { once: true });
  frame.append(image);
  return frame;
};

export const replaceChildren = (
  node: Element,
  children: readonly (Node | null | undefined | false)[]
): void => {
  node.replaceChildren(...children.filter((child): child is Node => child instanceof Node));
};
