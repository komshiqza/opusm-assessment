/**
 * Light / dark theme choice with SAP's own themes: Morning Horizon (sap_horizon, the default) and
 * Evening Horizon (sap_horizon_dark). It does not follow the device setting: a first visit is always light.
 * A per-browser preference only (localStorage), like the tab order; storage errors are ignored.
 */

export type ThemeChoice = "light" | "dark";

export const DEFAULT_THEME: ThemeChoice = "light";

export const UI5_THEME: Record<ThemeChoice, string> = {
  light: "sap_horizon",
  dark: "sap_horizon_dark",
};

/** The browser's own color-scheme for each choice: native scrollbars and the page background before the theme loads. */
export const COLOR_SCHEME: Record<ThemeChoice, string> = { light: "light", dark: "dark" };

const STORAGE_KEY = "skill-management.theme";
const CHANGE_EVENT = "skill-management:theme";
let current: ThemeChoice | null = null;

/** Only an explicit "dark" is dark; anything else (nothing saved, an old "system", junk) is the default. */
export function parseThemeChoice(raw: string | null | undefined): ThemeChoice {
  return raw === "dark" ? "dark" : DEFAULT_THEME;
}

export function readThemeChoice(): ThemeChoice {
  if (current === null) {
    try {
      current = parseThemeChoice(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      current = DEFAULT_THEME;
    }
  }
  return current;
}

export function saveThemeChoice(choice: ThemeChoice): void {
  current = choice;
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // storage blocked: the choice lives in this page until it is reloaded
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeThemeChoice(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

/**
 * Inline <head> script: sets the browser color-scheme from the saved choice before anything paints,
 * so a dark choice does not start on a white page while the UI5 theme loads.
 */
export const THEME_BOOT_SCRIPT = `try{var c=localStorage.getItem(${JSON.stringify(STORAGE_KEY)})}catch(e){}document.documentElement.style.colorScheme=c==="dark"?${JSON.stringify(COLOR_SCHEME.dark)}:${JSON.stringify(COLOR_SCHEME[DEFAULT_THEME])};`;
