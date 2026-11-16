/**
 * All FSM access of the app. UI components never call the FSM client directly.
 *
 * Which API for what (details in README.md):
 * - Query API:     persons, certificates (one query for many skills), ownership lookups before writes
 * - Skill Service: tags (incl. scaleId), skills (incl. proficiency), scales and levels; tag and skill writes
 * - Data API:      attachments (upload, download, delete); the only API that handles files
 *
 * Every write first re-reads its target from FSM and passes it through the guard in
 * `src/lib/fsm/guard.ts`. If the check fails, the write request is never sent.
 */
import { assertBulkOk, fileToBase64, fsmCreate, fsmDelete, fsmQuery, skillApi, skillSearch } from "@/lib/fsm/client";
import type { FsmAttachment, FsmPerson, SkillServiceProficiency, SkillServiceScale, SkillServiceSkill, SkillServiceTag } from "@/lib/fsm/types";
import { NAME_PREFIX, fromScopedName, isOwnName, toScopedName } from "@/lib/candidate";
import { OwnershipError, assertFsmId, assertOwnName, assertOwnedByTagName } from "@/lib/fsm/guard";
import { normalizeEndDate, OPEN_END_DATE, todayIso } from "@/lib/domain/status";
import { effectiveStartDate, validateCertificateFile, validateValidity } from "@/lib/domain/validation";
import type { Assignment, AssignmentInput, Certificate, Person, ProficiencyScale, SkillDefinition } from "./types";

/** One scale for all our skills. */
export const SCALE_NAME = toScopedName("Proficiency");
const SCALE_LEVELS = [{ name: "Basic", isDefault: true }, { name: "Advanced" }, { name: "Expert" }];

/** Ids per `IN (...)` list in CoreSQL. */
const IN_CHUNK = 100;

// --- Reads ------------------------------------------------------------------------

export async function loadPersons(): Promise<Person[]> {
  const rows = await fsmQuery<{ p: FsmPerson & { userName?: string | null } }>(
    "SELECT p.id, p.firstName, p.lastName, p.jobTitle, p.type, p.userName FROM Person p WHERE p.inactive = false",
    ["Person"],
  );
  return rows
    .map(({ p }) => ({
      id: p.id,
      name: [p.firstName, p.lastName].filter(Boolean).join(" ") || p.userName || "Unnamed person",
      jobTitle: p.jobTitle ?? null,
      type: p.type ?? null,
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

async function readTagName(tagId: string): Promise<string | null> {
  assertFsmId(tagId);
  const rows = await fsmQuery<{ t: { name: string } }>(`SELECT t.id, t.name FROM Tag t WHERE t.id = '${tagId}'`, ["Tag"]);
  return rows[0]?.t.name ?? null;
}

async function assertOwnTag(tagId: string): Promise<string> {
  const name = await readTagName(tagId);
  if (name === null) throw new OwnershipError("Refused: this skill no longer exists in FSM. Reload the page.");
  assertOwnName(name, "Tag");
  return name;
}

async function assertOwnSkill(skillId: string): Promise<{ tagId: string }> {
  assertFsmId(skillId);
  const rows = await fsmQuery<{ s: { tag: string }; t: { name: string } }>(
    `SELECT s.id, s.tag, t.name FROM Skill s JOIN Tag t ON t.id = s.tag WHERE s.id = '${skillId}'`,
    ["Skill", "Tag"],
  );
  const row = rows[0];
  assertOwnedByTagName(row ? { tagName: row.t.name } : null, "Skill");
  return { tagId: row!.s.tag };
}

async function assertOwnAttachment(attachmentId: string): Promise<void> {
  assertFsmId(attachmentId);
  const rows = await fsmQuery<{ t: { name: string } }>(
    `SELECT a.id, t.name FROM Attachment a JOIN Skill s ON s.id = a.object.objectId JOIN Tag t ON t.id = s.tag WHERE a.id = '${attachmentId}' AND a.object.objectType = 'SKILL'`,
    ["Attachment", "Skill", "Tag"],
  );
  assertOwnedByTagName(rows[0] ? { tagName: rows[0].t.name } : null, "Attachment");
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

export async function createSkillDefinition(displayName: string, description: string): Promise<SkillDefinition> {
  const name = toScopedName(displayName);
  assertOwnName(name, "Tag");
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

/** What deleting a skill definition would remove (shown in the confirmation dialog). */
export async function getDeleteImpact(tagId: string): Promise<DeleteImpact & { skillIds: string[] }> {
  assertFsmId(tagId);
  const skills = await skillSearch<SkillServiceSkill & { deleted?: boolean }>("v1/skills", [{ field: "tag.id", operator: "=", value: tagId }]);
  const skillIds = skills.filter((s) => !s.deleted).map((s) => s.id);
  const certificates = await loadCertificates(skillIds);
  return { assignments: skillIds.length, certificates: certificates.length, skillIds };
}

/**
 * Deletes a skill definition including its assignments and their certificates
 * (certificates → assignments → tag). Stops at the first failure; what was deleted stays deleted.
 */
export async function deleteSkillDefinition(tagId: string): Promise<DeleteImpact> {
  await assertOwnTag(tagId);
  const { skillIds } = await getDeleteImpact(tagId);
  const certificates = await loadCertificates(skillIds);
  for (const c of certificates) await fsmDelete("Attachment", c.id); // all belong to skills of our own tag
  if (skillIds.length) {
    assertBulkOk(await skillApi("v2/skills", { method: "DELETE", body: skillIds.map((id) => ({ id })) }));
  }
  assertBulkOk(await skillApi("v2/tags", { method: "DELETE", body: [{ id: tagId }] }));
  return { assignments: skillIds.length, certificates: certificates.length };
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
      proficiencyId: input.proficiencyId,
      startDate: dates.startDate,
      endDate: dates.endDate ?? OPEN_END_DATE,
    },
  });
}

/** Removes an assignment and its certificates (certificates first, so none are left orphaned). */
export async function deleteAssignment(assignmentId: string): Promise<void> {
  await assertOwnSkill(assignmentId);
  const certificates = await loadCertificates([assignmentId]);
  for (const c of certificates) await fsmDelete("Attachment", c.id);
  assertBulkOk(await skillApi("v2/skills", { method: "DELETE", body: [{ id: assignmentId }] }));
}

// --- Writes: certificates (Attachments) --------------------------------------------------

export async function uploadCertificate(assignmentId: string, file: File): Promise<Certificate> {
  const check = validateCertificateFile(file);
  if (!check.ok) throw new Error(check.error);
  await assertOwnSkill(assignmentId);
  const created = await fsmCreate<FsmAttachment>("Attachment", {
    fileName: file.name,
    title: file.name,
    type: check.type,
    fileContent: await fileToBase64(file),
    object: { objectId: assignmentId, objectType: "SKILL" },
  });
  return toCertificate({ ...created, object: created.object ?? { objectId: assignmentId, objectType: "SKILL" } });
}

export async function deleteCertificate(attachmentId: string): Promise<void> {
  await assertOwnAttachment(attachmentId);
  await fsmDelete("Attachment", attachmentId);
}
