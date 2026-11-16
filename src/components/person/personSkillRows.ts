import { getAssignmentStatus, type AssignmentStatus } from "@/lib/domain/status";
import type { Assignment, Certificate } from "@/lib/skills/types";

export interface PersonSkillRow<D> {
  definition: D;
  /** undefined: the person does not have this skill */
  assignment: Assignment | undefined;
  status: AssignmentStatus;
  certificates: Certificate[];
  /** The person record that holds the skill (or, if none does, the first record): edits and assigns go there. */
  holderId: string;
}

/**
 * All skills of one person, from data the app already loaded: the skills the person holds first
 * (in catalogue order), then the ones that could be assigned. `recordIds`: the person's records to
 * look at, the main one first (one record from the matrix; all linked records from Find technician).
 */
export function personSkillRows<D extends { id: string }>(
  recordIds: string[],
  definitions: D[],
  lookup: (personId: string, tagId: string) => Assignment | undefined,
  certificatesBySkill: Map<string, Certificate[]>,
  today: string,
): PersonSkillRow<D>[] {
  const rows = definitions.map((definition) => {
    const holderId = recordIds.find((id) => lookup(id, definition.id)) ?? recordIds[0];
    const assignment = lookup(holderId, definition.id);
    return {
      definition,
      holderId,
      assignment,
      status: getAssignmentStatus(assignment, today),
      certificates: assignment ? (certificatesBySkill.get(assignment.id) ?? []) : [],
    };
  });
  return [...rows.filter((r) => r.assignment), ...rows.filter((r) => !r.assignment)];
}
