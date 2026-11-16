"use client";

import { useState } from "react";
import { BusyIndicator, Button, FileUploader, Icon, Link, MessageStrip, Text, Title } from "@ui5/webcomponents-react";
import { attachmentContentUrl } from "@/lib/fsm/client";
import { deleteCertificate, uploadCertificate } from "@/lib/skills/repository";
import { CERTIFICATE_ACCEPT, validateCertificateFile } from "@/lib/domain/validation";
import { toUserMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import type { Certificate } from "@/lib/skills/types";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useToast } from "@/components/common/Toast";
import { CertificatePreview } from "./CertificatePreview";
import styles from "./AssignmentDialog.module.css";

interface CertificateSectionProps {
  assignmentId: string;
  certificates: Certificate[];
  onChanged: () => Promise<void>;
}

const TYPE_ICON: Record<string, string> = {
  PDF: "pdf-attachment",
  JPEG: "attachment-photo",
  PNG: "attachment-photo",
};
export function CertificateSection({ assignmentId, certificates, onChanged }: CertificateSectionProps) {
  const toast = useToast();
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [toDelete, setToDelete] = useState<Certificate | null>(null);
  const [previewed, setPreviewed] = useState<Certificate | null>(null);
  /** Remounts the file input so the same file can be picked again. */
  const [inputKey, setInputKey] = useState(0);

  const upload = async (files: File[]) => {
    const problems: string[] = [];
    const valid = files.filter((f) => {
      const check = validateCertificateFile(f);
      if (!check.ok) problems.push(check.error);
      return check.ok;
    });
    let uploaded = 0;
    for (const [i, file] of valid.entries()) {
      setProgress(`Uploading ${file.name} (${i + 1} of ${valid.length})…`);
      try {
        await uploadCertificate(assignmentId, file);
        uploaded++;
      } catch (e) {
        problems.push(`${file.name}: ${toUserMessage(e)}`);
      }
    }
    setErrors(problems);
    if (uploaded) {
      setProgress("Refreshing…");
      await onChanged();
      toast(`${uploaded} certificate${uploaded > 1 ? "s" : ""} uploaded`);
    }
    setProgress(null);
    setInputKey((k) => k + 1);
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
                onClick={() => window.location.assign(attachmentContentUrl(c.id))}
              />
              <Button
                design="Transparent"
                icon="delete"
                tooltip={`Delete ${c.fileName}`}
                accessibleName={`Delete ${c.fileName}`}
                onClick={() => setToDelete(c)}
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
          disabled={progress !== null}
          onChange={(e) => {
            const files = Array.from(e.detail.files ?? []);
            if (files.length) void upload(files);
          }}
        >
          <Button icon="upload" disabled={progress !== null}>
            Add certificates
          </Button>
        </FileUploader>
        {progress && <BusyIndicator active delay={0} size="S" />}
        <Text className={styles.muted}>{progress ?? "PDF, JPG or PNG, max. 5 MB each"}</Text>
      </div>

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
          await deleteCertificate(toDelete.id);
          await onChanged();
          toast("Certificate deleted");
        }}
      >
        {`“${toDelete?.fileName ?? ""}” will be deleted from FSM. This cannot be undone.`}
      </ConfirmDialog>
    </section>
  );
}
