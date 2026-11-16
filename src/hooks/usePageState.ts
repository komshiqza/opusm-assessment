"use client";

import { useCallback, useState } from "react";

/** Values kept for the lifetime of the page, outside any component. */
const values = new Map<string, unknown>();

/**
 * Like useState, but the value survives when the component is mounted again (for example when the
 * tab strip is rebuilt after the tabs were reordered). Lost on page reload; never stored anywhere.
 */
export function usePageState<T>(key: string, initial: T): [T, (next: T | ((previous: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => (values.has(key) ? (values.get(key) as T) : initial));
  const update = useCallback(
    (next: T | ((previous: T) => T)) =>
      setValue((previous) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(previous) : next;
        values.set(key, resolved);
        return resolved;
      }),
    [key],
  );
  return [value, update];
}
