"use client";

import { useEffect, useState } from "react";
import { Bar, BusyIndicator, Button, Dialog, MessageStrip } from "@ui5/webcomponents-react";
import { loadCertificateFile } from "@/lib/skills/certificates";
import { toUserMessage } from "@/lib/errors";
import type { Certificate } from "@/lib/skills/types";
import { saveCertificate } from "./saveCertificate";
import { loadBlobUrl } from "./blobUrl";
import styles from "./AssignmentDialog.module.css";
import { t } from "@/lib/i18n/t";

type Preview = { url: string } | { error: string } | null;

/**
 * Shows a certificate inside the app. FSM sends files with "Content-Disposition: attachment",
 * so a plain link would always download; we load the file and show it from a local blob URL.
 */
export function CertificatePreview({ certificate, onClose }: { certificate: Certificate; onClose: () => void }) {
  const [preview, setPreview] = useState<Preview>(null);

  useEffect(
    () =>
      loadBlobUrl(
        () => loadCertificateFile(certificate),
        (url) => setPreview({ url }),
        (e) => setPreview({ error: toUserMessage(e) }),
      ),
    [certificate],
  );

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
      {!preview && <BusyIndicator active delay={0} size="L" text={t("certificates.loading")} className={styles.previewLoading} />}
      {preview && "error" in preview && (
        <MessageStrip design="Negative" hideCloseButton>
          {t("certificates.loadFailed", { error: preview.error })}
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
