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
  selectAnalysisFocusRestoreTarget,
  semanticFocusIdentity,
  shouldAutoFocusRecapHeading
} from "./analysis-view";
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
});

describe("analysis focus containment", () => {
  it("uses the nested evidence panel as the active trap and wraps in both directions", () => {
    const overlay = {} as HTMLElement;
    const panel = {} as HTMLElement;
    const main = {
      querySelector: (selector: string) => selector === ".ani-recap-evidence-panel" ? panel : null
    } as unknown as HTMLElement;

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
  ...(kind === "recap-chapter"
    ? { transition: { phase: transitionPhase, direction: "forward" } }
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
