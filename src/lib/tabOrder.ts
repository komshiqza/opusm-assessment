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
/**
 * This page's order (JSON). Read from storage once when the page opens; afterwards only this page's
 * own reorder or reset changes it. A change in another window applies on the next page load, so an
 * open page (and an open dialog in it) is never rebuilt by something the user did elsewhere.
 */
let current: string | null = null;

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
  if (current === null) {
    try {
      current = window.localStorage.getItem(STORAGE_KEY) ?? "";
    } catch {
      current = ""; // storage blocked: default order
    }
  }
  return current;
}

export function subscribeTabOrder(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export function saveTabOrder(order: TabKey[]): void {
  current = JSON.stringify(order);
  try {
    window.localStorage.setItem(STORAGE_KEY, current);
  } catch {
    // storage blocked or full: the order lives in this page until it is reloaded
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function resetTabOrder(): void {
  current = "";
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked: nothing to remove
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
