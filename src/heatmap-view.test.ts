import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "vitest";
import {
  ANALYSIS_TRIGGER_ID,
  HEATMAP_ROOT_ID,
  HeatmapView,
  heatmapCss
} from "./heatmap-view";

type Listener = (event: Record<string, unknown>) => void;

class FakeStyle {
  readonly #values = new Map<string, { value: string; priority: string }>();
  gridColumn = "";
  left = "";
  top = "";

  setProperty(property: string, value: string, priority = ""): void {
    this.#values.set(property, { value, priority });
  }

  getPropertyValue(property: string): string {
    return this.#values.get(property)?.value ?? "";
  }

  getPropertyPriority(property: string): string {
    return this.#values.get(property)?.priority ?? "";
  }

  clear(): void {
    this.#values.clear();
    this.gridColumn = "";
    this.left = "";
    this.top = "";
  }
}

class FakeNode {
  readonly childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  textContent = "";

  append(...nodes: FakeNode[]): void {
    for (const node of nodes) {
      node.remove();
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }

  replaceChildren(...nodes: FakeNode[]): void {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes.splice(0);
    this.append(...nodes);
  }

  remove(): void {
    const parent = this.parentNode;
    if (!parent) return;
    const index = parent.childNodes.indexOf(this);
    if (index >= 0) parent.childNodes.splice(index, 1);
    this.parentNode = null;
  }

  get isConnected(): boolean {
    let cursor: FakeNode | null = this;
    while (cursor) {
      if (cursor === fakeDocument.body) return true;
      if (cursor instanceof FakeShadowRoot) cursor = cursor.host;
      else cursor = cursor.parentNode;
    }
    return false;
  }
}

class FakeShadowRoot extends FakeNode {
  readonly host: FakeElement;
  readonly mode = "open";
  activeElement: FakeElement | null = null;

  constructor(host: FakeElement) {
    super();
    this.host = host;
  }

  querySelector(selector: string): FakeElement | null {
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      return findElement(this, (element) => element.classList.contains(className));
    }
    const dataMatch = selector.match(/^\[data-(mode-value|date)="([^"]+)"\]$/);
    if (!dataMatch) return null;
    const [, name, value] = dataMatch;
    const key = name === "mode-value" ? "modeValue" : "date";
    return findElement(this, (element) => element.dataset[key] === value);
  }
}

class FakeElement extends FakeNode {
  readonly tagName: string;
  readonly style = new FakeStyle();
  readonly dataset: Record<string, string> = {};
  readonly #attributes = new Map<string, string>();
  readonly #listeners = new Map<string, Listener[]>();
  className = "";
  id = "";
  tabIndex = 0;
  type = "";
  disabled = false;
  shadowRoot: FakeShadowRoot | null = null;

  get classList(): { contains: (className: string) => boolean } {
    return {
      contains: (className: string) => this.className.split(/\s+/).includes(className)
    };
  }

  constructor(tagName: string) {
    super();
    this.tagName = tagName.toUpperCase();
  }

  attachShadow(): FakeShadowRoot {
    if (this.shadowRoot) throw new Error("shadow root already attached");
    this.shadowRoot = new FakeShadowRoot(this);
    return this.shadowRoot;
  }

  setAttribute(name: string, value: string): void {
    this.#attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.#attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.#attributes.delete(name);
    if (name === "style") this.style.clear();
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.#listeners.get(type) ?? [];
    listeners.push(listener);
    this.#listeners.set(type, listeners);
  }

  dispatch(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener({ target: this, ...event });
    }
  }

  focus(): void {
    fakeDocument.activeElement = this;
    const shadow = findOwningShadowRoot(this);
    if (shadow) shadow.activeElement = this;
    this.dispatch("focus");
  }

  getBoundingClientRect(): DOMRect {
    return {
      x: 0,
      y: 0,
      top: 0,
      right: 12,
      bottom: 12,
      left: 0,
      width: 12,
      height: 12,
      toJSON: () => ({})
    } as DOMRect;
  }
}

class FakeDocument {
  readonly body = new FakeElement("body");
  activeElement: FakeElement | null = null;

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }

  getElementById(id: string): FakeElement | null {
    return findElement(this.body, (element) => element.id === id, false);
  }
}

const originalGlobals = {
  document: globalThis.document,
  window: globalThis.window,
  HTMLElement: globalThis.HTMLElement,
  HTMLButtonElement: globalThis.HTMLButtonElement,
  ShadowRoot: globalThis.ShadowRoot
};

let fakeDocument: FakeDocument;
let nextTimerId: number;
let timers: Map<number, () => void>;

