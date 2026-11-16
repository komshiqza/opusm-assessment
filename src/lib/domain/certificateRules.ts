/**
 * Rules for certificate files, used by the browser (before upload, for an instant message) and by
 * the server (src/lib/fsm/serverOwnership.ts, which decides). One module, so the two cannot drift.
 *
 * A file is accepted when: the extension is .pdf/.jpg/.jpeg/.png, the size is 1 byte … 5 MB, the
 * first bytes are a real PDF/PNG/JPEG, the content type matches the extension, and (on the server)
 * the declared FSM `type` matches the content.
 */
import { t } from "@/lib/i18n/t";

/** The brief's limit per certificate file, on the original (decoded) file. */
export const MAX_CERTIFICATE_BYTES = 5 * 1024 * 1024;
export const MAX_CERTIFICATE_LABEL = "5 MB";
export const CERTIFICATE_ACCEPT = ".pdf,.jpg,.jpeg,.png";

/** FSM `Attachment.type` values the app uses. */
export type CertificateType = "PDF" | "PNG" | "JPEG";

const EXTENSION_TYPES: Record<string, CertificateType> = { pdf: "PDF", jpg: "JPEG", jpeg: "JPEG", png: "PNG" };

/** Magic bytes at the start of each file type. */
const SIGNATURES: Record<CertificateType, number[]> = {
  PDF: [0x25, 0x50, 0x44, 0x46, 0x2d], // "%PDF-"
  PNG: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  JPEG: [0xff, 0xd8, 0xff],
};

/** How many leading bytes the check needs. */
export const SIGNATURE_BYTES = 8;

const TYPE_WORD: Record<CertificateType, string> = { PDF: "PDF", PNG: "PNG", JPEG: "JPG" };

export function typeFromContent(head: Uint8Array): CertificateType | null {
  for (const [type, signature] of Object.entries(SIGNATURES) as [CertificateType, number[]][]) {
    if (head.length >= signature.length && signature.every((byte, i) => head[i] === byte)) return type;
  }
  return null;
}

export function typeFromFileName(fileName: string): CertificateType | null {
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  return EXTENSION_TYPES[ext] ?? null;
}

export type CertificateCheck = { ok: true; type: CertificateType } | { ok: false; error: string; tooLarge?: boolean };

export function checkCertificate(file: { fileName: string; size: number; head: Uint8Array; declaredType?: string }): CertificateCheck {
  const { fileName, size, head, declaredType } = file;
  const byName = typeFromFileName(fileName);
  if (!byName) return { ok: false, error: t("file.wrongType", { name: fileName }) };
  if (size <= 0) return { ok: false, error: t("file.empty", { name: fileName }) };
  if (size > MAX_CERTIFICATE_BYTES) {
    const mb = (size / 1024 / 1024).toFixed(1);
    return { ok: false, tooLarge: true, error: t("file.tooLarge", { name: fileName, mb, max: MAX_CERTIFICATE_LABEL }) };
  }
  const byContent = typeFromContent(head);
  if (!byContent) return { ok: false, error: t("file.notCertificate", { name: fileName }) };
  if (byContent !== byName) {
    return { ok: false, error: t("file.nameMismatch", { name: fileName, type: TYPE_WORD[byContent], ending: fileName.split(".").pop() ?? "" }) };
  }
  if (declaredType !== undefined && declaredType !== byContent) {
    return { ok: false, error: t("file.declaredMismatch", { name: fileName, declared: declaredType, type: byContent }) };
  }
  return { ok: true, type: byContent };
}

/** Browser and tests: checks a picked file, reading only its first bytes. */
export async function inspectCertificateFile(file: Blob & { name: string }): Promise<CertificateCheck> {
  const head = new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer());
  return checkCertificate({ fileName: file.name, size: file.size, head });
}

/** Splits picked files into the ones that may be uploaded and messages for the others. */
export async function splitCertificateFiles<F extends Blob & { name: string }>(files: F[]): Promise<{ valid: F[]; problems: string[] }> {
  const valid: F[] = [];
  const problems: string[] = [];
  for (const file of files) {
    const check = await inspectCertificateFile(file);
    if (check.ok) valid.push(file);
    else problems.push(check.error);
  }
  return { valid, problems };
}
