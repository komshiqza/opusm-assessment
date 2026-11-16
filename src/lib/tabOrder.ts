/**
 * Order of the main tabs. A per-browser preference only (localStorage), never stored in FSM.
 * Storage can be blocked (private mode, policies): every access is wrapped, and the app then keeps
 * the order in memory for this page view.
 */

export type TabKey = "matrix" | "expiry" | "find" | "catalogue";

/** By daily importance for a service manager; the catalogue is setup and used rarely. */
export const DEFAULT_TAB_ORDER: TabKey[] = ["matrix", "expiry", "find", "catalogue"];

const STORAGE_KEY = "skill-management.tab-order";
const CHANGE_EVENT = "skill-management:tab-order";
/** This page's order when it could not be saved; used only while saving fails. */
let memory: string | null = null;
let saveFailed = false;

/** Any stored value → a valid order: known keys once each, missing ones appended in default order. */
export function parseTabOrder(raw: string | null | undefined): TabKey[] {
  let stored: unknown = null;
  try {
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    stored = null;
  }
  const known = Array.isArray(stored) ? stored.filter((k): k is TabKey => DEFAULT_TAB_ORDER.includes(k as TabKey)) : [];
  const unique = [...new Set(known)];
  return [...unique, ...DEFAULT_TAB_ORDER.filter((k) => !unique.includes(k))];
}

/** Moves `source` before or after `target`. */
export function moveTab(order: TabKey[], source: TabKey, target: TabKey, placement: "Before" | "After"): TabKey[] {
  if (source === target) return order;
  const without = order.filter((k) => k !== source);
  const index = without.indexOf(target);
  if (index < 0) return order;
  without.splice(placement === "Before" ? index : index + 1, 0, source);
  return without;
}

export function isDefaultTabOrder(order: TabKey[]): boolean {
  return order.join() === DEFAULT_TAB_ORDER.join();
}

// --- Store for useSyncExternalStore -------------------------------------------------------------

export function readStoredTabOrder(): string {
  if (saveFailed) return memory ?? "";
  try {
    // Storage works: it is the truth. A missing key means default (e.g. reset in another window).
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return memory ?? "";
  }
}

export function subscribeTabOrder(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function saveTabOrder(order: TabKey[]): void {
  memory = JSON.stringify(order);
  try {
    window.localStorage.setItem(STORAGE_KEY, memory);
    saveFailed = false;
  } catch {
    saveFailed = true; // blocked storage: the order lives in memory until the page is reloaded
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function resetTabOrder(): void {
  memory = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    saveFailed = false;
  } catch {
    saveFailed = true; // cannot remove it: this page shows the default from memory
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
