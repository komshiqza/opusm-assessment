/**
 * Minimal FSM types: only the fields you are likely to need. The full field lists are in
 * docs/FSM_GUIDE.md. FSM returns more fields than declared here.
 */

export interface FsmPerson {
  id: string;
  firstName: string | null;
  lastName: string | null;
  emailAddress?: string | null;
  jobTitle?: string | null;
  /** e.g. EMPLOYEE, ERPUSER */
  type?: string | null;
  inactive?: boolean;
}

/** A skill definition (the "column" of a skill matrix). */
export interface FsmTag {
  id: string;
  name: string;
  description?: string | null;
  inactive?: boolean;
}

/** A skill assigned to a person (person × tag), optionally with a validity period. */
export interface FsmSkill {
  id: string;
  person: string;
  tag: string;
  /** "YYYY-MM-DD" or null */
  startDate: string | null;
  /** "YYYY-MM-DD" or null */
  endDate: string | null;
  inactive?: boolean;
}

export interface FsmObjectRef {
  objectId: string;
  /** e.g. SKILL, PERSON, ACTIVITY */
  objectType: string;
}

export interface FsmAttachment {
  id: string;
  fileName: string;
  title?: string | null;
  description?: string | null;
  /** Upper-case file extension, e.g. PDF, JPEG, PNG */
  type: string;
  object: FsmObjectRef;
  createDateTime?: string;
}

// --- Skill Service API types (subset) ---------------------------------------------

/** A proficiency scale, e.g. "jdoe::Levels" with Basic / Advanced / Expert. */
export interface SkillServiceScale {
  id: string;
  name: string;
  deleted?: boolean;
}

/** One level of a scale. `level` is 1-based and follows the creation order. */
export interface SkillServiceProficiency {
  id: string;
  name: string;
  scaleId: string;
  level: number;
  isDefault: boolean;
}

export interface SkillServiceTag {
  id: string;
  name: string;
  description: string | null;
  scaleId: string | null;
  deleted?: boolean;
}

/** Same id as the Data API `Skill`. Open-ended skills have endDate "9999-12-31". */
export interface SkillServiceSkill {
  id: string;
  tagId: string;
  tagName: string;
  technicianId: string;
  startDate: string;
  endDate: string;
  proficiencyId: string | null;
  proficiencyName: string | null;
  proficiencyLevel: number | null;
  /** observed: "PE" for open-ended skills, "LF" for skills with a date range */
  validityType?: string;
}
