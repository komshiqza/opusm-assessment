"use client";

import { useCallback, useEffect, useState } from "react";

/** The height a box may take so it ends at the bottom of the screen: never below `min` (short screens scroll the page). */
export function fillHeight({ viewportHeight, top, below, min }: { viewportHeight: number; top: number; below: number; min: number }): number {
  return Math.max(min, Math.floor(viewportHeight - top - below));
}

/**
 * The largest height for a scrolling box so that, with everything above and below it on the page, the
 * page fits the screen: the box ends at the bottom and scrolls inside, and a shorter content just stays
 * shorter. Measured, not a fixed rem, because what sits above it varies (wrapping filters, Reset, the
 * record switch); UI5's TabContainer and BusyIndicator keep their inner layout in shadow DOM, so a
 * flex column cannot reach the box. `below`: the page content after the box, up to the end of <main>.
 * Rechecks when the page or the box changes size and when the window is resized or zoomed.
 * Returns a callback ref for the box and its maximum height in px (undefined until measured).
 */
export function useFillHeight(min: number): [(element: HTMLElement | null) => void, number | undefined] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [maxHeight, setMaxHeight] = useState<number>();

  useEffect(() => {
    if (!element) return;
    const page = element.closest("main") ?? document.body;
    const update = () => {
      const box = element.getBoundingClientRect();
      const below = page.getBoundingClientRect().bottom - box.bottom;
      setMaxHeight(fillHeight({ viewportHeight: window.innerHeight, top: box.top + window.scrollY, below, min }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(page);
    observer.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [element, min]);

  const ref = useCallback((node: HTMLElement | null) => setElement(node), []);
  return [ref, maxHeight];
}
