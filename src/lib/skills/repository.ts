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
import { assertBulkOk, fsmDelete, fsmGet, fsmQuery, skillApi, skillSearch } from "@/lib/fsm/client";
import type { FsmAttachment, FsmPerson, SkillServiceProficiency, SkillServiceScale, SkillServiceSkill, SkillServiceTag } from "@/lib/fsm/types";
import { NAME_PREFIX, fromScopedName, isOwnName, toScopedName } from "@/lib/candidate";
import { OwnershipError, assertFsmId, assertOwnName, assertOwnedByTagName } from "@/lib/fsm/guard";
import { normalizeEndDate, OPEN_END_DATE, todayIso } from "@/lib/domain/status";
import { effectiveStartDate, validateSkillName, validateValidity } from "@/lib/domain/validation";
import { toUserMessage } from "@/lib/errors";
import type { Assignment, AssignmentInput, Certificate, Person, ProficiencyScale, SkillDefinition } from "./types";
import { t, tn } from "@/lib/i18n/t";

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

export function toCertificate(a: FsmAttachment): Certificate {
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

export async function assertOwnSkill(skillId: string): Promise<{ tagId: string }> {
  assertFsmId(skillId);
  const skills = await skillSearch<SkillServiceSkill & { deleted?: boolean }>("v1/skills", [{ field: "id", operator: "=", value: skillId }]);
  const skill = skills.find((s) => s.id === skillId && !s.deleted) ?? null;
  assertOwnedByTagName(skill, "Skill");
  return { tagId: skill!.tagId };
}

export async function assertOwnAttachment(attachmentId: string): Promise<void> {
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
    super(t("deleteDialog.changed", { assignments: impact.assignments, certificates: impact.certificates }));
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
      done.certificates += await deleteLateCertificates(skillIds);
      const res = await skillApi<BulkResponse>("v2/skills", { method: "DELETE", body: skillIds.map((id) => ({ id })) });
      done.assignments = res.results.filter((r) => r.status < 400).length; // counted before a partial failure throws
      assertBulkOk(res);
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
 * A certificate uploaded (e.g. from another browser tab) after we listed the certificates would be
 * left without its skill. One more look catches it, while the assignments still exist: once a skill
 * is deleted, the server no longer accepts deleting its attachments (they are no longer "ours").
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
    done.certificates ? tn("delete.certificates", done.certificates) : "",
    done.assignments ? tn("delete.assignments", done.assignments) : "",
  ].filter(Boolean);
  const message = error instanceof Error ? error.message : String(error);
  return new Error(t("delete.partial", { message, parts: parts.join(t("delete.partsAnd")) }));
}

// --- Writes: assignments (Skills) -------------------------------------------------------

/**
 * The Skill Service requires a start date ("Start date is required"). An empty "valid from"
 * therefore means "from today". Returns the dates that are actually sent.
 */
export function toWritableDates(input: AssignmentInput): { startDate: string; endDate: string | null } {
  const startDate = effectiveStartDate(input.startDate, todayIso());
  const error = validateValidity(startDate, input.endDate);
  if (error) throw new Error(error);
  return { startDate, endDate: input.endDate };
}

/** The person already has this skill in FSM; nothing was written. */
export class AssignmentExistsError extends Error {
  constructor() {
    super(t("assign.exists"));
    this.name = "AssignmentExistsError";
  }
}

export async function createAssignment(tagId: string, personId: string, input: AssignmentInput): Promise<Assignment> {
  const dates = toWritableDates(input);
  assertFsmId(personId);
  await assertOwnTag(tagId);
  const existing = await skillSearch<SkillServiceSkill & { deleted?: boolean }>("v1/skills", [
    { field: "tag.id", operator: "=", value: tagId },
    { field: "technicianId", operator: "=", value: personId },
  ]);
  if (existing.some((s) => !s.deleted)) throw new AssignmentExistsError();

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
    done.certificates += await deleteLateCertificates([assignmentId]);
    assertBulkOk(await skillApi("v2/skills", { method: "DELETE", body: [{ id: assignmentId }] }));
    done.assignments = 1;
  } catch (e) {
    throw withProgress(e, done);
  }
}

// --- Checks after a write FSM did not answer -------------------------------------------

/** What one look into FSM after a timed-out write found. Reads only. */
export type WriteCheck<T> = { result: "done"; value: T } | { result: "notDone" } | { result: "unconfirmed"; error: string };

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
    return { result: "unconfirmed", error: t("assign.unexpected") };
  } catch (e) {
    return { result: "unconfirmed", error: toUserMessage(e) };
  }
}

