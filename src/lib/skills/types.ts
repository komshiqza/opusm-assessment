/** App-level models. The repository maps FSM responses into these; the UI only knows these. */

export interface Person {
  id: string;
  /** "First Last", or the user name / a placeholder for technical persons without a name */
  name: string;
  jobTitle: string | null;
  /** FSM person type, e.g. EMPLOYEE or ERPUSER */
  type: string | null;
  /** SAP links the records of one physical person through refId (= the ERPUSER record's id). */
  refId: string | null;
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
  proficiencyId: string | null;
}
