/**
 * App texts in English and German. `t("key", { name })` fills {name}; `tn("key", n)` picks
 * "key_one" or "key_other" by count and fills {n}. Reads the current language each time, so a
 * re-render of the app after a language change shows every text in the new language.
 */
import { getRenderedLanguage, type Language } from "./language";
import { de, en, type MessageKey } from "./messages";

const DICTIONARIES: Record<Language, Record<MessageKey, string>> = { en, de };

type Params = Record<string, string | number>;

export function t(key: MessageKey, params?: Params, language: Language = getRenderedLanguage()): string {
  const text = DICTIONARIES[language][key] ?? en[key];
  return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : text;
}

/** Plural by count: "key_one" for 1, "key_other" otherwise (both languages use this rule). */
export function tn(key: string, count: number, params?: Params, language: Language = getRenderedLanguage()): string {
  const full = `${key}_${count === 1 ? "one" : "other"}` as MessageKey;
  return t(full, { n: count, ...params }, language);
}
