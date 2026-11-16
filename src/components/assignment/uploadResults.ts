import type { UploadOutcome } from "@/lib/skills/repository";

/** Upload results a dialog shows until the user dismisses them. */
export interface UploadResults {
  /** names of files FSM answered too late for, found in FSM ("Uploaded ✓") */
  confirmedLate: string[];
  /** not in FSM: the user may try again */
  failed: UploadOutcome["failed"];
  /** FSM answered too late and the check could not decide: only "Check again" */
  unconfirmed: UploadOutcome["unconfirmed"];
}

export const EMPTY_RESULTS: UploadResults = { confirmedLate: [], failed: [], unconfirmed: [] };

/**
 * Adds an outcome to what is shown. `rerun` says which list the outcome answers: a retry of the
 * "not uploaded" files replaces that list, a "Check again" replaces the "not confirmed" list.
 */
export function applyOutcome(current: UploadResults, outcome: UploadOutcome, rerun: "failed" | "unconfirmed" | null): UploadResults {
  return {
    confirmedLate: [...current.confirmedLate, ...outcome.confirmedLate.map((f) => f.name)],
    failed: [...(rerun === "failed" ? [] : current.failed), ...outcome.failed],
    unconfirmed: [...(rerun === "unconfirmed" ? [] : current.unconfirmed), ...outcome.unconfirmed],
  };
}
