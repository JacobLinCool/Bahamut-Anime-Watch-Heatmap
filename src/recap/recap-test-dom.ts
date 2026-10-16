/**
 * 測試用的極簡 DOM：只實作回顧畫面建構會用到的部分，足以檢查結構、節點是否被重建，
 * 以及「報讀得到的文字」。測試執行在 node 環境，沒有真的 document。
 */
export class FakeNode {
  readonly tagName: string;
  readonly childNodes: (FakeNode | string)[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> & { setProperty: (name: string, value: string) => void } = Object.assign(
    Object.create(null) as Record<string, string>,
    { setProperty(this: Record<string, string>, name: string, value: string) { this[name] = value; } }
  );
  parentNode: FakeNode | null = null;
  className = "";
  id = "";
  hidden = false;
  tabIndex = 0;
  type = "";
  title = "";
  src = "";
  alt = "";
  loading = "";
  decoding = "";
  referrerPolicy = "";
  disabled = false;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get classList(): Pick<DOMTokenList, "add" | "contains"> {
    const names = (): string[] => this.className.split(/\s+/).filter(Boolean);
    return {
      add: (...tokens: string[]) => {
        this.className = [...new Set([...names(), ...tokens])].join(" ");
      },
      contains: (token: string) => names().includes(token)
    };
  }

  get children(): FakeNode[] {
    return this.childNodes.filter((child): child is FakeNode => typeof child !== "string");
  }

  get childElementCount(): number {
    return this.children.length;
  }

  get textContent(): string {
    return this.childNodes.map((child) => typeof child === "string" ? child : child.textContent).join("");
  }

  set textContent(value: string) {
    this.#detachChildren();
    this.childNodes.splice(0, this.childNodes.length, value);
  }

  append(...nodes: (FakeNode | string)[]): void {
    for (const node of nodes) this.#adopt(node);
    this.childNodes.push(...nodes);
  }

  replaceChildren(...nodes: (FakeNode | string)[]): void {
    this.#detachChildren();
    for (const node of nodes) this.#adopt(node);
    this.childNodes.splice(0, this.childNodes.length, ...nodes);
  }

  replaceWith(node: FakeNode): void {
    const parent = this.parentNode;
    if (!parent) return;
    node.parentNode?.removeChild(node);
    parent.childNodes.splice(parent.childNodes.indexOf(this), 1, node);
    node.parentNode = parent;
    this.parentNode = null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  addEventListener(): void {}

  removeChild(node: FakeNode): void {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
  }

  #adopt(node: FakeNode | string): void {
    if (typeof node === "string") return;
    node.parentNode?.removeChild(node);
    node.parentNode = this;
  }

  #detachChildren(): void {
    for (const child of this.children) child.parentNode = null;
  }
}

/** 換上假的 document；回傳還原函式。 */
export const installFakeDocument = (): (() => void) => {
  const original = globalThis.document;
  Object.assign(globalThis, { document: { createElement: (tagName: string) => new FakeNode(tagName) } });
  return () => {
    Object.assign(globalThis, { document: original });
  };
};

export const findAll = (root: FakeNode, predicate: (node: FakeNode) => boolean): FakeNode[] => {
  const found: FakeNode[] = [];
  const walk = (node: FakeNode): void => {
    if (predicate(node)) found.push(node);
    node.children.forEach(walk);
  };
  walk(root);
  return found;
};

export const hasClass = (node: FakeNode, name: string): boolean => node.className.split(/\s+/).includes(name);

/** 螢幕報讀器實際讀得到的內容：略過 aria-hidden，也略過導覽按鈕本身。 */
export const spokenText = (node: FakeNode): string => {
  if (node.getAttribute("aria-hidden") === "true" || node.tagName === "BUTTON") return "";
  return node.childNodes.map((child) => typeof child === "string" ? child : spokenText(child)).join("");
};
