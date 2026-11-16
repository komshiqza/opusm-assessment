"use client";

import { useRef, useState, type ReactNode } from "react";
import { Bar, BusyIndicator, Button, Dialog, MessageStrip, Text } from "@ui5/webcomponents-react";
import { toUserMessage } from "@/lib/errors";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmText: string;
  /** Runs when the user confirms. Errors are shown in the dialog, which then stays open. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
  /** e.g. while the impact of a delete is still being loaded */
  confirmDisabled?: boolean;
}

/** Confirmation for destructive actions: locks itself while running and keeps errors visible. */
export function ConfirmDialog({ open, title, children, confirmText, onConfirm, onClose, confirmDisabled }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  /** Same as `busy`, but readable synchronously in UI5's before-close event (state would be stale there). */
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const setRunning = (running: boolean) => {
    busyRef.current = running;
    setBusy(running);
  };

  const close = () => {
    if (busyRef.current) return;
    setError(null);
    onClose();
  };

  const confirm = async () => {
    setRunning(true);
    setError(null);
    try {
      await onConfirm();
      setRunning(false);
      onClose();
    } catch (e) {
      setError(toUserMessage(e));
      setRunning(false);
    }
  };

  return (
    <Dialog
      open={open}
      headerText={title}
      state="Critical"
      onBeforeClose={(e) => busyRef.current && e.preventDefault()}
      onClose={close}
      style={{ maxWidth: "32rem" }}
      footer={
        <Bar
          design="Footer"
          endContent={
            <>
              <Button design="Negative" onClick={confirm} disabled={busy || confirmDisabled}>
                {confirmText}
              </Button>
              <Button design="Transparent" onClick={close} disabled={busy}>
                Cancel
              </Button>
            </>
          }
        />
      }
    >
      <BusyIndicator active={busy} delay={0} style={{ display: "block" }}>
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {typeof children === "string" ? <Text>{children}</Text> : children}
          {error && (
            <MessageStrip design="Negative" hideCloseButton>
              {error}
            </MessageStrip>
          )}
        </div>
      </BusyIndicator>
    </Dialog>
  );
}
