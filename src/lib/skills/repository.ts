/**
 * All FSM access of the app. UI components never call the FSM client directly.
 *
 * Which API for what (details in README.md):
 * - Query API:     persons, certificates (one query for many skills)
 * - Skill Service: tags (incl. scaleId), skills (incl. proficiency), scales and levels; tag and skill writes
 * - Data API:      attachments (upload, download, delete); the only API that handles files
 *
 * Every write first re-reads its target from FSM and passes it through the guard in
 * `src/lib/fsm/guard.ts`. If the check fails, the write request is never sent.
 */
import { FsmTimeoutError, assertBulkOk, fileToBase64, fsmAttachmentContent, fsmCreate, fsmDelete, fsmGet, fsmQuery, skillApi, skillSearch } from "@/lib/fsm/client";
import type { FsmAttachment, FsmPerson, SkillServiceProficiency, SkillServiceScale, SkillServiceSkill, SkillServiceTag } from "@/lib/fsm/types";
import { NAME_PREFIX, fromScopedName, isOwnName, toScopedName } from "@/lib/candidate";
import { OwnershipError, assertFsmId, assertOwnName, assertOwnedByTagName } from "@/lib/fsm/guard";
import { normalizeEndDate, OPEN_END_DATE, todayIso } from "@/lib/domain/status";
import { effectiveStartDate, validateSkillName, validateValidity } from "@/lib/domain/validation";
import { inspectCertificateFile } from "@/lib/domain/certificateRules";
import { toUserMessage } from "@/lib/errors";
import type { Assignment, AssignmentInput, Certificate, Person, ProficiencyScale, SkillDefinition } from "./types";

/** One scale for all our skills. */
export const SCALE_NAME = toScopedName("Proficiency");
const SCALE_LEVELS = [{ name: "Basic", isDefault: true }, { name: "Advanced" }, { name: "Expert" }];

/** Ids per `IN (...)` list in CoreSQL. */
const IN_CHUNK = 100;

// --- Reads ------------------------------------------------------------------------

