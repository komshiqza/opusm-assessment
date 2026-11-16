/**
 * "Who can I send to this job on that day?" Pure functions on data the matrix already loaded.
 * A skill counts for a job when it is valid on the job date (and, if asked, has at least the
 * required level). All dates are "YYYY-MM-DD" strings, compared as text.
 */
import { daysBetween, normalizeEndDate } from "./status";
import { formatDate } from "@/lib/format";

interface HeldSkill {
  startDate: string | null;
  endDate: string | null;
  proficiencyLevel: number | null;
  proficiencyName: string | null;
}

export interface SkillCheck {
  ok: boolean;
  /** Why the skill does not count for the job, in words for the manager. */
  reason: string | null;
  /** The person does not have the skill at all. */
  missing: boolean;
}

export function checkSkillForJob(
  held: HeldSkill | undefined,
  skill: { name: string },
  jobDate: string,
  today: string,
  minLevel: { level: number; name: string } | null,
): SkillCheck {
  if (!held) return { ok: false, reason: `Missing: ${skill.name}`, missing: true };
  const end = normalizeEndDate(held.endDate);
  if (end && end < jobDate) {
    if (end < today) return { ok: false, reason: `${skill.name} expired on ${formatDate(end)}`, missing: false };
    const days = daysBetween(end, jobDate);
    return { ok: false, reason: `${skill.name} ends ${days} day${days === 1 ? "" : "s"} before the job`, missing: false };
  }
  if (held.startDate && held.startDate > jobDate) {
    return { ok: false, reason: `${skill.name} is valid only from ${formatDate(held.startDate)}`, missing: false };
  }
  if (minLevel && (held.proficiencyLevel ?? 0) < minLevel.level) {
    return { ok: false, reason: `${skill.name}: ${held.proficiencyName ?? "no level"}, ${minLevel.name} needed`, missing: false };
  }
  return { ok: true, reason: null, missing: false };
}

export interface JobMatch<P> {
  /** All required skills count on the job date. */
  ready: { person: P }[];
  /**
   * Exactly one required skill is missing or does not count; `reason` says which and why.
   * Skills that exist but do not count (renewal, level) come first, plain "Missing" last.
   */
  almost: { person: P; reason: string; missing: boolean }[];
  /** Persons with two or more gaps (not listed). */
  others: number;
}

export function matchTechnicians<P extends { id: string; name: string }, S extends { id: string; name: string }>(
  persons: P[],
  requiredSkills: S[],
  lookup: (personId: string, skillId: string) => HeldSkill | undefined,
  jobDate: string,
  today: string,
  minLevel: { level: number; name: string } | null,
): JobMatch<P> {
  const result: JobMatch<P> = { ready: [], almost: [], others: 0 };
  if (requiredSkills.length === 0) return result;
  for (const person of persons) {
    const gaps = requiredSkills
      .map((s) => checkSkillForJob(lookup(person.id, s.id), s, jobDate, today, minLevel))
      .filter((c) => !c.ok);
    if (gaps.length === 0) result.ready.push({ person });
    else if (gaps.length === 1) result.almost.push({ person, reason: gaps[0].reason!, missing: gaps[0].missing });
    else result.others++;
  }
  result.almost.sort((a, b) => Number(a.missing) - Number(b.missing)); // stable: keeps the persons' order within each group
  return result;
}
