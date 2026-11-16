/** Input validation for the dialogs. Each function returns an error message or null. */
import { OPEN_END_DATE } from "./status";

export const MAX_SKILL_NAME_LENGTH = 100;
/**
 * The brief allows up to 5 MB, but this FSM company rejects attachments above exactly 1 MiB
 * (CA-198, measured: 1,048,576 bytes pass, one byte more fails). We enforce the stricter limit
 * before uploading, so the user is not sent into a guaranteed failure.
 */
export const MAX_CERTIFICATE_BYTES = 1024 * 1024;
export const MAX_CERTIFICATE_LABEL = "1 MB";

/** File extension → FSM `Attachment.type` (upper-case; `.jpg` is stored as JPEG). */
const CERTIFICATE_TYPES: Record<string, string> = {
  pdf: "PDF",
  jpg: "JPEG",
  jpeg: "JPEG",
  png: "PNG",
};
export const CERTIFICATE_ACCEPT = ".pdf,.jpg,.jpeg,.png";

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function validateValidity(from: string | null, to: string | null): string | null {
  if (from && !isValidIsoDate(from)) return "“Valid from” is not a valid date. Use the format DD.MM.YYYY.";
  if (to && !isValidIsoDate(to)) return "“Valid to” is not a valid date. Use the format DD.MM.YYYY.";
  if (to === OPEN_END_DATE) return "9999-12-31 is reserved for “no end date”. Leave “Valid to” empty instead.";
  if (from && to && to < from) return "“Valid to” must not be before “Valid from”.";
  return null;
}

/** The Skill Service needs a start date, so an empty "valid from" means today. */
export function effectiveStartDate(from: string | null, today: string): string {
  return from || today;
}

export function validateSkillName(displayName: string, existingDisplayNames: string[]): string | null {
  const name = displayName.trim();
  if (!name) return "Please enter a name.";
  if (name.length > MAX_SKILL_NAME_LENGTH) return `The name can have at most ${MAX_SKILL_NAME_LENGTH} characters.`;
  if (name.includes("::")) return "The name must not contain “::”.";
  const lower = name.toLowerCase();
  if (existingDisplayNames.some((n) => n.toLowerCase() === lower)) return `A skill named “${name}” already exists.`;
  return null;
}

export type CertificateCheck = { ok: true; type: string } | { ok: false; error: string };

/** Checks type and size of the original file (base64 makes the upload ~33% larger). */
export function validateCertificateFile(file: { name: string; size: number }): CertificateCheck {
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  const type = CERTIFICATE_TYPES[ext];
  if (!type) return { ok: false, error: `${file.name}: only PDF, JPG and PNG files are allowed.` };
  if (file.size === 0) return { ok: false, error: `${file.name}: the file is empty.` };
  if (file.size > MAX_CERTIFICATE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return { ok: false, error: `${file.name}: ${mb} MB is larger than ${MAX_CERTIFICATE_LABEL}, the attachment limit of this FSM company.` };
  }
  return { ok: true, type };
}
