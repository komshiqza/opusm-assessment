/** App-level models. The repository maps FSM responses into these; the UI only knows these. */

/** One FSM Person record of a person (ERPUSER, EMPLOYEE or SALESEMPLOYEE). A skill belongs to one record. */
export interface PersonRecord {
  id: string;
  type: string | null;
}

/**
 * One real person (FSM UnifiedPerson), see src/lib/domain/persons.ts. `id` is the person's main Person
 * record (ERPUSER, else the self-referencing one): new assignments always go there.
 */
export interface Person {
  id: string;
  /** "First Last", or the user name / a placeholder for technical persons without a name */
  name: string;
  jobTitle: string | null;
  /** SAP's key for all records of one human */
  refId: string;
  /** All Person records of this person, the main one first */
  records: PersonRecord[];
}

/** A skill definition = FSM Tag in our namespace. */
export interface SkillDefinition {
  id: string;
  /** without the "<candidate>::" prefix */
  name: string;
  description: string | null;
  scaleId: string | null;
}

/** A skill assigned to a person = FSM Skill. Same id in the Data API and the Skill Service. */
export interface Assignment {
  id: string;
  tagId: string;
  personId: string;
  /** "YYYY-MM-DD" or null */
  startDate: string | null;
  /** "YYYY-MM-DD" or null (= no end date) */
  endDate: string | null;
  proficiencyId: string | null;
  proficiencyName: string | null;
  proficiencyLevel: number | null;
}

/** A certificate = FSM Attachment linked to a Skill. */
export interface Certificate {
  id: string;
  skillId: string;
  fileName: string;
  /** PDF, JPEG or PNG */
  type: string;
  /** ISO date-time */
  createdAt: string | null;
}

export interface ProficiencyLevel {
  id: string;
  name: string;
  level: number;
  isDefault: boolean;
}

export interface ProficiencyScale {
  id: string;
  levels: ProficiencyLevel[];
}

export interface AssignmentInput {
  startDate: string | null;
  endDate: string | null;
  /** A level id; null = no level (clears it on an update); undefined = leave the stored level as it is. */
  proficiencyId?: string | null;
}