export async function loadPersons(): Promise<Person[]> {
  const rows = await fsmQuery<{ p: FsmPerson & { userName?: string | null; refId?: string | null } }>(
    "SELECT p.id, p.refId, p.firstName, p.lastName, p.jobTitle, p.type, p.userName FROM Person p WHERE p.inactive = false",
    ["Person"],
  );
  return rows
    .map(({ p }) => ({
      id: p.id,
      name: [p.firstName, p.lastName].filter(Boolean).join(" ") || p.userName || "Unnamed person",
      jobTitle: p.jobTitle ?? null,
      type: p.type ?? null,
      refId: p.refId ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.type ?? "").localeCompare(b.type ?? ""));
}

function likeOwn(field: string) {
  return [{ field, operator: "like", value: `${NAME_PREFIX}%` }];
}

export async function loadSkillDefinitions(): Promise<SkillDefinition[]> {
  const tags = await skillSearch<SkillServiceTag>("v1/tags", likeOwn("name"));
  return tags
    .filter((t) => !t.deleted && isOwnName(t.name)) // LIKE may be case-insensitive: re-check exactly
    .map(toSkillDefinition)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function toSkillDefinition(t: SkillServiceTag): SkillDefinition {
  return {
    id: t.id,
    name: fromScopedName(t.name),
    description: t.description?.trim() ? t.description.trim() : null, // FSM stores " " for "no description"
    scaleId: t.scaleId ?? null,
  };
}

export async function loadAssignments(): Promise<Assignment[]> {
  const skills = await skillSearch<SkillServiceSkill & { deleted?: boolean }>("v1/skills", likeOwn("tag.name"));
  return skills.filter((s) => !s.deleted && isOwnName(s.tagName)).map(toAssignment);
}

function toAssignment(s: SkillServiceSkill): Assignment {
  return {
    id: s.id,
    tagId: s.tagId,
    personId: s.technicianId,
    startDate: s.startDate || null,
    endDate: normalizeEndDate(s.endDate),
    proficiencyId: s.proficiencyId ?? null,
    proficiencyName: s.proficiencyName ?? null,
    proficiencyLevel: s.proficiencyLevel ?? null,
  };
}

/** Certificates of many skills with one query per 100 skill ids (no call per cell). */
export async function loadCertificates(skillIds: string[]): Promise<Certificate[]> {
  const ids = skillIds.filter((id) => /^[0-9A-F]{32}$/i.test(id));
  const out: Certificate[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const list = ids.slice(i, i + IN_CHUNK).map((id) => `'${id}'`).join(", ");
    const rows = await fsmQuery<{ a: FsmAttachment }>(
      `SELECT a.id, a.fileName, a.type, a.createDateTime, a.object FROM Attachment a WHERE a.object.objectType = 'SKILL' AND a.object.objectId IN (${list})`,
      ["Attachment"],
    );
    out.push(...rows.map(({ a }) => toCertificate(a)));
  }
  return out.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

function toCertificate(a: FsmAttachment): Certificate {
  return { id: a.id, skillId: a.object.objectId, fileName: a.fileName, type: a.type, createdAt: a.createDateTime ?? null };
}

/** Our proficiency scale with its levels, or null if it does not exist yet. */
export async function loadScale(): Promise<ProficiencyScale | null> {
  const scales = await skillSearch<SkillServiceScale>("v1/scales", [{ field: "name", operator: "=", value: SCALE_NAME }]);
  const scale = scales.find((s) => !s.deleted && s.name === SCALE_NAME);
  if (!scale) return null;
  return { id: scale.id, levels: await loadLevels(scale.id) };
}

async function loadLevels(scaleId: string) {
  const levels = await skillSearch<SkillServiceProficiency>(`v1/scales/${scaleId}/proficiencies`);
  return levels
    .map((l) => ({ id: l.id, name: l.name, level: l.level, isDefault: l.isDefault }))
    .sort((a, b) => a.level - b.level);
}

// --- Ownership lookups (fresh from FSM, right before a write) ---------------------------
// Tags and Skills are read from the Skill Service, Attachments from the Data API: both answer
// immediately after a write. The Query API shows Skills and Tags written through the Skill
// Service only 1-3 seconds later, so it is not used here.

async function assertOwnTag(tagId: string): Promise<void> {
  assertFsmId(tagId);
  const tags = await skillSearch<SkillServiceTag>("v1/tags", [{ field: "id", operator: "=", value: tagId }]);
  const tag = tags.find((t) => t.id === tagId && !t.deleted);
  if (!tag) throw new OwnershipError("Refused: this skill no longer exists in FSM. Reload the page.");
  assertOwnName(tag.name, "Tag");
}

async function assertOwnSkill(skillId: string): Promise<{ tagId: string }> {
  assertFsmId(skillId);
  const skills = await skillSearch<SkillServiceSkill & { deleted?: boolean }>("v1/skills", [{ field: "id", operator: "=", value: skillId }]);
  const skill = skills.find((s) => s.id === skillId && !s.deleted) ?? null;
  assertOwnedByTagName(skill, "Skill");
  return { tagId: skill!.tagId };
}

async function assertOwnAttachment(attachmentId: string): Promise<void> {
  assertFsmId(attachmentId);
  const attachment = await fsmGet<FsmAttachment>("Attachment", attachmentId);
  if (!attachment || attachment.object?.objectType !== "SKILL") {
    throw new OwnershipError("Refused: the certificate was not found or is not attached to a skill.");
  }
  await assertOwnSkill(attachment.object.objectId);
}

// --- Writes: scale -------------------------------------------------------------------

/** Returns our scale, creating it (Basic / Advanced / Expert) on first use. */
export async function ensureScale(): Promise<ProficiencyScale> {
  const existing = await loadScale();
  if (existing) return existing;
  assertOwnName(SCALE_NAME, "Scale");
  const id = await skillApi<string>("v1/scales", { method: "POST", body: { name: SCALE_NAME, proficiencies: SCALE_LEVELS } });
  return { id, levels: await loadLevels(id) };
}

// --- Writes: skill definitions (Tags) ---------------------------------------------------

/**
 * The dialog checks names against the loaded list, which is out of date if a reload failed or
 * another tab created a skill meanwhile. This checks FSM itself right before the write.
 */
async function assertNameIsFree(displayName: string, exceptTagId?: string): Promise<void> {
  const others = (await loadSkillDefinitions()).filter((d) => d.id !== exceptTagId).map((d) => d.name);
  const problem = validateSkillName(displayName, others);
  if (problem) throw new Error(problem);
}

export async function createSkillDefinition(displayName: string, description: string): Promise<SkillDefinition> {
  const name = toScopedName(displayName);
  assertOwnName(name, "Tag");
  await assertNameIsFree(displayName);
  const scale = await ensureScale();
  const [tag] = assertBulkOk<SkillServiceTag>(
    await skillApi("v2/tags", { method: "POST", body: [{ name, description: description.trim() || undefined, scaleId: scale.id }] }),
  );
  return toSkillDefinition(tag);
}

export async function updateSkillDefinition(tagId: string, displayName: string, description: string): Promise<SkillDefinition> {
  await assertOwnTag(tagId);
  const name = toScopedName(displayName);
  assertOwnName(name, "Tag");
  await assertNameIsFree(displayName, tagId);
  const scale = await ensureScale();
  const [tag] = assertBulkOk<SkillServiceTag>(
    await skillApi("v2/tags", {
      method: "POST",
      body: [{ id: tagId, name, description: description.trim() || " ", scaleId: scale.id }],
    }),
  );
  return toSkillDefinition(tag);
}

export interface DeleteImpact {
  assignments: number;
  certificates: number;
}

/** What deleting a skill definition would remove, with the ids (shown in the confirmation dialog). */
export interface DeleteTargets extends DeleteImpact {
  skillIds: string[];
  certificateIds: string[];
}

/** FSM has more assignments or certificates for the skill than the user confirmed. Nothing was deleted. */
export class DeleteImpactChangedError extends Error {
  constructor(public readonly impact: DeleteTargets) {
    super(
      `Since you opened this dialog, the skill got more assignments or certificates in FSM (now ${impact.assignments} assignment(s) and ${impact.certificates} certificate(s)). Nothing was deleted. Check the new numbers and confirm again.`,
    );
    this.name = "DeleteImpactChangedError";
  }
}

/** What deleting a skill definition would remove (shown in the confirmation dialog). */
export async function getDeleteImpact(tagId: string): Promise<DeleteTargets> {
  assertFsmId(tagId);
  const skills = await skillSearch<SkillServiceSkill & { deleted?: boolean }>("v1/skills", [{ field: "tag.id", operator: "=", value: tagId }]);
  const skillIds = skills.filter((s) => !s.deleted && s.tagId === tagId).map((s) => s.id);
  const certificateIds = (await loadCertificates(skillIds)).map((c) => c.id);
  return { assignments: skillIds.length, certificates: certificateIds.length, skillIds, certificateIds };
}

/**
 * Deletes a skill definition including its assignments and their certificates
 * (certificates → assignments → tag). FSM itself refuses to delete a Tag that still has Skills.
 * `confirmed` is what the user saw and confirmed: if FSM now has an assignment or certificate that
 * is not in it, nothing is deleted and DeleteImpactChangedError carries the new numbers.
 * Stops at the first failure and reports what was already deleted (that part cannot be undone).
 */
export async function deleteSkillDefinition(tagId: string, confirmed: Pick<DeleteTargets, "skillIds" | "certificateIds">): Promise<DeleteImpact> {
  await assertOwnTag(tagId);
  // Skills of an own tag are own skills, and their attachments are own attachments.
  const current = await getDeleteImpact(tagId);
  const { skillIds, certificateIds } = current;
  const unconfirmed = skillIds.some((id) => !confirmed.skillIds.includes(id)) || certificateIds.some((id) => !confirmed.certificateIds.includes(id));
  if (unconfirmed) throw new DeleteImpactChangedError(current);
  const done: DeleteImpact = { assignments: 0, certificates: 0 };
  try {
    for (const id of certificateIds) {
      await fsmDelete("Attachment", id);
      done.certificates++;
    }
    if (skillIds.length) {
      const res = await skillApi<BulkResponse>("v2/skills", { method: "DELETE", body: skillIds.map((id) => ({ id })) });
      done.assignments = res.results.filter((r) => r.status < 400).length; // counted before a partial failure throws
      assertBulkOk(res);
      done.certificates += await deleteLateCertificates(skillIds);
    }
    assertBulkOk(await skillApi("v2/tags", { method: "DELETE", body: [{ id: tagId }] }));
    return done;
  } catch (e) {
    throw withProgress(e, done);
  }
}

/** Answer of a Skill Service bulk (v2) call: HTTP 207 with one result per item. */
type BulkResponse = Parameters<typeof assertBulkOk>[0];

/**
 * A certificate uploaded (e.g. from another browser tab) after we listed the certificates but
 * before the skill was deleted would be left without its skill. One more look catches it.
 */
async function deleteLateCertificates(skillIds: string[]): Promise<number> {
  const late = await loadCertificates(skillIds);
  for (const c of late) await fsmDelete("Attachment", c.id);
  return late.length;
}

/** Adds "already deleted: …" to an error from a cascade that stopped half-way. */
function withProgress(error: unknown, done: DeleteImpact): unknown {
  if (!done.assignments && !done.certificates) return error;
  const parts = [
    done.certificates ? `${done.certificates} certificate${done.certificates > 1 ? "s" : ""}` : "",
    done.assignments ? `${done.assignments} assignment${done.assignments > 1 ? "s" : ""}` : "",
  ].filter(Boolean);
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${message} Already deleted before the error: ${parts.join(" and ")}. Reload and try again to finish.`);
}

// --- Writes: assignments (Skills) -------------------------------------------------------

/**
 * The Skill Service requires a start date ("Start date is required"). An empty "valid from"
 * therefore means "from today". Returns the dates that are actually sent.
 */
function toWritableDates(input: AssignmentInput): { startDate: string; endDate: string | null } {
  const startDate = effectiveStartDate(input.startDate, todayIso());
  const error = validateValidity(startDate, input.endDate);
  if (error) throw new Error(error);
  return { startDate, endDate: input.endDate };
}

export async function createAssignment(tagId: string, personId: string, input: AssignmentInput): Promise<Assignment> {
  const dates = toWritableDates(input);
  assertFsmId(personId);
  await assertOwnTag(tagId);
  const existing = await skillSearch<SkillServiceSkill & { deleted?: boolean }>("v1/skills", [
    { field: "tag.id", operator: "=", value: tagId },
    { field: "technicianId", operator: "=", value: personId },
  ]);
  if (existing.some((s) => !s.deleted)) throw new Error("This person already has this skill. Reload the page to see it.");

  const [skill] = assertBulkOk<SkillServiceSkill>(
    await skillApi("v2/skills", {
      method: "POST",
      body: [
        {
          tagId,
          technician: personId,
          proficiencyId: input.proficiencyId ?? undefined,
          startDate: dates.startDate,
          endDate: dates.endDate ?? undefined,
        },
      ],
    }),
  );
  return toAssignment(skill);
}

export async function updateAssignment(assignmentId: string, input: AssignmentInput): Promise<void> {
  const dates = toWritableDates(input);
  const { tagId } = await assertOwnSkill(assignmentId);
  await skillApi(`v1/tags/${tagId}/skills/${assignmentId}`, {
    method: "PATCH",
    body: {
      // Measured: FSM keeps the stored level when the field is left out (undefined), and clears it
      // on null. The dialog leaves it out unless the user picked a level or "No level".
      proficiencyId: input.proficiencyId,
      startDate: dates.startDate,
      endDate: dates.endDate ?? OPEN_END_DATE,
    },
  });
}

/** Removes an assignment and its certificates (certificates first, so none are left orphaned). */
export async function deleteAssignment(assignmentId: string): Promise<void> {
  await assertOwnSkill(assignmentId);
  const done: DeleteImpact = { assignments: 0, certificates: 0 };
  try {
    for (const c of await loadCertificates([assignmentId])) {
      await fsmDelete("Attachment", c.id);
      done.certificates++;
    }
    assertBulkOk(await skillApi("v2/skills", { method: "DELETE", body: [{ id: assignmentId }] }));
    done.assignments = 1;
    await deleteLateCertificates([assignmentId]);
  } catch (e) {
    throw withProgress(e, done);
  }
}

// --- Writes: certificates (Attachments) --------------------------------------------------

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

/** What one look into FSM after a timed-out write found. Reads only. */
export type WriteCheck<T> = { result: "done"; value: T } | { result: "notDone" } | { result: "unconfirmed"; error: string };

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
    if (rows.length > 1) return { result: "unconfirmed", error: "FSM shows more than one file from this upload." };
    assertFsmId(rows[0].a.id);
    if (!(await sameBytes(rows[0].a.id, file))) {
      return { result: "unconfirmed", error: "FSM has a new file from this upload, but its content is not the same as the picked file." };
    }
    return { result: "done", value: toCertificate(rows[0].a) };
  } catch (e) {
    return { result: "unconfirmed", error: toUserMessage(e) };
  }
}

const NOT_UPLOADED = "FSM did not answer in time, and the file is not in FSM. Not uploaded. You can try again.";

/** Sorts one check result into the outcome lists. */
function recordCheck(outcome: UploadOutcome, file: File, uploadId: string, check: WriteCheck<Certificate>): void {
  if (check.result === "done") {
    outcome.uploaded.push(check.value);
    outcome.confirmedLate.push(file);
  } else if (check.result === "notDone") {
    outcome.failed.push({ file, error: NOT_UPLOADED, uploadId });
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
 * Did a timed-out create arrive? Looks for this person's assignment of this skill (Skill Service,
 * which shows a new skill immediately). Reads only.
 */
export async function checkAssignmentCreated(tagId: string, personId: string): Promise<WriteCheck<Assignment>> {
  try {
    assertFsmId(tagId);
    assertFsmId(personId);
    const found = (
      await skillSearch<SkillServiceSkill & { deleted?: boolean }>("v1/skills", [
        { field: "tag.id", operator: "=", value: tagId },
        { field: "technicianId", operator: "=", value: personId },
      ])
    ).filter((s) => !s.deleted && s.tagId === tagId);
    if (found.length === 0) return { result: "notDone" };
    if (found.length === 1 && isOwnName(found[0].tagName)) return { result: "done", value: toAssignment(found[0]) };
    return { result: "unconfirmed", error: "FSM shows an unexpected answer for this person and skill. Reload the page to see what is stored." };
  } catch (e) {
    return { result: "unconfirmed", error: toUserMessage(e) };
  }
}

/**
 * Assign a skill and upload its certificates in one step for the user. FSM needs the assignment
 * first, because an attachment is linked to a skill id. If creating the assignment fails, nothing
 * is uploaded; if an upload fails, the assignment stays and the failed files are returned.
 */
export async function createAssignmentWithCertificates(
  tagId: string,
  personId: string,
  input: AssignmentInput,
  files: File[],
  onProgress?: (file: File, index: number, total: number) => void,
): Promise<{ assignment: Assignment } & UploadOutcome> {
  const assignment = await createAssignment(tagId, personId, input);
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
