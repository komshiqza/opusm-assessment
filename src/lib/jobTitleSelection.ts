/**
 * The matrix's "Job title" filter selection. A per-browser preference only (localStorage), like the
 * tab order, never stored in FSM. Storage can be blocked (private mode, policies): every access is
 * wrapped, and the app then keeps the selection in memory for this page view.
 */

const STORAGE_KEY = "skill-management.matrix-job-titles";
const CHANGE_EVENT = "skill-management:matrix-job-titles";
/**
 * This page's selection (JSON). Read from storage once when the page opens; afterwards only this
 * page's own changes set it. A change in another window applies on the next page load.
 */
let current: string | null = null;

/** Any stored value → the selected titles: strings only, once each; anything else means nothing selected. */
export function parseJobTitleSelection(raw: string | null | undefined): string[] {
  let stored: unknown = null;
  try {
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    stored = null;
  }
  if (!Array.isArray(stored)) return [];
  return [...new Set(stored.filter((title): title is string => typeof title === "string" && title !== ""))];
}

export function readStoredJobTitles(): string {
  if (current === null) {
    try {
      current = window.localStorage.getItem(STORAGE_KEY) ?? "";
    } catch {
      current = ""; // storage blocked: nothing selected
    }
  }
  return current;
}

export function subscribeJobTitles(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

/** Nothing selected (the default) removes the stored value. */
export function saveJobTitles(titles: string[]): void {
  current = titles.length ? JSON.stringify(titles) : "";
  try {
    if (current) window.localStorage.setItem(STORAGE_KEY, current);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked or full: the selection lives in this page until it is reloaded
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
