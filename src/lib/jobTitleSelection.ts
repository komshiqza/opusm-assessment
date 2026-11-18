/**
 * The "Job title" filter selections of the matrix and of Find technician, each stored on its own.
 * A per-browser preference only (localStorage), like the tab order, never stored in FSM. Storage can
 * be blocked (private mode, policies): every access is wrapped, and the app then keeps the selection
 * in memory for this page view.
 */

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

/** One stored selection (a store for useSyncExternalStore). Raw values: "" = nothing stored. */
export interface JobTitleStore {
  read: () => string;
  subscribe: (onChange: () => void) => () => void;
  /** The user's choice; nothing selected is kept as "[]" (everyone), so a reload does not bring back the default. */
  save: (titles: string[]) => void;
  /** Back to "not chosen yet", so the start selection applies again (Reset filters). */
  reset: () => void;
  /** Writes a raw stored value back: "" or a malformed one means nothing stored (the start selection). */
  restore: (raw: string) => void;
}

/** `name`: the storage key is "skill-management.<name>", the change event "skill-management:<name>". */
export function createJobTitleStore(name: string): JobTitleStore {
  const storageKey = `skill-management.${name}`;
  const changeEvent = `skill-management:${name}`;
  /**
   * This page's selection (JSON). Read from storage once when the page opens; afterwards only this
   * page's own changes set it. A change in another window applies on the next page load.
   */
  let current: string | null = null;

  const read = () => {
    if (current === null) {
      try {
        current = window.localStorage.getItem(storageKey) ?? "";
      } catch {
        current = ""; // storage blocked: nothing selected
      }
    }
    return current;
  };
  const subscribe = (onChange: () => void) => {
    window.addEventListener(changeEvent, onChange);
    return () => window.removeEventListener(changeEvent, onChange);
  };
  const save = (titles: string[]) => {
    current = JSON.stringify(titles);
    try {
      window.localStorage.setItem(storageKey, current);
    } catch {
      // storage blocked or full: the selection lives in this page until it is reloaded
    }
    window.dispatchEvent(new Event(changeEvent));
  };
  const reset = () => {
    current = "";
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // storage blocked: nothing to remove
    }
    window.dispatchEvent(new Event(changeEvent));
  };
  const restore = (raw: string) => {
    const titles = parseJobTitleSelection(raw);
    if (titles === null) reset();
    else save(titles);
  };
  return { read, subscribe, save, reset, restore };
}

/** The matrix's selection. */
export const matrixJobTitleStore = createJobTitleStore("matrix-job-titles");
/** Find technician's selection: its own, so the matrix filter and its record switch never change it. */
export const findJobTitleStore = createJobTitleStore("find-job-titles");

export const {
  read: readStoredJobTitles,
  save: saveJobTitles,
  reset: resetJobTitles,
  restore: restoreStoredJobTitles,
} = matrixJobTitleStore;

/**
 * "Show each FSM record" lists every record, so turning it on sets the Job title choice aside (the
 * stored value becomes "[]": everyone, and the chip disappears). Turning it off brings the choice back,
 * unless the user picked titles meanwhile. `stored`: the raw stored value ("" = nothing stored).
 */
export function recordViewTitles(on: boolean, stored: string, setAside: string | null): { stored: string; setAside: string | null } {
  if (on) return { stored: "[]", setAside: stored };
  return { stored: setAside !== null && stored === "[]" ? setAside : stored, setAside: null };
}
