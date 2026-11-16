"use client";

import { useEffect, useState } from "react";
import { Bar, BusyIndicator, Button, Dialog, MessageStrip } from "@ui5/webcomponents-react";
import { attachmentContentUrl } from "@/lib/fsm/client";
import type { Certificate } from "@/lib/skills/types";
import styles from "./AssignmentDialog.module.css";

const MIME_TYPE: Record<string, string> = { PDF: "application/pdf", JPEG: "image/jpeg", PNG: "image/png" };

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
    fetch(attachmentContentUrl(certificate.id))
      .then(async (res) => {
        if (!res.ok) throw new Error(`FSM answered with HTTP ${res.status}.`);
        const blob = new Blob([await res.arrayBuffer()], { type: MIME_TYPE[certificate.type] ?? "application/octet-stream" });
        url = URL.createObjectURL(blob);
        if (!cancelled) setPreview({ url });
      })
      .catch((e: unknown) => !cancelled && setPreview({ error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [certificate.id, certificate.type]);

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
              <Button icon="download" onClick={() => window.location.assign(attachmentContentUrl(certificate.id))}>
                Download
              </Button>
              <Button design="Emphasized" onClick={onClose}>
                Close
              </Button>
            </>
          }
        />
      }
    >
      {!preview && <BusyIndicator active delay={0} size="L" text="Loading certificate…" className={styles.previewLoading} />}
      {preview && "error" in preview && (
        <MessageStrip design="Negative" hideCloseButton>
          Could not load the certificate: {preview.error}
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
