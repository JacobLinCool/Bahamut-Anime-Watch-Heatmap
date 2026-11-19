import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type LocaleMessages = Record<string, { message: string }>;

const publicDir = resolve(__dirname, "../public");
const manifest = JSON.parse(readFileSync(resolve(publicDir, "manifest.json"), "utf8")) as {
  name: string;
  description: string;
  default_locale?: string;
};
const locales = readdirSync(resolve(publicDir, "_locales"));
const messagesFor = (locale: string): LocaleMessages =>
  JSON.parse(readFileSync(resolve(publicDir, "_locales", locale, "messages.json"), "utf8")) as LocaleMessages;
const messageKey = (value: string): string | null => /^__MSG_(\w+)__$/.exec(value)?.[1] ?? null;

describe("manifest locales", () => {
  it("ships the default locale and a Traditional Chinese name", () => {
    expect(manifest.default_locale).toBe("en");
    expect(locales).toEqual(expect.arrayContaining(["en", "zh_TW"]));
    expect(messagesFor("zh_TW").extName?.message).toBe("動畫瘋追番回顧");
  });

  // Chrome refuses to load an extension whose manifest names a message a locale lacks.
  it.each(locales)("defines every manifest message within Chrome's limits in %s", (locale) => {
    const messages = messagesFor(locale);
    const nameKey = messageKey(manifest.name);
    const descriptionKey = messageKey(manifest.description);
    expect(nameKey).not.toBeNull();
    expect(descriptionKey).not.toBeNull();
    const name = messages[nameKey!]?.message ?? "";
    const description = messages[descriptionKey!]?.message ?? "";
    expect(name.length).toBeGreaterThan(0);
    expect(name.length).toBeLessThanOrEqual(75);
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(132);
  });
});
