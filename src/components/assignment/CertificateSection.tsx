"use client";

import { useState } from "react";
import { BusyIndicator, Button, FileUploader, Icon, Link, MessageStrip, Text, Title } from "@ui5/webcomponents-react";
import { deleteCertificate, recheckUploads, retryItems, uploadCertificates, type UploadItem, type UploadOutcome } from "@/lib/skills/certificates";
import { CERTIFICATE_ACCEPT, MAX_CERTIFICATE_LABEL, splitCertificateFiles } from "@/lib/domain/certificateRules";
import { toUserMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import type { Certificate } from "@/lib/skills/types";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useToast } from "@/components/common/Toast";
import { CertificatePreview } from "./CertificatePreview";
import { saveCertificate } from "./saveCertificate";
import { EMPTY_RESULTS, applyOutcome, type UploadResults } from "./uploadResults";
import { UploadResultNotes } from "./UploadResultNotes";
import styles from "./AssignmentDialog.module.css";
import { t, tn } from "@/lib/i18n/t";

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
  /** Picked files the app refused (type, size) and errors that stopped an upload. */
  const [errors, setErrors] = useState<string[]>([]);
  /** Upload results: confirmed late, not uploaded (Try again), not confirmed (Check again). */
  const [results, setResults] = useState<UploadResults>(EMPTY_RESULTS);
  const [toDelete, setToDelete] = useState<Certificate | null>(null);
  const [previewed, setPreviewed] = useState<Certificate | null>(null);
  /** Remounts the file input so the same file can be picked again. */
  const [inputKey, setInputKey] = useState(0);

  /** Runs one upload, retry or check under the dialog's lock, then shows what FSM has now. */
  const runUpload = async (work: () => Promise<{ outcome: UploadOutcome; rerun: File[] | null; problems?: string[] }>) => {
    // Busy from the first moment (also while the files are checked), so nothing else can start.
    if (operationRef.current) {
      setInputKey((k) => k + 1);
      return;
    }
    operationRef.current = true;
    onBusyChange(true);
    try {
      const { outcome, rerun, problems = [] } = await work();
      setErrors(problems);
      setResults((current) => applyOutcome(current, outcome, rerun));
      const uploaded = outcome.uploaded.length;
      if (uploaded) {
        setProgress(t("common.refreshing"));
        const what = tn("certificates.uploaded", uploaded);
        if (await onChanged()) toast(what);
        else onRefreshFailed(what);
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

  const showProgress = (file: File, i: number, total: number) => setProgress(t("assign.uploading", { name: file.name, i: i + 1, total }));

  const send = (items: UploadItem[], rerun: File[] | null, problems: string[] = []) =>
    uploadCertificates(assignmentId, items, showProgress).then((outcome) => ({ outcome, rerun, problems }));

  const upload = (files: File[]) =>
    runUpload(async () => {
      setProgress(t("assign.checkingFiles"));
      const { valid, problems } = await splitCertificateFiles(files);
      return send(valid, null, problems);
    });

  /** Try again for files that are not in FSM; a timed-out one is checked first, never sent twice. */
  const retry = (file: File) => runUpload(() => send(retryItems(results.failed.filter((f) => f.file === file)), [file]));

  /** Check again for uploads that could not be confirmed. Reads only. */
  const checkAgain = (file: File) =>
    runUpload(async () => {
      setProgress(t("common.checkingFsm"));
      return { outcome: await recheckUploads(assignmentId, results.unconfirmed.filter((u) => u.file === file)), rerun: [file] };
    });

  return (
    <section className={styles.certificates} aria-labelledby="certificates-title">
      <Title level="H5" id="certificates-title">
        {t("certificates.title", { n: certificates.length })}
      </Title>

      {certificates.length === 0 ? (
        <Text className={styles.muted}>{t("certificates.none")}</Text>
      ) : (
        <ul className={styles.certList}>
          {certificates.map((c) => (
            <li key={c.id} className={styles.certItem}>
              <Icon name={TYPE_ICON[c.type] ?? "document"} className={styles.certIcon} />
              <span className={styles.certText}>
                <Link onClick={() => setPreviewed(c)} accessibleName={t("certificates.open", { name: c.fileName })}>
                  {c.fileName}
                </Link>
                <span className={styles.muted}>{t("certificates.uploadedAt", { date: formatDateTime(c.createdAt) })}</span>
              </span>
              <Button
                design="Transparent"
                icon="download"
                tooltip={t("certificates.download", { name: c.fileName })}
                accessibleName={t("certificates.download", { name: c.fileName })}
                onClick={() => saveCertificate(c).catch((e: unknown) => setErrors([`${c.fileName}: ${toUserMessage(e)}`]))}
              />
              <Button
                design="Transparent"
                icon="delete"
                tooltip={t("certificates.delete", { name: c.fileName })}
                accessibleName={t("certificates.delete", { name: c.fileName })}
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
            {t("certificates.add")}
          </Button>
        </FileUploader>
        {progress && <BusyIndicator active delay={0} size="S" />}
        <Text className={styles.muted}>{progress ?? t("assign.fileRules", { max: MAX_CERTIFICATE_LABEL })}</Text>
      </div>

      <UploadResultNotes results={results} onRetry={retry} onCheckAgain={checkAgain} locked={locked || progress !== null} />
      {errors.length > 0 && (
        <MessageStrip design="Negative" onClose={() => setErrors([])}>
          {errors.length === 1 ? (
            errors[0]
          ) : (
            <>
              {t("certificates.notUploaded_other", { n: errors.length })}
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
        title={t("certificates.deleteTitle")}
        confirmText={t("common.delete")}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          // The dialog's lock: no save, upload or removal of the assignment may run at the same time.
          if (operationRef.current) throw new Error(t("assign.busy"));
          operationRef.current = true;
          onBusyChange(true);
          try {
            try {
              await deleteCertificate(toDelete.id);
            } catch (e) {
              await onChanged(); // show what FSM really has now
              throw e;
            }
            if (await onChanged()) toast(t("certificates.deleted"));
            else onRefreshFailed(t("certificates.doneDeleted"));
          } finally {
            operationRef.current = false;
            onBusyChange(false);
          }
        }}
      >
        {t("certificates.deleteText", { name: toDelete?.fileName ?? "" })}
      </ConfirmDialog>
    </section>
  );
}
