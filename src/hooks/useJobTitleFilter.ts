"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { jobTitleOptions, knownJobTitles, selectedJobTitles } from "@/lib/domain/jobTitleFilter";
import { parseJobTitleSelection, type JobTitleStore } from "@/lib/jobTitleSelection";

/**
 * A "Job title" filter kept in this browser across reloads (`store`: the matrix's or Find technician's).
 * `persons`: the loaded persons, undefined while loading. Returns the filter values (job titles of all
 * loaded persons) and what is selected: the start selection until the user chooses, else their choice
 * without titles nobody has any more.
 */
export function useJobTitleFilter(store: JobTitleStore, persons: { jobTitle: string | null }[] | undefined): { options: string[]; selected: string[] } {
  const stored = useSyncExternalStore(store.subscribe, store.read, () => "");
  const choice = useMemo(() => parseJobTitleSelection(stored), [stored]);
  const options = useMemo(() => jobTitleOptions(persons ?? []), [persons]);
  const selected = useMemo(() => selectedJobTitles(choice, options), [choice, options]);
  // Forget unknown titles in the stored choice too (only with loaded data: before that nothing is known).
  useEffect(() => {
    if (!persons || choice === null) return;
    const known = knownJobTitles(choice, options);
    if (known !== choice) store.save(known);
  }, [persons, choice, options, store]);
  return { options, selected };
}
