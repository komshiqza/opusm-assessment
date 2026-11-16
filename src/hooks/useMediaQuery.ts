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
