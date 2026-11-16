"use client";

import { useSyncExternalStore } from "react";
import { readToday, subscribeToday } from "@/lib/todayClock";

/** Today's date (YYYY-MM-DD); the screen re-renders at local midnight and when the tab wakes up. */
export function useToday(): string {
  return useSyncExternalStore(subscribeToday, readToday, readToday);
}
