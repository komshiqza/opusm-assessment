"use client";

import { useCallback, useSyncExternalStore } from "react";

/** True while the CSS media query matches. False during server rendering. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phone width: below the tablet breakpoint (768 px) and below UI5's "S" size. */
export const PHONE_QUERY = "(max-width: 599px)";

/** Below tablet width: the full tab names no longer fit next to each other. */
export const NARROW_QUERY = "(max-width: 767px)";

/** Below a wide desktop: matrix cells switch to a compact form so all skill columns fit at 1024 px. */
export const COMPACT_QUERY = "(max-width: 1279px)";
