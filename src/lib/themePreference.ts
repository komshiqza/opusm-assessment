/**
 * Light / dark theme choice. SAP's own themes: Morning Horizon (sap_horizon), Evening Horizon
 * (sap_horizon_dark), and sap_horizon_auto, which follows the device setting (prefers-color-scheme).
 * A per-browser preference only (localStorage), like the tab order; storage errors are ignored.
 */

export type ThemeChoice = "system" | "light" | "dark";

export const UI5_THEME: Record<ThemeChoice, string> = {
  system: "sap_horizon_auto",
  light: "sap_horizon",
  dark: "sap_horizon_dark",
};

export const THEME_LABELS: Record<ThemeChoice, string> = {
  system: "System (follows the device)",
  light: "Light (Morning Horizon)",
  dark: "Dark (Evening Horizon)",
};

/** The browser's own color-scheme for each choice: native scrollbars and the page background before the theme loads. */
export const COLOR_SCHEME: Record<ThemeChoice, string> = { system: "light dark", light: "light", dark: "dark" };

const STORAGE_KEY = "skill-management.theme";
const CHANGE_EVENT = "skill-management:theme";
let current: ThemeChoice | null = null;

export function parseThemeChoice(raw: string | null | undefined): ThemeChoice {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

export function readThemeChoice(): ThemeChoice {
  if (current === null) {
    try {
      current = parseThemeChoice(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      current = "system";
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
export const THEME_BOOT_SCRIPT = `try{var c=localStorage.getItem(${JSON.stringify(STORAGE_KEY)})}catch(e){}document.documentElement.style.colorScheme=${JSON.stringify(COLOR_SCHEME)}[c==="light"||c==="dark"?c:"system"];`;
