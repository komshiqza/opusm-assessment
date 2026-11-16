"use client";

import { useEffect, useState } from "react";
import { Bar, BusyIndicator, Button, Dialog, MessageStrip } from "@ui5/webcomponents-react";
import { loadCertificateFile } from "@/lib/skills/repository";
import { toUserMessage } from "@/lib/errors";
import type { Certificate } from "@/lib/skills/types";
import { saveCertificate } from "./saveCertificate";
import styles from "./AssignmentDialog.module.css";
import { t } from "@/lib/i18n/t";

type Preview = { url: string } | { error: string } | null;

/**
 * Shows a certificate inside the app. FSM sends files with "Content-Disposition: attachment",
 * so a plain link would always download; we load the file and show it from a local blob URL.
 */
export function CertificatePreview({ certificate, onClose }: { certificate: Certificate; onClose: () => void }) {
  const [preview, setPreview] = useState<Preview>(null);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    loadCertificateFile(certificate)
      .then((blob) => {
        url = URL.createObjectURL(blob);
        if (!cancelled) setPreview({ url });
      })
      .catch((e: unknown) => !cancelled && setPreview({ error: toUserMessage(e) }));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [certificate]);

  return (
    <Dialog
      open
      headerText={certificate.fileName}
      onClose={onClose}
      className={styles.previewDialog}
      footer={
        <Bar
          design="Footer"
          endContent={
            <>
              <Button icon="download" onClick={() => saveCertificate(certificate).catch((e: unknown) => setPreview({ error: toUserMessage(e) }))}>
                {t("common.download")}
              </Button>
              <Button design="Emphasized" onClick={onClose}>
                {t("common.close")}
              </Button>
            </>
          }
        />
      }
    >
      {!preview && <BusyIndicator active delay={0} size="L" text="Loading certificate…" className={styles.previewLoading} />}
      {preview && "error" in preview && (
        <MessageStrip design="Negative" hideCloseButton>
          Could not load the certificate. {preview.error}
        </MessageStrip>
      )}
      {preview && "url" in preview &&
        (certificate.type === "PDF" ? (
          <iframe src={preview.url} title={certificate.fileName} className={styles.previewFrame} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- local blob URL, next/image cannot optimise it
          <img src={preview.url} alt={certificate.fileName} className={styles.previewImage} />
        ))}
    </Dialog>
  );
}
