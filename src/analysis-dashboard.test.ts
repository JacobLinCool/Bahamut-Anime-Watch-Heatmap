import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "vitest";
import { renderRhythm } from "./analysis-dashboard";

class FakeStyle {
  setProperty(): void {}
}

class FakeElement {
  readonly tagName: string;
  readonly childNodes: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly style = new FakeStyle();
  readonly dataset: Record<string, string> = {};
  className = "";
  textContent = "";
  title = "";
  scope = "";

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  append(...children: FakeElement[]): void {
    this.childNodes.push(...children);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
}

const originalDocument = globalThis.document;

beforeEach(() => {
  Object.assign(globalThis, {
    document: {
      createElement: (tagName: string) => new FakeElement(tagName)
    }
  });
});

afterEach(() => {
  Object.assign(globalThis, { document: originalDocument });
});

test("rhythm chart exposes every bar value through a semantic assistive table", () => {
  const section = renderRhythm([
    { label: "2026-01", count: 3, contentMinutes: 72 },
    { label: "2026-02", count: 1, contentMinutes: null }
  ]) as unknown as FakeElement;

  const chart = findElement(section, (element) => element.className === "ani-dashboard-rhythm");
  const bars = findElement(section, (element) => element.className === "ani-dashboard-rhythm-bars");
  const table = findElement(section, (element) => element.tagName === "TABLE");
  assert.ok(chart);
  assert.equal(chart.getAttribute("role"), null);
  assert.equal(bars?.getAttribute("aria-hidden"), "true");
  assert.ok(table);
  assert.match(table.className, /ani-dashboard-sr-only/);
  assert.equal(findElement(table, (element) => element.tagName === "CAPTION")?.textContent, "觀看節奏明細");

  const rows = findElements(table, (element) => element.tagName === "TR");
  assert.equal(rows.length, 3);
  assert.deepEqual(rowText(rows[1]!), ["2026-01", "3 次", "1 小時 12 分鐘"]);
  assert.deepEqual(rowText(rows[2]!), ["2026-02", "1 次", "—"]);
});

const rowText = (row: FakeElement): string[] => row.childNodes.map((cell) => cell.textContent);

const findElement = (
  root: FakeElement,
  predicate: (element: FakeElement) => boolean
): FakeElement | null => findElements(root, predicate)[0] ?? null;

const findElements = (
  root: FakeElement,
  predicate: (element: FakeElement) => boolean
): FakeElement[] => {
  const result: FakeElement[] = [];
  const visit = (node: FakeElement): void => {
    if (predicate(node)) result.push(node);
    for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return result;
};
