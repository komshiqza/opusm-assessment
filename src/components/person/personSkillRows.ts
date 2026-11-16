import { getAssignmentStatus, type AssignmentStatus } from "@/lib/domain/status";
import type { Assignment, Certificate } from "@/lib/skills/types";

export interface PersonSkillRow<D> {
  definition: D;
  /** undefined: the person does not have this skill */
  assignment: Assignment | undefined;
  status: AssignmentStatus;
  certificates: Certificate[];
}

/**
 * All skills of one person, from data the app already loaded: the skills the person holds first
 * (in catalogue order), then the ones that could be assigned.
 */
export function personSkillRows<D extends { id: string }>(
  personId: string,
  definitions: D[],
  lookup: (personId: string, tagId: string) => Assignment | undefined,
  certificatesBySkill: Map<string, Certificate[]>,
  today: string,
): PersonSkillRow<D>[] {
  const rows = definitions.map((definition) => {
    const assignment = lookup(personId, definition.id);
    return {
      definition,
      assignment,
      status: getAssignmentStatus(assignment, today),
      certificates: assignment ? (certificatesBySkill.get(assignment.id) ?? []) : [],
    };
  });
  return [...rows.filter((r) => r.assignment), ...rows.filter((r) => !r.assignment)];
}
