import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "vitest";
import { renderBingeRanking, renderRhythm } from "./analysis-dashboard";
import type { BingeRow } from "./analytics";

class FakeStyle {
  setProperty(): void {}
}

class FakeElement {
  readonly tagName: string;
  readonly childNodes: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly style = new FakeStyle();
  readonly dataset: Record<string, string> = {};
  readonly listeners = new Map<string, (() => void)[]>();
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

  replaceChildren(...children: FakeElement[]): void {
    this.childNodes.splice(0, this.childNodes.length, ...children);
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click(): void {
    for (const listener of this.listeners.get("click") ?? []) listener();
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

const bingeRow = (overrides: Partial<BingeRow> = {}): BingeRow => ({
  rank: 1,
  animeSn: 101,
  title: "十二集作品",
  coverUrl: null,
  episodeCount: 12,
  startedAt: new Date("2026-01-30T12:00:00+08:00"),
  completedAt: new Date("2026-02-03T12:00:00+08:00"),
  elapsedMinutes: 4 * 24 * 60,
  spanDays: 5,
  activeDayCount: 2,
  episodesPerDay: 2.4,
  ...overrides
});

test("binge leaderboard defaults to daily rates across different season lengths and retains elapsed-time sorting", () => {
  const rows = [bingeRow(), bingeRow({
    rank: 2,
    animeSn: 102,
    title: "二十四集作品",
    episodeCount: 24,
    completedAt: new Date("2026-02-06T12:00:00+08:00"),
    elapsedMinutes: 7 * 24 * 60,
    spanDays: 8,
    episodesPerDay: 3
  })];
  const section = renderBingeRanking(rows, "calendar") as unknown as FakeElement;
  const list = findElement(section, (node) => node.tagName === "OL")!;
  const buttons = findElements(section, (node) => node.tagName === "BUTTON");
  assert.deepEqual(list.childNodes.map((node) => node.dataset.animeSn), ["102", "101"]);
  assert.deepEqual(buttons.map((button) => button.textContent), ["平均每天集數", "耗時最短"]);
  assert.equal(buttons[0]?.getAttribute("aria-pressed"), "true");
  assert.match(allText(list.childNodes[0]!), /7 天/);
  assert.equal(findElement(list.childNodes[0]!, (node) => node.className === "ani-dashboard-binge-primary")?.textContent, "3 集／日");
  assert.match(findElement(section, (node) => node.getAttribute("role") === "status")!.textContent, /平均每天集數由高到低/);

  buttons[1]!.click();
  assert.deepEqual(list.childNodes.map((node) => node.dataset.animeSn), ["101", "102"]);
  assert.deepEqual(findElements(list, (node) => node.className === "ani-dashboard-rank").map((node) => node.textContent), ["1", "2"]);
  assert.equal(buttons[0]?.getAttribute("aria-pressed"), "false");
  assert.equal(buttons[1]?.getAttribute("aria-pressed"), "true");
  assert.equal(findElement(list.childNodes[0]!, (node) => node.className === "ani-dashboard-binge-primary")?.textContent, "4 天");
  assert.match(allText(list.childNodes[0]!), /2.4 集／日/);
  assert.match(findElement(section, (node) => node.getAttribute("role") === "status")!.textContent, /補完耗時由短到長/);

  buttons[0]!.click();
  assert.deepEqual(list.childNodes.map((node) => node.dataset.animeSn), ["102", "101"]);
  assert.deepEqual(rows.map((row) => row.animeSn), [101, 102]);
});

test("binge leaderboard retains cross-month dates, all rows, and daily denominator explanation", () => {
  const rows = Array.from({ length: 8 }, (_, index) => bingeRow({ animeSn: 101 + index }));
  const section = renderBingeRanking(rows, "thirty-hour") as unknown as FakeElement;
  const list = findElement(section, (node) => node.tagName === "OL")!;
  assert.equal(list.childNodes.length, 8);
  assert.match(allText(section), /2026\/01\/30 開始 → 2026\/02\/03 補完/);
  assert.match(allText(section), /12 集 · 日期跨度 5 天/);
  assert.match(allText(section), /含首尾的日期跨度，中間沒看的日子也算/);
  assert.match(allText(section), /30H，每天 06:00 換日/);
  assert.doesNotMatch(allText(section), /proxy|集中收尾|最後四集|最後 4 集/i);
});

test("binge leaderboard shares ranks for equal primary values and orders ties deterministically", () => {
  const section = renderBingeRanking([
    bingeRow({ animeSn: 103, elapsedMinutes: 6_000, episodesPerDay: 2 }),
    bingeRow({ animeSn: 102, episodeCount: 24, spanDays: 10, elapsedMinutes: 9 * 24 * 60 }),
    bingeRow({ animeSn: 101 })
  ], "calendar") as unknown as FakeElement;
  const list = findElement(section, (node) => node.tagName === "OL")!;
  assert.deepEqual(list.childNodes.map((node) => node.dataset.animeSn), ["101", "102", "103"]);
  assert.deepEqual(findElements(list, (node) => node.className === "ani-dashboard-rank").map((node) => node.textContent), ["1", "1", "3"]);
});

test("binge leaderboard does not render an empty module", () => {
  assert.equal(renderBingeRanking([], "calendar"), null);
});

const allText = (root: FakeElement): string => [root.textContent, ...root.childNodes.map(allText)].join(" ");

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
