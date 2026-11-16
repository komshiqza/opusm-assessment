import type { UploadOutcome } from "@/lib/skills/certificates";
import { t } from "@/lib/i18n/t";

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
 * Adds an outcome to what is shown. `rerun`: the files a retry or "Check again" was for; their old
 * lines are replaced by the new outcome.
 */
export function applyOutcome(current: UploadResults, outcome: UploadOutcome, rerun: File[] | null): UploadResults {
  const keep = <T extends { file: File }>(list: T[]) => (rerun ? list.filter((x) => !rerun.includes(x.file)) : list);
  return {
    confirmedLate: [...current.confirmedLate, ...outcome.confirmedLate.map((f) => f.name)],
    failed: [...keep(current.failed), ...outcome.failed],
    unconfirmed: [...keep(current.unconfirmed), ...outcome.unconfirmed],
  };
}

/** One short message line: icon by kind, the file name, and its own button (none for "uploaded"). */
export interface ResultLine {
  kind: "uploaded" | "notUploaded" | "unconfirmed";
  text: string;
  /** technical reason, only as tooltip and for screen readers */
  detail?: string;
  /** the file the line's button acts on */
  file: File | null;
}

/**
 * The short lines Rosen asked for: "<file> uploaded.", "<file> was not uploaded." (Try again),
 * "Couldn’t confirm <file>." (Check again). A timeout's technical reason is not in the text; a file
 * FSM refused for a reason (e.g. too large) keeps that short reason, so the user knows what to fix.
 */
export function resultLines(results: UploadResults): ResultLine[] {
  return [
    ...results.confirmedLate.map((name): ResultLine => ({ kind: "uploaded", text: t("result.uploaded", { name }), file: null })),
    ...results.failed.map(
      (f): ResultLine =>
        f.uploadId !== undefined
          ? { kind: "notUploaded", text: t("result.notUploaded", { name: f.file.name }), detail: f.error, file: f.file }
          : { kind: "notUploaded", text: t("result.notUploadedReason", { name: f.file.name, reason: f.error }), file: f.file },
    ),
    ...results.unconfirmed.map((u): ResultLine => ({ kind: "unconfirmed", text: t("result.unconfirmed", { name: u.file.name }), detail: u.error, file: u.file })),
  ];
}

/** The same three lines for a new assignment FSM answered too late for. */
export function createResultLine(check: { result: "done" | "notDone" | "unconfirmed"; error?: string }): Omit<ResultLine, "file"> {
  if (check.result === "done") return { kind: "uploaded", text: t("result.assigned") };
  if (check.result === "notDone") return { kind: "notUploaded", text: t("result.notAssigned") };
  return { kind: "unconfirmed", text: t("result.assignUnconfirmed"), detail: check.error };
}
