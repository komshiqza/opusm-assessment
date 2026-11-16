"use client";

import { useState } from "react";
import { BusyIndicator, Button, FileUploader, Icon, Link, MessageStrip, Text, Title } from "@ui5/webcomponents-react";
import { deleteCertificate, uploadCertificates } from "@/lib/skills/repository";
import { CERTIFICATE_ACCEPT, MAX_CERTIFICATE_LABEL, splitCertificateFiles } from "@/lib/domain/certificateRules";
import { toUserMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import type { Certificate } from "@/lib/skills/types";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useToast } from "@/components/common/Toast";
import { CertificatePreview } from "./CertificatePreview";
import { saveCertificate } from "./saveCertificate";
import styles from "./AssignmentDialog.module.css";

interface CertificateSectionProps {
  assignmentId: string;
  certificates: Certificate[];
  /** Reloads the list; false when the reload failed. */
  onChanged: () => Promise<boolean>;
  /** A change is done but the list could not be refreshed: the dialog says so and offers a retry. */
  onRefreshFailed: (done: string) => void;
  /** Tells the dialog that an upload or delete is running, so it can block everything else meanwhile. */
  onBusyChange: (busy: boolean) => void;
  /** The dialog's synchronous operation lock: an upload or delete only starts when nothing else runs. */
  operationRef: { current: boolean };
  /** Something else in the dialog is running. */
  locked: boolean;
}

const TYPE_ICON: Record<string, string> = {
  PDF: "pdf-attachment",
  JPEG: "attachment-photo",
  PNG: "attachment-photo",
};
export function CertificateSection({ assignmentId, certificates, onChanged, onRefreshFailed, onBusyChange, operationRef, locked }: CertificateSectionProps) {
  const toast = useToast();
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  /** Files FSM did not answer for in time: maybe uploaded, so the user checks the list first. */
  const [unknownNames, setUnknownNames] = useState<string[]>([]);
  const [toDelete, setToDelete] = useState<Certificate | null>(null);
  const [previewed, setPreviewed] = useState<Certificate | null>(null);
  /** Remounts the file input so the same file can be picked again. */
  const [inputKey, setInputKey] = useState(0);

  const upload = async (files: File[]) => {
    // Busy from the first moment (also while the files are checked), so nothing else can start.
    if (operationRef.current) {
      setInputKey((k) => k + 1);
      return;
    }
    operationRef.current = true;
    onBusyChange(true);
    setProgress("Checking files…");
    try {
      const { valid, problems } = await splitCertificateFiles(files);
      const outcome = await uploadCertificates(assignmentId, valid, (file, i, total) =>
        setProgress(`Uploading ${file.name} (${i + 1} of ${total})…`),
      );
      setErrors([...problems, ...outcome.failed.map((f) => `${f.file.name}: ${f.error}`)]);
      setUnknownNames(outcome.unknown.map((f) => f.file.name));
      const uploaded = outcome.uploaded.length;
      if (uploaded || outcome.unknown.length) {
        setProgress("Refreshing…");
        const what = uploaded ? `${uploaded} certificate${uploaded > 1 ? "s" : ""} uploaded` : "The upload is finished";
        if (!(await onChanged())) onRefreshFailed(what.charAt(0).toUpperCase() + what.slice(1));
        else if (uploaded) toast(what);
      }
    } catch (e) {
      setErrors([toUserMessage(e)]);
    } finally {
      setProgress(null);
      setInputKey((k) => k + 1);
      operationRef.current = false;
      onBusyChange(false);
    }
  };

  return (
    <section className={styles.certificates} aria-labelledby="certificates-title">
      <Title level="H5" id="certificates-title">
        Certificates ({certificates.length})
      </Title>

      {certificates.length === 0 ? (
        <Text className={styles.muted}>No certificate attached yet.</Text>
      ) : (
        <ul className={styles.certList}>
          {certificates.map((c) => (
            <li key={c.id} className={styles.certItem}>
              <Icon name={TYPE_ICON[c.type] ?? "document"} className={styles.certIcon} />
              <span className={styles.certText}>
                <Link onClick={() => setPreviewed(c)} accessibleName={`Open ${c.fileName}`}>
                  {c.fileName}
                </Link>
                <span className={styles.muted}>Uploaded {formatDateTime(c.createdAt)}</span>
              </span>
              <Button
                design="Transparent"
                icon="download"
                tooltip={`Download ${c.fileName}`}
                accessibleName={`Download ${c.fileName}`}
                onClick={() => saveCertificate(c).catch((e: unknown) => setErrors([`${c.fileName}: ${toUserMessage(e)}`]))}
              />
              <Button
                design="Transparent"
                icon="delete"
                tooltip={`Delete ${c.fileName}`}
                accessibleName={`Delete ${c.fileName}`}
                disabled={locked}
                onClick={() => !operationRef.current && setToDelete(c)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className={styles.uploadRow}>
        <FileUploader
          key={inputKey}
          accept={CERTIFICATE_ACCEPT}
          multiple
          hideInput
          disabled={progress !== null || locked}
          onChange={(e) => {
            const files = Array.from(e.detail.files ?? []);
            if (files.length) void upload(files);
          }}
        >
          <Button icon="upload" disabled={progress !== null || locked}>
            Add certificates
          </Button>
        </FileUploader>
        {progress && <BusyIndicator active delay={0} size="S" />}
        <Text className={styles.muted}>{progress ?? `PDF, JPG or PNG, max. ${MAX_CERTIFICATE_LABEL} each`}</Text>
      </div>

      {unknownNames.length > 0 && (
        <MessageStrip design="Critical" onClose={() => setUnknownNames([])}>
          FSM did not answer in time for {unknownNames.join(", ")}. The file may be uploaded or not: check the list above, and upload it again
          only if it is missing.
        </MessageStrip>
      )}
      {errors.length > 0 && (
        <MessageStrip design="Negative" onClose={() => setErrors([])}>
          {errors.length === 1 ? (
            errors[0]
          ) : (
            <>
              {errors.length} files were not uploaded:
              <ul className={styles.errorList}>
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </>
          )}
        </MessageStrip>
      )}

      {previewed && <CertificatePreview certificate={previewed} onClose={() => setPreviewed(null)} />}

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete certificate?"
        confirmText="Delete"
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          // The dialog's lock: no save, upload or removal of the assignment may run at the same time.
          if (operationRef.current) throw new Error("Another action in this dialog is still running. Try again when it has finished.");
          operationRef.current = true;
          onBusyChange(true);
          try {
            try {
              await deleteCertificate(toDelete.id);
            } catch (e) {
              await onChanged(); // show what FSM really has now
              throw e;
            }
            if (await onChanged()) toast("Certificate deleted");
            else onRefreshFailed("The certificate is deleted");
          } finally {
            operationRef.current = false;
            onBusyChange(false);
          }
        }}
      >
        {`“${toDelete?.fileName ?? ""}” will be deleted from FSM. This cannot be undone.`}
      </ConfirmDialog>
    </section>
  );
}
