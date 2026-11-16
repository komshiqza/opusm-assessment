import { getAssignmentStatus, type AssignmentStatus } from "@/lib/domain/status";
import type { Assignment, Certificate } from "@/lib/skills/types";

export interface PersonSkillRow<D> {
  definition: D;
  /** undefined: the person does not have this skill */
  assignment: Assignment | undefined;
  status: AssignmentStatus;
  certificates: Certificate[];
  /** The person record that holds this assignment (or, if none does, the first record): edits and assigns go there. */
  holderId: string;
}

/**
 * All skills of one person, from data the app already loaded: the skills the person holds first
 * (in catalogue order), then the ones that could be assigned. `recordIds`: the person's records to
 * look at, the main one first (one record from the matrix; all linked records from Find technician).
 * A skill held by two records gives two rows, so no assignment or certificate is hidden.
 */
export function personSkillRows<D extends { id: string }>(
  recordIds: string[],
  definitions: D[],
  lookup: (personId: string, tagId: string) => Assignment | undefined,
  certificatesBySkill: Map<string, Certificate[]>,
  today: string,
): PersonSkillRow<D>[] {
  const rows = definitions.flatMap((definition) => {
    const holders = recordIds.filter((id) => lookup(id, definition.id));
    return (holders.length ? holders : [recordIds[0]]).map((holderId) => {
      const assignment = lookup(holderId, definition.id);
      return {
        definition,
        holderId,
        assignment,
        status: getAssignmentStatus(assignment, today),
        certificates: assignment ? (certificatesBySkill.get(assignment.id) ?? []) : [],
      };
    });
  });
  return [...rows.filter((r) => r.assignment), ...rows.filter((r) => !r.assignment)];
}

/** "1 of 5 skills assigned": distinct skills, so a skill held by two records counts once. */
export function personSkillSummary<D extends { id: string }>(rows: PersonSkillRow<D>[]): { held: number; total: number } {
  const held = new Set(rows.filter((r) => r.assignment).map((r) => r.definition.id));
  return { held: held.size, total: new Set(rows.map((r) => r.definition.id)).size };
}
