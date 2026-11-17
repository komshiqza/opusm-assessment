/**
 * Certificates (FSM Attachments on our Skills): upload with its own upload id, the check after an
 * upload FSM did not answer, "Check again", download and delete. Every write passes the guard first.
 */
import { FsmTimeoutError, fileToBase64, fsmAttachmentContent, fsmCreate, fsmDelete, fsmQuery } from "@/lib/fsm/client";
import type { FsmAttachment } from "@/lib/fsm/types";
import { assertFsmId } from "@/lib/fsm/guard";
import { inspectCertificateFile } from "@/lib/domain/certificateRules";
import { toUserMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/t";
import type { AssignmentInput, Certificate } from "./types";
import { assertOwnAttachment, assertOwnSkill, createAssignmentForPerson, toCertificate, type WriteCheck } from "./repository";
import type { Assignment } from "./types";

/** Uploads one file. `uploadId` goes into the description, so a check after a timeout can find this upload. */
export async function uploadCertificate(assignmentId: string, file: File, uploadId: string = newUploadId()): Promise<Certificate> {
  const check = await inspectCertificateFile(file);
  if (!check.ok) throw new Error(check.error);
  await assertOwnSkill(assignmentId);
  const created = await fsmCreate<FsmAttachment>("Attachment", {
    fileName: file.name,
    title: file.name,
    description: uploadDescription(uploadId),
    type: check.type,
    fileContent: await fileToBase64(file),
    object: { objectId: assignmentId, objectType: "SKILL" },
  });
  return toCertificate({ ...created, object: created.object ?? { objectId: assignmentId, objectType: "SKILL" } });
}

export interface UploadOutcome {
  /** Certificates now in FSM, including ones confirmed after FSM answered too late. */
  uploaded: Certificate[];
  /** Files FSM answered too late for, but the check found them in FSM ("Uploaded ✓"). */
  confirmedLate: File[];
  /**
   * Files that are not in FSM, with the reason for the user; the user may try again.
   * `uploadId`: the upload timed out; a retry first looks for this id, so a file that arrived late
   * is not uploaded twice.
   */
  failed: { file: File; error: string; uploadId?: string }[];
  /** FSM answered too late and the check could not decide ("Not confirmed yet"): never retried, only checked again. */
  unconfirmed: { file: File; error: string; uploadId: string }[];
}

/** A file to upload; after a timed-out upload, with that upload's id. */
export type UploadItem = File | { file: File; uploadId: string };

/** The "not uploaded" files as retry items: a timed-out one keeps its upload id, so the retry checks first. */
export function retryItems(failed: UploadOutcome["failed"]): UploadItem[] {
  return failed.map((f) => (f.uploadId === undefined ? f.file : { file: f.file, uploadId: f.uploadId }));
}


/**
 * Every upload gets its own id in the attachment's description, so a check after a timeout finds
 * exactly this upload: another file with the same name can never be taken for it. (Measured: the
 * Query API finds an attachment by its description right after the upload.)
 */
const UPLOAD_ID = /^[0-9a-f]{32}$/;
const uploadDescription = (uploadId: string) => `Skill Management upload ${uploadId}`;
const newUploadId = () => crypto.randomUUID().replaceAll("-", "");

const sha256 = async (data: ArrayBuffer) => new Uint8Array(await crypto.subtle.digest("SHA-256", data)).join(",");

/** The stored content is exactly the file: same size first, then the same SHA-256 (measured: FSM returns the bytes unchanged). */
async function sameBytes(attachmentId: string, file: File): Promise<boolean> {
  const stored = await fsmAttachmentContent(attachmentId);
  if (stored.size !== file.size) return false;
  const [a, b] = await Promise.all([stored.arrayBuffer(), file.arrayBuffer()]);
  return (await sha256(a)) === (await sha256(b));
}

/**
 * Did the upload with this id arrive? Reads only. The attachment must carry this upload's id, which
 * is new for every upload, so a file that was there before (even the same file, uploaded on purpose
 * earlier) never counts. Its content must also be byte for byte the file: otherwise, or when the
 * content cannot be read, the answer is "not confirmed", never a guess.
 */
export async function checkCertificateUploaded(assignmentId: string, uploadId: string, file: File): Promise<WriteCheck<Certificate>> {
  try {
    assertFsmId(assignmentId);
    if (!UPLOAD_ID.test(uploadId)) throw new Error("Invalid upload id.");
    const rows = await fsmQuery<{ a: FsmAttachment }>(
      `SELECT a.id, a.fileName, a.type, a.createDateTime, a.object FROM Attachment a WHERE a.object.objectType = 'SKILL' AND a.object.objectId = '${assignmentId}' AND a.description = '${uploadDescription(uploadId)}'`,
      ["Attachment"],
    );
    if (rows.length === 0) return { result: "notDone" };
    if (rows.length > 1) return { result: "unconfirmed", error: t("upload.moreThanOne") };
    assertFsmId(rows[0].a.id);
    if (!(await sameBytes(rows[0].a.id, file))) {
      return { result: "unconfirmed", error: t("upload.contentDiffers") };
    }
    return { result: "done", value: toCertificate(rows[0].a) };
  } catch (e) {
    return { result: "unconfirmed", error: toUserMessage(e) };
  }
}

const NOT_UPLOADED = () => t("upload.notInFsm");

/** Sorts one check result into the outcome lists. */
function recordCheck(outcome: UploadOutcome, file: File, uploadId: string, check: WriteCheck<Certificate>): void {
  if (check.result === "done") {
    outcome.uploaded.push(check.value);
    outcome.confirmedLate.push(file);
  } else if (check.result === "notDone") {
    outcome.failed.push({ file, error: NOT_UPLOADED(), uploadId });
  } else {
    outcome.unconfirmed.push({ file, error: check.error, uploadId });
  }
}

/**
 * Uploads files one after another to one assignment. A failed file does not stop the others; it is
 * returned with FSM's message so the user can retry exactly those files. A file FSM does not answer
 * for is looked up in FSM right away (read only) and never sent again by the app itself.
 */
export async function uploadCertificates(
  assignmentId: string,
  items: UploadItem[],
  onProgress?: (file: File, index: number, total: number) => void,
): Promise<UploadOutcome> {
  const outcome: UploadOutcome = { uploaded: [], confirmedLate: [], failed: [], unconfirmed: [] };
  for (const [index, item] of items.entries()) {
    const file = item instanceof File ? item : item.file;
    onProgress?.(file, index, items.length);
    if (!(item instanceof File)) {
      // A retry after a timeout: first make sure the earlier upload did not arrive late.
      const check = await checkCertificateUploaded(assignmentId, item.uploadId, file);
      if (check.result !== "notDone") {
        recordCheck(outcome, file, item.uploadId, check);
        continue;
      }
    }
    const uploadId = newUploadId();
    try {
      outcome.uploaded.push(await uploadCertificate(assignmentId, file, uploadId));
    } catch (e) {
      if (e instanceof FsmTimeoutError && e.write) recordCheck(outcome, file, uploadId, await checkCertificateUploaded(assignmentId, uploadId, file));
      else outcome.failed.push({ file, error: toUserMessage(e) });
    }
  }
  return outcome;
}

/** "Check again" for uploads that could not be confirmed. Reads only; uploads nothing. */
export async function recheckUploads(assignmentId: string, unconfirmed: UploadOutcome["unconfirmed"]): Promise<UploadOutcome> {
  const outcome: UploadOutcome = { uploaded: [], confirmedLate: [], failed: [], unconfirmed: [] };
  for (const { file, uploadId } of unconfirmed) recordCheck(outcome, file, uploadId, await checkCertificateUploaded(assignmentId, uploadId, file));
  return outcome;
}


/**
 * Assign a skill and upload its certificates in one step for the user. FSM needs the assignment
 * first, because an attachment is linked to a skill id. If creating the assignment fails, nothing
 * is uploaded; if an upload fails, the assignment stays and the failed files are returned.
 */
export async function createAssignmentWithCertificates(
  tagId: string,
  /** The person's refId: the assignment goes to the person's current main record (see createAssignmentForPerson). */
  personRefId: string,
  input: AssignmentInput,
  files: File[],
  onProgress?: (file: File, index: number, total: number) => void,
): Promise<{ assignment: Assignment } & UploadOutcome> {
  const assignment = await createAssignmentForPerson(tagId, personRefId, input);
  return { assignment, ...(await uploadCertificates(assignment.id, files, onProgress)) };
}

const CERTIFICATE_MIME: Record<string, string> = { PDF: "application/pdf", JPEG: "image/jpeg", PNG: "image/png" };

/** The certificate file with the right content type, so the browser can show it (read only). */
export async function loadCertificateFile(certificate: Certificate): Promise<Blob> {
  assertFsmId(certificate.id);
  const blob = await fsmAttachmentContent(certificate.id);
  return new Blob([blob], { type: CERTIFICATE_MIME[certificate.type] ?? "application/octet-stream" });
}

export async function deleteCertificate(attachmentId: string): Promise<void> {
  await assertOwnAttachment(attachmentId);
  await fsmDelete("Attachment", attachmentId);
}
