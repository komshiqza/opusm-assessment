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

/**
 * The stored choice. null: nothing stored or not readable (counts as "not chosen yet"). An empty
 * list is an explicit choice: everyone. Only a list of non-empty strings is a choice.
 */
export function parseJobTitleSelection(raw: string | null | undefined): string[] | null {
  let stored: unknown = null;
  try {
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
  if (!Array.isArray(stored) || !stored.every((title) => typeof title === "string" && title !== "")) return null;
  return [...new Set(stored as string[])];
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

/** The user's choice; nothing selected is kept as "[]" (everyone), so a reload does not bring back the default. */
export function saveJobTitles(titles: string[]): void {
  current = JSON.stringify(titles);
  try {
    window.localStorage.setItem(STORAGE_KEY, current);
  } catch {
    // storage blocked or full: the selection lives in this page until it is reloaded
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Back to "not chosen yet", so the start selection applies again (Reset filters). */
export function resetJobTitles(): void {
  current = "";
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked: nothing to remove
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
