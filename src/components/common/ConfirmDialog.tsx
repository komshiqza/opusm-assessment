"use client";

import { useState, type ReactNode } from "react";
import { Bar, BusyIndicator, Button, Dialog, MessageStrip, Text } from "@ui5/webcomponents-react";
import { toUserMessage } from "@/lib/errors";
import { createOperationLock } from "@/lib/operationLock";

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
  /**
   * Same as `busy`, but synchronous: a second click on Delete before React re-renders is ignored,
   * and UI5's before-close event (where state would be stale) can read it.
   */
  const [lock] = useState(createOperationLock);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (lock.running) return;
    setError(null);
    onClose();
  };

  const confirm = async () => {
    const done = await lock.run(async () => {
      setBusy(true);
      setError(null);
      try {
        await onConfirm();
        return true;
      } catch (e) {
        setError(toUserMessage(e));
        return false;
      } finally {
        setBusy(false);
      }
    });
    // After the lock is released: UI5's before-close check must not block this close.
    if (done) onClose();
  };

  return (
    <Dialog
      open={open}
      headerText={title}
      state="Critical"
      onBeforeClose={(e) => lock.running && e.preventDefault()}
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
