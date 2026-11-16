/**
 * Which person records the matrix shows by default.
 *
 * In the demo company every technician exists twice, as an EMPLOYEE and an ERPUSER record with
 * the same name, e-mail, user name and code (e.g. TECH01). All 40 seeded demo skills point to the
 * ERPUSER records, so that is the record FSM attaches skills to. Persons without a job title
 * (OPUSm staff, "admin", an unnamed record) are not technicians.
 * The two records are never merged: a skill belongs to one specific person id.
 */
export const SKILL_HOLDER_TYPE = "ERPUSER";

export function isTechnicianRecord(person: { type: string | null; jobTitle: string | null }): boolean {
  return person.type === SKILL_HOLDER_TYPE && Boolean(person.jobTitle?.trim());
}

/**
 * Default: one row per technician. A record that already holds one of our skills is always shown,
 * so no assignment can disappear from the matrix. `showAll` returns every active person record.
 */
export function selectPersonRows<P extends { id: string; type: string | null; jobTitle: string | null }>(
  persons: P[],
  personIdsWithAssignments: Set<string>,
  showAll: boolean,
): P[] {
  if (showAll) return persons;
  return persons.filter((p) => isTechnicianRecord(p) || personIdsWithAssignments.has(p.id));
}
