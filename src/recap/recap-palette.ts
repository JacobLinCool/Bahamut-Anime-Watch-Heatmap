import type { RecapChapterKind } from "./recap-deck";

/** 劇場背景的色調：開場、每一章、結尾海報各一組。 */
export type RecapTone = "intro" | RecapChapterKind | "summary";

export type RecapPalette = {
  /** 前景強調色（眉標、標題重點、量表），沿用各章既有的 accent。 */
  readonly accent: string;
  /** 背景最底層的深色，帶一點章節色相。 */
  readonly base: string;
  /** 漂移光暈的主色。 */
  readonly glow: string;
};

/**
 * 每章一組色票。accent 與舊版 data-chapter 的 --rc-accent 完全一致，
 * 讓前景語彙不變；base / glow 只用在背景 field，換章時由註冊過的
 * custom property 平滑內插。結尾刻意回到低彩度，讓各磚的章節色自己說話。
 */
export const RECAP_PALETTES: Readonly<Record<RecapTone, RecapPalette>> = Object.freeze({
  intro: { accent: "#7dd3fc", base: "#0a1224", glow: "#3b5bdb" },
  overview: { accent: "#7dd3fc", base: "#08142a", glow: "#2563eb" },
  "season-breakdown": { accent: "#5eead4", base: "#061a1c", glow: "#0d9488" },
  "habit-clock": { accent: "#a5b4fc", base: "#0d0f2a", glow: "#4f46e5" },
  marathon: { accent: "#fda4af", base: "#1a0a14", glow: "#be123c" },
  runtime: { accent: "#c4b5fd", base: "#120c2a", glow: "#7c3aed" },
  taste: { accent: "#f9a8d4", base: "#1a0b1c", glow: "#db2777" },
  completion: { accent: "#bef264", base: "#0e170a", glow: "#4d7c0f" },
  binge: { accent: "#fdba74", base: "#21110a", glow: "#ea580c" },
  timeliness: { accent: "#6ee7b7", base: "#061a14", glow: "#059669" },
  "behavior-preference": { accent: "#fcd34d", base: "#1a1408", glow: "#d97706" },
  "platform-taste": { accent: "#f0abfc", base: "#170b1f", glow: "#a21caf" },
  summary: { accent: "#cbd5e1", base: "#0b0f18", glow: "#334155" }
});

export const RECAP_TONES = Object.freeze(Object.keys(RECAP_PALETTES) as RecapTone[]);

/**
 * 背景 field 用的 typed custom properties。shadow root 內的 @property 會被忽略，
 * 只能從 JS 註冊；註冊表是整份文件共用，所以用獨特前綴，重複註冊直接略過。
 */
export const RECAP_REGISTERED_PROPERTIES: readonly PropertyDefinition[] = Object.freeze([
  { name: "--ani-rc-base", syntax: "<color>", inherits: true, initialValue: RECAP_PALETTES.intro.base },
  { name: "--ani-rc-glow", syntax: "<color>", inherits: true, initialValue: RECAP_PALETTES.intro.glow },
  { name: "--ani-rc-haze", syntax: "<color>", inherits: true, initialValue: RECAP_PALETTES.intro.accent },
  { name: "--ani-rc-accent", syntax: "<color>", inherits: true, initialValue: RECAP_PALETTES.intro.accent }
]);

let propertiesRegistered = false;

export const registerRecapProperties = (): void => {
  if (propertiesRegistered) return;
  propertiesRegistered = true;
  if (typeof CSS === "undefined" || typeof CSS.registerProperty !== "function") return;
  for (const definition of RECAP_REGISTERED_PROPERTIES) {
    try {
      CSS.registerProperty(definition);
    } catch {
      // 已註冊（重新開啟觀看誌，或頁面剛好用了同名屬性）：沿用現有定義。
    }
  }
};

/** 每個色調的 CSS 規則：field 拿到 base/glow/haze，劇場根節點拿到前景 accent。 */
export const recapPaletteCss = (): string => RECAP_TONES.map((tone) => {
  const palette = RECAP_PALETTES[tone];
  return `.ani-rc-theater[data-tone="${tone}"], .ani-rc-theater [data-tone="${tone}"] { --rc-accent: ${palette.accent}; }\n`
    + `.ani-rc-field[data-tone="${tone}"] { --ani-rc-base: ${palette.base}; --ani-rc-glow: ${palette.glow}; --ani-rc-haze: ${palette.accent}; }`;
}).join("\n");
