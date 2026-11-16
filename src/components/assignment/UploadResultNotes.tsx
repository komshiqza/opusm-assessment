"use client";

import { Button, MessageStrip } from "@ui5/webcomponents-react";
import { resultLines, type ResultLine, type UploadResults } from "./uploadResults";
import styles from "./AssignmentDialog.module.css";

const DESIGN = { uploaded: "Positive", notUploaded: "Negative", unconfirmed: "Critical" } as const;

/** One short line with icon (MessageStrip design), the technical reason only as tooltip and for screen readers. */
export function ResultStrip({ line, action, locked }: { line: Omit<ResultLine, "file">; action?: { text: string; onClick: () => void }; locked: boolean }) {
  return (
    <MessageStrip design={DESIGN[line.kind]} hideCloseButton title={line.detail}>
      {line.text}
      {line.detail && <span className={styles.srOnly}> Details: {line.detail}</span>}
      {action && (
        <>
          {" "}
          <Button design="Transparent" icon="refresh" onClick={action.onClick} disabled={locked}>
            {action.text}
          </Button>
        </>
      )}
    </MessageStrip>
  );
}

interface UploadResultNotesProps {
  results: UploadResults;
  /** Uploads this file again (after a timeout, the earlier upload is checked first, never sent twice). */
  onRetry: (file: File) => void;
  /** Checks this file in FSM again; reads only. */
  onCheckAgain: (file: File) => void;
  locked: boolean;
}

/** "<file> uploaded." / "<file> was not uploaded." with Try again / "Couldn’t confirm <file>." with Check again. */
export function UploadResultNotes({ results, onRetry, onCheckAgain, locked }: UploadResultNotesProps) {
  return (
    <>
      {resultLines(results).map((line, i) => {
        const file = line.file;
        const action =
          file && line.kind === "notUploaded"
            ? { text: "Try again", onClick: () => onRetry(file) }
            : file && line.kind === "unconfirmed"
              ? { text: "Check again", onClick: () => onCheckAgain(file) }
              : undefined;
        return <ResultStrip key={`${line.kind}-${i}`} line={line} action={action} locked={locked} />;
      })}
    </>
  );
}