beforeEach(() => {
  fakeDocument = new FakeDocument();
  nextTimerId = 1;
  timers = new Map();
  const fakeWindow = {
    innerWidth: 1280,
    innerHeight: 800,
    setTimeout: (callback: () => void): number => {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id: number | undefined): void => {
      if (id !== undefined) timers.delete(id);
    }
  };
  Object.assign(globalThis, {
    document: fakeDocument,
    window: fakeWindow,
    HTMLElement: FakeElement,
    HTMLButtonElement: FakeElement,
    ShadowRoot: FakeShadowRoot
  });
});

afterEach(() => {
  Object.assign(globalThis, originalGlobals);
});

test("HeatmapView owns one open shadow root and keeps all visual classes out of light DOM", () => {
  const root = new FakeElement("section");
  root.id = HEATMAP_ROOT_ID;
  fakeDocument.body.append(root);
  const view = new HeatmapView(root as unknown as HTMLElement, {
    onBoundaryModeChange: () => undefined,
    onOpenAnalysis: () => undefined
  });
  view.render([], "calendar");

  assert.equal(view.root, root as unknown as HTMLElement);
  assert.ok(root.shadowRoot);
  assert.equal(root.shadowRoot?.mode, "open");
  assert.equal(root.childNodes.length, 1);
  const bridge = root.childNodes[0];
  assert.ok(bridge instanceof FakeElement);
  assert.equal(bridge.className, "");
  assert.equal(bridge.id, ANALYSIS_TRIGGER_ID);
  assert.equal(bridge.getAttribute("slot"), "ani-gamer-watch-focus-bridge");
  assert.deepEqual(collectClassNames(root, false), []);

  const style = findElement(root.shadowRoot, (element) => element.tagName === "STYLE");
  const focusSlot = findElement(root.shadowRoot, (element) => element.tagName === "SLOT");
  assert.ok(style);
  assert.ok(focusSlot);
  assert.equal(focusSlot.getAttribute("name"), "ani-gamer-watch-focus-bridge");
  assert.equal(style.textContent, heatmapCss);
  assert.match(style.textContent, /:host\s*\{/);
  assert.match(style.textContent, /\.ani-heatmap-card/);
  assert.ok(findElement(root.shadowRoot, (element) => element.className === "ani-heatmap-card"));
  assert.equal(findElement(fakeDocument.body, (element) => element.className === "ani-heatmap-card", false), null);
  assert.equal(root.style.getPropertyPriority("all"), "important");
  assert.equal(root.style.getPropertyValue("transform"), "none");
});

test("analysis, boundary controls, focus restoration, and tooltip remain functional inside shadow DOM", () => {
  const root = new FakeElement("section");
  root.id = HEATMAP_ROOT_ID;
  fakeDocument.body.append(root);
  let analysisOpens = 0;
  const boundaryModes: string[] = [];
  const view = new HeatmapView(root as unknown as HTMLElement, {
    onBoundaryModeChange: (mode) => boundaryModes.push(mode),
    onOpenAnalysis: () => { analysisOpens += 1; }
  });
  view.render([], "calendar");

  const analysisButton = findElement(
    root.shadowRoot,
    (element) => element.className === "ani-heatmap-analysis-button"
  );
  assert.ok(analysisButton);
  analysisButton.dispatch("click");
  assert.equal(analysisOpens, 1);

  const switchButtons = findElements(
    root.shadowRoot,
    (element) => element.className === "ani-heatmap-switch-button"
  );
  assert.equal(switchButtons.length, 2);
  switchButtons[1]?.dispatch("click");
  assert.deepEqual(boundaryModes, ["thirty-hour"]);

  const bridge = fakeDocument.getElementById(ANALYSIS_TRIGGER_ID);
  assert.ok(bridge);
  bridge.focus();
  assert.equal(root.shadowRoot?.activeElement, analysisButton);

  const day = findElement(
    root.shadowRoot,
    (element) => element.className === "ani-heatmap-day" && element.dataset.outOfRange !== "true"
  );
  assert.ok(day);
  day.dispatch("focus");
  const tooltip = findElement(
    root.shadowRoot,
    (element) => element.className === "ani-heatmap-tooltip"
  );
  assert.ok(tooltip);
  assert.equal(day.getAttribute("aria-describedby"), tooltip.id);
  assert.equal(findElement(
    fakeDocument.body,
    (element) => element.className === "ani-heatmap-tooltip",
    false
  ), null);
});

test("rerender restores focus to the corresponding day-boundary control", () => {
  const root = new FakeElement("section");
  root.id = HEATMAP_ROOT_ID;
  fakeDocument.body.append(root);
  const view = new HeatmapView(root as unknown as HTMLElement, {
    onBoundaryModeChange: () => undefined,
    onOpenAnalysis: () => undefined
  });
  view.render([], "calendar");

  const before = findElements(
    root.shadowRoot,
    (element) => element.className === "ani-heatmap-switch-button"
  );
  assert.equal(before.length, 2);
  before[0]?.focus();
  assert.equal(root.shadowRoot?.activeElement, before[0]);

  view.render([], "calendar");
  const after = findElements(
    root.shadowRoot,
    (element) => element.className === "ani-heatmap-switch-button"
  );
  assert.equal(after.length, 2);
  assert.notEqual(after[0], before[0]);
  assert.equal(root.shadowRoot?.activeElement, after[0]);
  assert.equal(after[0]?.dataset.modeValue, "calendar");
  assert.equal(after[0]?.textContent, "24H");
});

test("rerender preserves one stylesheet and destroy removes shadow, light DOM, timers, and host styles", () => {
  const root = new FakeElement("section");
  root.id = HEATMAP_ROOT_ID;
  fakeDocument.body.append(root);
  const view = new HeatmapView(root as unknown as HTMLElement, {
    onBoundaryModeChange: () => undefined,
    onOpenAnalysis: () => undefined
  });
  view.render([], "calendar");
  const day = findElement(
    root.shadowRoot,
    (element) => element.className === "ani-heatmap-day" && element.dataset.outOfRange !== "true"
  );
  day?.dispatch("focus");
  day?.dispatch("blur");
  assert.equal(timers.size, 1);

  view.render([], "thirty-hour", { loading: true });
  assert.equal(findElements(root.shadowRoot, (element) => element.tagName === "STYLE").length, 1);
  assert.equal(findElements(root.shadowRoot, (element) => element.className === "ani-heatmap-card").length, 1);
  assert.equal(findElements(root.shadowRoot, (element) => element.className === "ani-heatmap-tooltip").length, 0);
  assert.equal(timers.size, 0);

  view.destroy();
  assert.equal(root.isConnected, false);
  assert.equal(root.childNodes.length, 0);
  assert.equal(root.shadowRoot?.childNodes.length, 0);
  assert.equal(root.style.getPropertyValue("all"), "");
  assert.equal(timers.size, 0);
});

test("arrow keys follow the visual week columns and weekday rows including padded cells", () => {
  const root = new FakeElement("section");
  root.id = HEATMAP_ROOT_ID;
  fakeDocument.body.append(root);
  const view = new HeatmapView(root as unknown as HTMLElement, {
    onBoundaryModeChange: () => undefined,
    onOpenAnalysis: () => undefined
  });
  view.render([], "calendar");

  const grid = findElement(root.shadowRoot, (element) => element.className === "ani-heatmap-grid");
  const days = findElements(
    root.shadowRoot,
    (element) => element.className === "ani-heatmap-day" && element.dataset.outOfRange !== "true"
  );
  assert.ok(grid);
  const byCell = new Map(days.map((day) => [gridCellIndex(day), day]));
  const start = days.find((day) => {
    const cell = gridCellIndex(day);
    const row = cell % 7;
    return row > 0 && row < 6
      && byCell.has(cell - 7)
      && byCell.has(cell + 7)
      && byCell.has(cell - 1)
      && byCell.has(cell + 1);
  });
  assert.ok(start);
  const startCell = gridCellIndex(start);
  const startDate = start.dataset.date;
  assert.ok(startDate);

  dispatchGridKey(grid, start, "ArrowLeft");
  assert.equal(fakeDocument.activeElement, byCell.get(startCell - 7));
  assert.equal((fakeDocument.activeElement as FakeElement).dataset.date, shiftIsoDate(startDate, -7));
  assert.equal(gridCellIndex(fakeDocument.activeElement!), startCell - 7);
  assert.equal(gridCellIndex(fakeDocument.activeElement!) % 7, startCell % 7);

  dispatchGridKey(grid, start, "ArrowRight");
  assert.equal(fakeDocument.activeElement, byCell.get(startCell + 7));
  assert.equal((fakeDocument.activeElement as FakeElement).dataset.date, shiftIsoDate(startDate, 7));
  assert.equal(gridCellIndex(fakeDocument.activeElement!), startCell + 7);
  assert.equal(gridCellIndex(fakeDocument.activeElement!) % 7, startCell % 7);

  dispatchGridKey(grid, start, "ArrowUp");
  assert.equal(fakeDocument.activeElement, byCell.get(startCell - 1));
  assert.equal((fakeDocument.activeElement as FakeElement).dataset.date, shiftIsoDate(startDate, -1));
  assert.equal(Math.floor(gridCellIndex(fakeDocument.activeElement!) / 7), Math.floor(startCell / 7));

  dispatchGridKey(grid, start, "ArrowDown");
  assert.equal(fakeDocument.activeElement, byCell.get(startCell + 1));
  assert.equal((fakeDocument.activeElement as FakeElement).dataset.date, shiftIsoDate(startDate, 1));
  assert.equal(Math.floor(gridCellIndex(fakeDocument.activeElement!) / 7), Math.floor(startCell / 7));
  assert.equal(days.filter((day) => day.tabIndex === 0).length, 1);
});

test("grid navigation never wraps between weekday rows or enters leading and trailing padding", () => {
  const root = new FakeElement("section");
  root.id = HEATMAP_ROOT_ID;
  fakeDocument.body.append(root);
  const view = new HeatmapView(root as unknown as HTMLElement, {
    onBoundaryModeChange: () => undefined,
    onOpenAnalysis: () => undefined
  });
  view.render([], "calendar");

  const grid = findElement(root.shadowRoot, (element) => element.className === "ani-heatmap-grid");
  const days = findElements(
    root.shadowRoot,
    (element) => element.className === "ani-heatmap-day" && element.dataset.outOfRange !== "true"
  );
  assert.ok(grid);
  const first = days[0];
  const last = days.at(-1);
  const top = days.find((day) => gridCellIndex(day) % 7 === 0);
  const bottom = days.find((day) => gridCellIndex(day) % 7 === 6);
  assert.ok(first);
  assert.ok(last);
  assert.ok(top);
  assert.ok(bottom);

  dispatchGridKey(grid, days[10]!, "Home");
  assert.equal(fakeDocument.activeElement, first);
  dispatchGridKey(grid, first, "ArrowLeft");
  assert.equal(first.tabIndex, 0);
  dispatchGridKey(grid, top, "ArrowUp");
  assert.equal(top.tabIndex, 0);
  assert.equal(fakeDocument.activeElement, top);
  dispatchGridKey(grid, bottom, "ArrowDown");
  assert.equal(bottom.tabIndex, 0);
  assert.equal(fakeDocument.activeElement, bottom);
  assert.equal(days.filter((day) => day.tabIndex === 0).length, 1);

  dispatchGridKey(grid, days[10]!, "End");
  assert.equal(fakeDocument.activeElement, last);
  dispatchGridKey(grid, last, "ArrowRight");
  assert.equal(last.tabIndex, 0);
  assert.equal(days.filter((day) => day.tabIndex === 0).length, 1);

  const firstCell = gridCellIndex(first);
  if (firstCell % 7 > 0) {
    dispatchGridKey(grid, first, "ArrowUp");
    assert.equal(fakeDocument.activeElement, first);
  }
  const lastCell = gridCellIndex(last);
  if (lastCell % 7 < 6) {
    dispatchGridKey(grid, last, "ArrowDown");
    assert.equal(fakeDocument.activeElement, last);
  }
});

const dispatchGridKey = (grid: FakeElement, target: FakeElement, key: string): void => {
  target.focus();
  let prevented = false;
  let stopped = false;
  grid.dispatch("keydown", {
    target,
    key,
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; }
  });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
};

