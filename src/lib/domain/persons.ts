/**
 * Which person records the matrix shows by default: one row per physical person.
 *
 * SAP documents this in the Person DTO (v23): "A physical person can have up to 3 different
 * entries" (ERPUSER, EMPLOYEE, SALESEMPLOYEE). "They are linked through the refId property", which
 * equals the ERPUSER id, and "that person is actually the one of type ERPUSER".
 * https://help.sap.com/docs/SAP_FIELD_SERVICE_MANAGEMENT/fsm_data_model/persondto_v23.html
 *
 * So: group the records by refId and show the ERPUSER record of each group in which any record has
 * a job title (people without one, like OPUSm staff or "admin", are not technicians). A record that
 * holds one of our skills is always shown, so no assignment can disappear. Records are never
 * merged: a skill belongs to one specific person id.
 */

interface PersonRecord {
  id: string;
  type: string | null;
  refId?: string | null;
  jobTitle: string | null;
}

/** The physical person a record belongs to (SAP: refId = ERPUSER id; missing refId = its own id). */
function physicalPersonKey(p: PersonRecord): string {
  return p.refId || p.id;
}

function groupByPhysicalPerson<P extends PersonRecord>(persons: P[]): P[][] {
  const groups = new Map<string, P[]>();
  for (const p of persons) groups.set(physicalPersonKey(p), [...(groups.get(physicalPersonKey(p)) ?? []), p]);
  return [...groups.values()];
}

export function countPhysicalPersons(persons: PersonRecord[]): number {
  return groupByPhysicalPerson(persons).length;
}

/** The record that stands for the person: the ERPUSER record the others point to. */
function mainRecord<P extends PersonRecord>(group: P[]): P {
  return group.find((p) => p.type === "ERPUSER" && p.id === physicalPersonKey(p)) ?? group.find((p) => p.type === "ERPUSER") ?? group[0];
}

export function selectPersonRows<P extends PersonRecord>(persons: P[], personIdsWithAssignments: Set<string>, showAll: boolean): P[] {
  if (showAll) return persons;
  const shown = new Set<string>();
  for (const group of groupByPhysicalPerson(persons)) {
    if (!group.some((p) => p.jobTitle?.trim())) continue;
    shown.add(mainRecord(group).id);
  }
  for (const p of persons) if (personIdsWithAssignments.has(p.id)) shown.add(p.id);
  return persons.filter((p) => shown.has(p.id));
}

/**
 * One entry per physical person, for "Find technician" (which asks about people, not records): the
 * main record stands for the person, `records` are all of the person's given records, the main one first.
 */
export function groupPersonRecords<P extends PersonRecord>(rows: P[]): { person: P; records: P[] }[] {
  return groupByPhysicalPerson(rows).map((group) => {
    const person = mainRecord(group);
    return { person, records: [person, ...group.filter((p) => p !== person)] };
  });
}

/**
 * Records of people without a job title on any of their linked records (e.g. OPUSm staff accounts).
 * They are not technicians, but if they hold one of our skills they stay visible, clearly labelled:
 * the brief asks "which person has which skill", and in an emergency such a person may matter.
 */
export function personsWithoutJobTitle(persons: PersonRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const group of groupByPhysicalPerson(persons)) {
    if (group.some((p) => p.jobTitle?.trim())) continue;
    for (const p of group) ids.add(p.id);
  }
  return ids;
}

/**
 * Secondary records: an EMPLOYEE or SALESEMPLOYEE record whose refId points to a loaded ERPUSER
 * record (another record than itself). New skills go only on a person's main record, so one person's
 * skills are not split over two records; existing skills on a secondary record stay fully usable.
 * Not secondary: every ERPUSER record (also without a job title), and a record without a loaded
 * ERPUSER behind it (no refId, refId to itself, or refId to a record that is not loaded): it is that
 * person's only record. A UX rule of this app, not a rule of the shared company.
 */
export function secondaryRecordIds(persons: PersonRecord[]): Set<string> {
  const erpUsers = new Set(persons.filter((p) => p.type === "ERPUSER").map((p) => p.id));
  return new Set(
    persons
      .filter((p) => (p.type === "EMPLOYEE" || p.type === "SALESEMPLOYEE") && p.refId && p.refId !== p.id && erpUsers.has(p.refId))
      .map((p) => p.id),
  );
}

/**
 * Records whose type ("ERP user", "Employee") must be shown: only where two different records of the
 * same person are on screen, which would otherwise look identical. With one row per person the type
 * is technical noise. A record listed several times (one row per assignment) counts once.
 */
export function recordsNeedingType(rows: PersonRecord[]): Set<string> {
  const recordsPerPerson = new Map<string, Set<string>>();
  for (const p of rows) {
    const key = physicalPersonKey(p);
    recordsPerPerson.set(key, (recordsPerPerson.get(key) ?? new Set()).add(p.id));
  }
  return new Set([...recordsPerPerson.values()].filter((ids) => ids.size > 1).flatMap((ids) => [...ids]));
}
