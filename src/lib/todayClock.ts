/**
 * Today's date (YYYY-MM-DD, local time) for screens that stay open overnight. Subscribers are told
 * when the date changes: by a timer at the next local midnight, and when the tab becomes visible
 * again (a sleeping laptop does not run timers). Used through `useToday()`.
 */
import { todayIso } from "@/lib/domain/status";

const listeners = new Set<() => void>();
let lastSeen = todayIso();
let timer: ReturnType<typeof setTimeout> | null = null;

export function readToday(): string {
  return todayIso();
}

/** Tells every subscriber if the date is not the one they last saw. */
function check() {
  const now = todayIso();
  if (now === lastSeen) return;
  lastSeen = now;
  for (const listener of listeners) listener();
}

/** A timer for just after the next local midnight; re-armed each time it fires. */
function armTimer() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  timer = setTimeout(() => {
    check();
    armTimer();
  }, nextMidnight - now.getTime() + 100);
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") check();
}

export function subscribeToday(onChange: () => void): () => void {
  listeners.add(onChange);
  if (listeners.size === 1) {
    lastSeen = todayIso();
    armTimer();
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibilityChange);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size > 0) return;
    if (timer) clearTimeout(timer);
    timer = null;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