const shiftIsoDate = (date: string, days: number): string => {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
};

const gridCellIndex = (element: FakeElement): number => {
  const value = Number(element.dataset.gridCellIndex);
  assert.equal(Number.isSafeInteger(value), true);
  return value;
};

const findOwningShadowRoot = (node: FakeNode): FakeShadowRoot | null => {
  let cursor = node.parentNode;
  while (cursor) {
    if (cursor instanceof FakeShadowRoot) return cursor;
    cursor = cursor.parentNode;
  }
  return null;
};

const findElement = (
  root: FakeNode | null,
  predicate: (element: FakeElement) => boolean,
  includeShadow = true
): FakeElement | null => findElements(root, predicate, includeShadow)[0] ?? null;

const findElements = (
  root: FakeNode | null,
  predicate: (element: FakeElement) => boolean,
  includeShadow = true
): FakeElement[] => {
  if (!root) return [];
  const result: FakeElement[] = [];
  const visit = (node: FakeNode): void => {
    if (node instanceof FakeElement) {
      if (predicate(node)) result.push(node);
      if (includeShadow && node.shadowRoot) visit(node.shadowRoot);
    }
    for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return result;
};

const collectClassNames = (root: FakeNode, includeShadow: boolean): string[] => {
  return findElements(root, (element) => element.className !== "", includeShadow)
    .map((element) => element.className);
};
