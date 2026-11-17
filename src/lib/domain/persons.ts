/**
 * One row per real person, the way SAP does it with UnifiedPerson.
 *
 * SAP: one human can have up to three Person records (ERPUSER, EMPLOYEE, SALESEMPLOYEE); UnifiedPerson
 * "unif[ies]/combine[s] all two/three records for an entity into a single, unified record", and the
 * guarantee is that refId is identical for all Person and UnifiedPerson records of one human. SAP warns
 * not to rely on Person[ERPUSER].id = UnifiedPerson.id, so records are matched by refId only.
 * https://help.sap.com/docs/SAP_FIELD_SERVICE_MANAGEMENT/fsm_data_model/person-unifiedperson.html
 *
 * A skill (FSM Skill) belongs to one Person record. The person's main record (ERPUSER, else the record
 * that references itself) is the person's id in this app, so new assignments always go there.
 */
import type { Assignment, Person, PersonRecord } from "@/lib/skills/types";

export interface UnifiedPersonRow {
  id: string;
  refId: string | null;
  name: string;
  jobTitle: string | null;
  inactive?: boolean;
}

export interface PersonRecordRow extends PersonRecord {
  refId: string | null;
  /** An inactive record still belongs to the person (its skills stay visible), but is never the main one. */
  inactive?: boolean;
}

/** `${personId}|${tagId}`: one cell of the matrix (person = the main record's id). */
export const cellKey = (personId: string, tagId: string) => `${personId}|${tagId}`;

/** The main record, among the active ones: ERPUSER, else the one that references itself, else the first. */
export function mainRecord(records: PersonRecordRow[], refId: string): PersonRecordRow | undefined {
  const active = records.filter((r) => !r.inactive);
  return active.find((r) => r.type === "ERPUSER") ?? active.find((r) => r.id === refId) ?? active[0];
}

/** Active UnifiedPerson rows with their Person records (by refId), main record first, sorted by name. */
export function buildPeople(unified: UnifiedPersonRow[], records: PersonRecordRow[]): Person[] {
  const byRefId = new Map<string, PersonRecordRow[]>();
  for (const r of records) if (r.refId) byRefId.set(r.refId, [...(byRefId.get(r.refId) ?? []), r]);
  const people: Person[] = [];
  for (const u of unified) {
    if (u.inactive) continue;
    const refId = u.refId ?? u.id;
    const own = byRefId.get(refId) ?? [];
    const main = mainRecord(own, refId);
    if (!main) continue; // no active record: nothing could be written for this person
    const ordered = [main, ...own.filter((r) => r !== main)].map(({ id, type }) => ({ id, type }));
    people.push({ id: main.id, name: u.name, jobTitle: u.jobTitle?.trim() || null, refId, records: ordered });
  }
  return people.sort((a, b) => a.name.localeCompare(b.name));
}

export interface PlacedAssignments {
  /** cellKey(person, tag) → the assignment shown: the main record's, else the one on a linked record */
  byCell: Map<string, Assignment>;
  /** cellKey(person, tag) → further assignments of the same skill on the person's other records */
  alsoOn: Map<string, Assignment[]>;
  /** The person a Person record belongs to (undefined: no active person, the assignment is not shown) */
  ownerOf: (recordId: string) => Person | undefined;
}

/** Puts each assignment into its person's cell; one whose record belongs to no active person is left out. */
export function placeAssignments<A extends Pick<Assignment, "id" | "personId" | "tagId">>(
  people: Person[],
  assignments: A[],
): Omit<PlacedAssignments, "byCell" | "alsoOn"> & { byCell: Map<string, A>; alsoOn: Map<string, A[]> } {
  const owner = new Map<string, Person>();
  for (const p of people) for (const r of p.records) owner.set(r.id, p);
  const byCell = new Map<string, A>();
  const alsoOn = new Map<string, A[]>();
  // Main-record assignments first, so they win the cell.
  const ordered = [...assignments].sort((x, y) => Number(owner.get(y.personId)?.id === y.personId) - Number(owner.get(x.personId)?.id === x.personId));
  for (const a of ordered) {
    const person = owner.get(a.personId);
    if (!person) continue;
    const key = cellKey(person.id, a.tagId);
    if (byCell.has(key)) alsoOn.set(key, [...(alsoOn.get(key) ?? []), a]);
    else byCell.set(key, a);
  }
  return { byCell, alsoOn, ownerOf: (recordId) => owner.get(recordId) };
}
