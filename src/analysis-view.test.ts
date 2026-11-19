import { describe, expect, it } from "vitest";
import type { RecapUiState } from "./recap/recap-state";
import {
  analysisCss,
  analysisFocusViewKey,
  debugDownloadButtonPresentation,
  getAnalysisFocusTrapRoot,
  handleAnalysisEscapeKey,
  metadataCacheButtonPresentation,
  metadataCacheClearedMessage,
  postRecapDispatchFocusKey,
  resolveCyclicFocusTarget,
  resolveSemanticFocusTarget,
  retainSelectedScopeOption,
  scopeOptionsSignature,
  selectAnalysisFocusRestoreTarget,
  semanticFocusIdentity,
  shouldAutoFocusRecapHeading
} from "./analysis-view";
import { formatHistoryNote } from "./analysis-format";
import { analysisScopeKey, createAnalysisScope, getAnalysisScopeOptionGroups } from "./period";
import { RECAP_EVIDENCE_OPENER_FOCUS_KEY } from "./recap/recap-view";

describe("analysis shadow stylesheet isolation", () => {
  it("resets the shadow host and suppresses host pseudo-elements", () => {
    expect(analysisCss).toMatch(/:host\s*\{[\s\S]*?all: initial !important;/);
    expect(analysisCss).toMatch(
      /:host::before,\s*:host::after\s*\{\s*content: none !important;\s*display: none !important;\s*\}/
    );
    expect(analysisCss).not.toContain("#ani-gamer-watch-analysis-overlay *");
  });

  it("gives the shell a definite viewport height so recap stages fill the remaining grid row", () => {
    expect(analysisCss).toMatch(
      /\.ani-analysis-shell\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*100dvh;/
    );
    expect(analysisCss).toMatch(
      /\.ani-analysis-shell\[data-playback="true"\]\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\);/
    );
  });

  it("lets the header melt into the theater during playback instead of floating a light bar above it", () => {
    // 劇場鋪到標題列底下（同一格），標題列變透明且不再做 backdrop blur。
    expect(analysisCss).toMatch(
      /\.ani-analysis-shell\[data-playback="true"\] \.ani-analysis-main\s*\{[^}]*grid-row:\s*1 \/ -1;/
    );
    expect(analysisCss).toMatch(
      /\.ani-analysis-shell\[data-playback="true"\] \.ani-analysis-header\s*\{[^}]*background-color:\s*rgba\(249, 251, 253, 0\);[^}]*backdrop-filter:\s*none;/
    );
    // 外圍跟著「關燈」：一層深色幕淡入（只動 opacity），不內插 background-color，所以不會停在灰階。
    expect(analysisCss).toMatch(/\.ani-analysis-shell::before\s*\{[^}]*background:\s*#05080f;[^}]*opacity:\s*0;[^}]*transition:\s*opacity/);
    expect(analysisCss).toMatch(/\.ani-analysis-shell\[data-playback="true"\]::before\s*\{\s*opacity:\s*1;/);
    expect(analysisCss).not.toMatch(/\.ani-analysis-overlay\s*\{[^}]*transition:\s*background-color/);
  });
});

describe("analysis focus containment", () => {
  it("uses the nested evidence panel as the active trap and wraps in both directions", () => {
    const overlay = {} as HTMLElement;
    const panel = {} as HTMLElement;
    const main = fakeMainWithVeils([{ inert: false, panel }]);

    expect(getAnalysisFocusTrapRoot(overlay, main, true)).toBe(panel);
    expect(getAnalysisFocusTrapRoot(overlay, main, false)).toBe(overlay);

    const first = { name: "first" };
    const middle = { name: "middle" };
    const last = { name: "last" };
    const outside = { name: "outside" };
    const focusable = [first, middle, last];
    expect(resolveCyclicFocusTarget(focusable, outside, false)).toBe(first);
    expect(resolveCyclicFocusTarget(focusable, outside, true)).toBe(last);
    expect(resolveCyclicFocusTarget(focusable, first, true)).toBe(last);
    expect(resolveCyclicFocusTarget(focusable, last, false)).toBe(first);
    expect(resolveCyclicFocusTarget(focusable, middle, false)).toBeUndefined();
  });

  it("moves on from a focused tabindex=-1 heading inside the trap instead of wrapping", () => {
    // 換章後焦點在章節標題上（不在 Tab 序列裡）：標題列按鈕在它前面，場景與操作列在它後面。
    const close = { name: "close" };
    const sceneButton = { name: "scene button" };
    const next = { name: "next" };
    const heading = { name: "heading" };
    const focusable = [close, sceneButton, next];
    const afterHeading = new Set([sceneButton, next]);
    const follows = (node: { name: string }): boolean => afterHeading.has(node);
    expect(resolveCyclicFocusTarget(focusable, heading, false, follows)).toBe(sceneButton);
    expect(resolveCyclicFocusTarget(focusable, heading, true, follows)).toBe(close);
    // 標題已經在最後（或最前）時才繞回另一端。
    expect(resolveCyclicFocusTarget(focusable, heading, false, () => false)).toBe(close);
    expect(resolveCyclicFocusTarget(focusable, heading, true, () => true)).toBe(next);
  });

  it("traps Tab in the newly opened panel while the previous one is still fading out", () => {
    // 關上後 180 ms 內又按「怎麼計算」：舊的幕還在 DOM 裡（inert），新的幕接在它後面。
    const overlay = {} as HTMLElement;
    const closing = { name: "closing" } as unknown as HTMLElement;
    const open = { name: "open" } as unknown as HTMLElement;
    const main = fakeMainWithVeils([{ inert: true, panel: closing }, { inert: false, panel: open }]);
    expect(getAnalysisFocusTrapRoot(overlay, main, true)).toBe(open);
    // 只剩淡出中的幕（理論上不會發生）時退回整個分析頁，而不是困在 inert 的面板裡。
    expect(getAnalysisFocusTrapRoot(overlay, fakeMainWithVeils([{ inert: true, panel: closing }]), true)).toBe(overlay);
  });

  it("consumes Escape before closing evidence or the outer dialog", () => {
    const calls: string[] = [];
    const event = keyboardEvent("Escape");
    expect(handleAnalysisEscapeKey(
      event,
      true,
      () => calls.push("evidence"),
      () => calls.push("analysis")
    )).toBe(true);
    expect(event.prevented).toBe(true);
    expect(event.stopped).toBe(true);
    expect(calls).toEqual(["evidence"]);

    const ignored = keyboardEvent("Enter");
    expect(handleAnalysisEscapeKey(ignored, false, () => undefined, () => undefined)).toBe(false);
    expect(ignored.prevented).toBe(false);
    expect(ignored.stopped).toBe(false);
  });
});

describe("analysis focus continuity", () => {
  it("finds the equivalent semantic control after a content rerender", () => {
    const oldButton = fakeSemanticElement("button", "查看完整分析", {
      class: "ani-recap-ghost-button",
      data: { action: "dashboard" }
    });
    const firstReplacement = fakeSemanticElement("button", "查看完整分析", {
      class: "ani-recap-ghost-button",
      data: { action: "dashboard" }
    });
    const focusedReplacement = fakeSemanticElement("button", "查看完整分析", {
      class: "ani-recap-ghost-button",
      data: { action: "dashboard" }
    });
    const identity = semanticFocusIdentity(oldButton);

    expect(resolveSemanticFocusTarget(
      [firstReplacement, focusedReplacement],
      { identity, ordinal: 1 }
    )).toBe(focusedReplacement);
  });

  it("does not auto-focus a recap heading for metadata-only or animation-state rerenders", () => {
    const running = recapState("recap-chapter", "runtime", "running", false);
    const settledWithNewData = recapState("recap-chapter", "runtime", "idle", true);
    const runningKey = analysisFocusViewKey(running);
    const updatedKey = analysisFocusViewKey(settledWithNewData);

    expect(updatedKey).toBe(runningKey);
    expect(shouldAutoFocusRecapHeading(updatedKey !== runningKey, settledWithNewData.kind)).toBe(false);

    const evidence = recapState("recap-evidence", "runtime", "idle", true);
    expect(analysisFocusViewKey(evidence)).not.toBe(updatedKey);
    expect(shouldAutoFocusRecapHeading(true, evidence.kind)).toBe(true);

    const summary = { kind: "recap-summary", deck: {}, stale: false, direction: "forward" } as unknown as RecapUiState;
    expect(analysisFocusViewKey(summary)).toBe("recap-summary");
    expect(shouldAutoFocusRecapHeading(true, summary.kind)).toBe(true);
  });

  it("requests the evidence opener when returning to its chapter", () => {
    const evidence = recapState("recap-evidence", "runtime", "idle", false);
    const chapter = recapState("recap-chapter", "runtime", "idle", false);
    expect(postRecapDispatchFocusKey(
      evidence as never,
      { type: "CLOSE_EVIDENCE" },
      chapter as never
    )).toBe(RECAP_EVIDENCE_OPENER_FOCUS_KEY);
    expect(postRecapDispatchFocusKey(
      chapter as never,
      { type: "NEXT" },
      chapter as never
    )).toBeUndefined();
  });

  it("falls back to the connected heatmap focus bridge when the opener was replaced", () => {
    const replacedOpener = { isConnected: false, name: "old analysis button" };
    const focusBridge = { isConnected: true, name: "stable heatmap bridge" };
    expect(selectAnalysisFocusRestoreTarget(replacedOpener, focusBridge)).toBe(focusBridge);

    const connectedOpener = { isConnected: true, name: "analysis button" };
    expect(selectAnalysisFocusRestoreTarget(connectedOpener, focusBridge)).toBe(connectedOpener);
    expect(selectAnalysisFocusRestoreTarget(
      replacedOpener,
      { isConnected: false, name: "disconnected bridge" }
    )).toBeUndefined();
  });
});

describe("作品資料快取控制", () => {
  it("keeps debug export available during collection and blocks it during cache replacement", () => {
    expect(debugDownloadButtonPresentation(false, false)).toEqual({
      label: "下載除錯資料",
      disabled: false,
      busy: false
    });
    expect(debugDownloadButtonPresentation(true, false)).toEqual({
      label: "正在整理除錯資料…",
      disabled: true,
      busy: true
    });
    expect(debugDownloadButtonPresentation(false, true).disabled).toBe(true);
  });

  it("stays actionable while resolving and exposes the stop-and-clear wording", () => {
    expect(metadataCacheButtonPresentation("resolving", false)).toEqual({
      label: "停止取得並清除作品資料",
      disabled: false,
      busy: false
    });
  });

  it("only disables the action while the clear operation itself is running", () => {
    expect(metadataCacheButtonPresentation("idle", false).disabled).toBe(false);
    expect(metadataCacheButtonPresentation("complete", false).disabled).toBe(false);
    expect(metadataCacheButtonPresentation("aborted", false).disabled).toBe(false);
    expect(metadataCacheButtonPresentation("complete", true)).toEqual({
      label: "正在重新整理作品資料…",
      disabled: true,
      busy: true
    });
  });

  it("only claims a restart when collection was actually triggered", () => {
    expect(metadataCacheClearedMessage(12, true)).toBe(
      "已清除 12 筆作品資料；正以每秒最多 10 次重新取得。"
    );
    expect(metadataCacheClearedMessage(12, false)).toBe("已清除 12 筆作品資料。");
  });
});

const recapState = (
  kind: "recap-chapter" | "recap-evidence",
  chapterId: string,
  transitionPhase: "running" | "idle",
  stale: boolean
): RecapUiState => ({
  kind,
  chapterId,
  stale,
  deck: {},
  // 換場已可中斷：狀態只記抵達方向，「running / idle」不再存在於 reducer 裡。
  ...(kind === "recap-chapter"
    ? { direction: transitionPhase === "running" ? "forward" : "backward" }
    : {})
} as unknown as RecapUiState);

const fakeSemanticElement = (
  tagName: string,
  textContent: string,
  options: { readonly class: string; readonly data: Record<string, string> }
): HTMLElement => ({
  id: "",
  tagName: tagName.toUpperCase(),
  textContent,
  dataset: options.data,
  classList: options.class.split(/\s+/),
  getAttribute: () => null
} as unknown as HTMLElement);

const keyboardEvent = (key: string): Pick<KeyboardEvent, "key" | "preventDefault" | "stopPropagation"> & {
  prevented: boolean;
  stopped: boolean;
} => ({
  key,
  prevented: false,
  stopped: false,
  preventDefault() { this.prevented = true; },
  stopPropagation() { this.stopped = true; }
});

/** 依 DOM 順序排好的資料依據幕；querySelector 只認得面板的兩種寫法，其餘一律丟錯，選擇器改了測試就會提醒。 */
const fakeMainWithVeils = (
  veils: readonly { readonly inert: boolean; readonly panel: HTMLElement }[]
): HTMLElement => ({
  querySelector: (selector: string) => {
    if (selector === ".ani-recap-evidence-panel") return veils[0]?.panel ?? null;
    if (selector === ".ani-recap-evidence-veil:not([inert]) .ani-recap-evidence-panel") {
      return veils.find((veil) => !veil.inert)?.panel ?? null;
    }
    throw new Error(`unexpected selector: ${selector}`);
  }
}) as unknown as HTMLElement;

describe("period options across an as-of change", () => {
  const axis = { axis: "watched-at", dayBoundaryMode: "calendar" } as const;

  it("rebuilds when the Taipei date changes even if the UTC date does not", () => {
    // 台北 7/14 18:00 與 7/15 01:00 都是 UTC 7/14。
    const cached = getAnalysisScopeOptionGroups({ asOf: new Date("2026-07-14T10:00:00Z"), axis });
    const page = getAnalysisScopeOptionGroups({ asOf: new Date("2026-07-14T17:00:00Z"), axis });
    expect(scopeOptionsSignature(page)).not.toBe(scopeOptionsSignature(cached));
    // 跨月：7 月結束、8 月出現。
    const july = getAnalysisScopeOptionGroups({ asOf: new Date("2026-07-31T12:00:00Z"), axis });
    const august = getAnalysisScopeOptionGroups({ asOf: new Date("2026-07-31T17:00:00Z"), axis });
    expect(scopeOptionsSignature(august)).not.toBe(scopeOptionsSignature(july));
    expect(scopeOptionsSignature(july)).toBe(scopeOptionsSignature(
      getAnalysisScopeOptionGroups({ asOf: new Date("2026-07-31T13:00:00Z"), axis })
    ));
  });

  it("keeps a selected month that the newer as-of date pushed out of the list", () => {
    const before = new Date("2026-06-30T12:00:00Z");
    const after = new Date("2026-07-01T02:00:00Z");
    const oldest = getAnalysisScopeOptionGroups({ asOf: before, axis })
      .find((group) => group.id === "calendar-months")?.options.at(-1);
    expect(oldest?.scope.period).toEqual({ kind: "calendar-month", year: 2025, month: 7 });
    const selected = createAnalysisScope(axis, oldest!.scope.period);
    const groups = retainSelectedScopeOption(getAnalysisScopeOptionGroups({ asOf: after, axis }), selected, after);
    const months = groups.find((group) => group.id === "calendar-months")?.options ?? [];
    expect(months.at(-1)).toMatchObject({ key: analysisScopeKey(selected), label: "2025 年 7 月", periodStatus: "closed" });
    expect(months.at(0)?.label).toBe("2026 年 7 月（截至 7 月 1 日）");

    // 已在選單裡、或在這個資料時間還沒開始的期間不另外加。
    const listed = createAnalysisScope(axis, { kind: "rolling-days", days: 30 });
    const fresh = getAnalysisScopeOptionGroups({ asOf: after, axis });
    expect(retainSelectedScopeOption(fresh, listed, after)).toBe(fresh);
    const future = createAnalysisScope(axis, { kind: "calendar-month", year: 2026, month: 8 });
    expect(retainSelectedScopeOption(fresh, future, after)).toBe(fresh);
  });
});

describe("history note in the overlay", () => {
  it("dates a saved snapshot and leaves a page read as it is", () => {
    expect(formatHistoryNote("更新中…", new Date("2026-10-15T13:04:00Z"))).toBe("更新中… · 紀錄截至 10/15 21:04");
    expect(formatHistoryNote("未能更新，顯示先前保存的紀錄", new Date("2026-10-01T16:30:00Z")))
      .toBe("未能更新，顯示先前保存的紀錄 · 紀錄截至 10/2 00:30");
    expect(formatHistoryNote("更新中…", null)).toBe("更新中…");
  });
});
