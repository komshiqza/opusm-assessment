"use client";

import { Button, MessageStrip } from "@ui5/webcomponents-react";
import type { ReactNode } from "react";
import type { UploadResults } from "./uploadResults";
import styles from "./AssignmentDialog.module.css";

interface UploadResultNotesProps {
  results: UploadResults;
  onChange: (next: UploadResults) => void;
  /** Uploads the "not uploaded" files again (a timed-out one is checked first, never sent twice). */
  onRetry: () => void;
  /** Checks the "not confirmed" files in FSM again; reads only. */
  onCheckAgain: () => void;
  locked: boolean;
  /** Text before the list of files that were not uploaded. */
  failedIntro?: ReactNode;
}

/**
 * What happened to uploads, each with icon and text (MessageStrip): "Uploaded ✓" for files FSM
 * answered too late for but has, "Not uploaded" with Try again, "Not confirmed yet" with Check again.
 */
export function UploadResultNotes({ results, onChange, onRetry, onCheckAgain, locked, failedIntro }: UploadResultNotesProps) {
  const { confirmedLate, failed, unconfirmed } = results;
  return (
    <>
      {confirmedLate.length > 0 && (
        <MessageStrip design="Positive" onClose={() => onChange({ ...results, confirmedLate: [] })}>
          Uploaded ✓ {confirmedLate.join(", ")}. FSM answered too late, but the app checked: the file is in FSM.
        </MessageStrip>
      )}
      {unconfirmed.length > 0 && (
        <MessageStrip design="Critical" hideCloseButton>
          Not confirmed yet: FSM answered too late for {unconfirmed.map((u) => u.file.name).join(", ")}, and the check could not tell whether
          the file arrived ({unconfirmed[0].error}). Nothing is uploaded again until this is clear.{" "}
          <Button icon="refresh" onClick={onCheckAgain} disabled={locked}>
            Check again
          </Button>
        </MessageStrip>
      )}
      {failed.length > 0 && (
        <MessageStrip design="Negative" onClose={() => onChange({ ...results, failed: [] })}>
          {failedIntro}
          {failed.length === 1 ? "This file was not uploaded:" : `These ${failed.length} files were not uploaded:`}
          <ul className={styles.errorList}>
            {failed.map((f, i) => (
              <li key={i}>
                {f.file.name}: {f.error}
              </li>
            ))}
          </ul>
          <Button icon="refresh" onClick={onRetry} disabled={locked}>
            Try again
          </Button>
        </MessageStrip>
      )}
    </>
  );
}
