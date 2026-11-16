/**
 * Language of the app texts: English (default) or German. A per-browser preference only
 * (localStorage), like the theme; storage errors are ignored. Skill names from FSM stay as stored.
 */

export type Language = "en" | "de";

export const DEFAULT_LANGUAGE: Language = "en";

/** UI5's own texts: German UI5 bundles with "ß" replaced (Swiss spelling), see ui5-setup. */
export const UI5_LANGUAGE: Record<Language, string> = { en: "en", de: "de" };

const STORAGE_KEY = "skill-management.language";
const CHANGE_EVENT = "skill-management:language";
let current: Language | null = null;

/** Only an explicit "de" is German; anything else is the default. */
export function parseLanguage(raw: string | null | undefined): Language {
  return raw === "de" ? "de" : DEFAULT_LANGUAGE;
}

/**
 * The language the app is drawing in right now. English until the app has started in the browser,
 * like the server's HTML (which cannot know the browser's choice); then the saved choice. Set by the
 * app's root on each render, read by t().
 */
let renderedLanguage: Language = DEFAULT_LANGUAGE;
export const getRenderedLanguage = (): Language => renderedLanguage;
export const setRenderedLanguage = (language: Language): void => {
  renderedLanguage = language;
};

export function readLanguage(): Language {
  if (current === null) {
    try {
      current = typeof window === "undefined" ? DEFAULT_LANGUAGE : parseLanguage(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      current = DEFAULT_LANGUAGE;
    }
  }
  return current;
}

export function saveLanguage(language: Language): void {
  current = language;
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // storage blocked: the choice lives in this page until it is reloaded
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeLanguage(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}
