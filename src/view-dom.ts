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

export const createCover = (
  url: string | null,
  alt: string,
  className: string
): HTMLElement => {
  const frame = element("div", className);
  if (url === null) {
    frame.dataset.empty = "true";
    frame.setAttribute("aria-hidden", "true");
    return frame;
  }
  const image = element("img");
  image.src = url;
  image.alt = alt;
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  frame.append(image);
  return frame;
};

export const replaceChildren = (
  node: Element,
  children: readonly (Node | null | undefined | false)[]
): void => {
  node.replaceChildren(...children.filter((child): child is Node => child instanceof Node));
};
