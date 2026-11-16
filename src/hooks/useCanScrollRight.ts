"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * True while a horizontally scrolling element has more content to its right, for a "scroll here"
 * shadow. Rechecks on scroll and whenever the element or its content changes size.
 * Returns a callback ref for the scrolling element.
 */
export function useCanScrollRight(): [(element: HTMLElement | null) => void, boolean] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    if (!element) return;
    const update = () => setCanScrollRight(element.scrollLeft + element.clientWidth < element.scrollWidth - 1);
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [element]);

  const ref = useCallback((node: HTMLElement | null) => setElement(node), []);
  return [ref, canScrollRight];
}
