/**
 * "Who can I send to this job on that day?" Pure functions on data the matrix already loaded.
 * A skill counts for a job when it is valid on the job date (and, if asked, has at least the
 * required level). All dates are "YYYY-MM-DD" strings, compared as text.
 */
import { daysBetween, normalizeEndDate } from "./status";
import { formatDate } from "@/lib/format";
import { t, tn } from "@/lib/i18n/t";

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
  if (!held) return { ok: false, reason: t("match.missing", { skill: skill.name }), missing: true };
  const end = normalizeEndDate(held.endDate);
  if (end && end < jobDate) {
    if (end < today) return { ok: false, reason: t("match.expiredOn", { skill: skill.name, date: formatDate(end) }), missing: false };
    const days = daysBetween(end, jobDate);
    return { ok: false, reason: tn("match.endsBefore", days, { skill: skill.name }), missing: false };
  }
  if (held.startDate && held.startDate > jobDate) {
    return { ok: false, reason: t("match.validFrom", { skill: skill.name, date: formatDate(held.startDate) }), missing: false };
  }
  if (minLevel && (held.proficiencyLevel ?? 0) < minLevel.level) {
    return {
      ok: false,
      reason: t("match.levelNeeded", { skill: skill.name, level: held.proficiencyName ?? t("match.noLevel"), needed: minLevel.name }),
      missing: false,
    };
  }
  return { ok: true, reason: null, missing: false };
}

export interface JobMatch<P> {
  /** All required skills count on the job date. Technicians first, then people without a job title. */
  ready: { person: P; technician: boolean }[];
  /**
   * Exactly one required skill does not count, and it can be fixed before the job: the person has it,
   * but it must be renewed, needs a higher level, or starts too late. `reason` says which and why.
   */
  almost: { person: P; reason: string; technician: boolean }[];
  /** Exactly one required skill is not assigned at all (everything else counts). Shown collapsed: with one required skill it is nearly everyone. */
  missingOne: { person: P; skillName: string; technician: boolean }[];
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
  /** People without a job title are listed after the technicians, and only if they hold a required skill. */
  isTechnician: (person: P) => boolean = () => true,
): JobMatch<P> {
  const result: JobMatch<P> = { ready: [], almost: [], missingOne: [], others: 0 };
  if (requiredSkills.length === 0) return result;
  for (const person of persons) {
    const technician = isTechnician(person);
    if (!technician && !requiredSkills.some((s) => lookup(person.id, s.id))) continue;
    const gaps = requiredSkills
      .map((s) => ({ skill: s, check: checkSkillForJob(lookup(person.id, s.id), s, jobDate, today, minLevel) }))
      .filter((g) => !g.check.ok);
    if (gaps.length === 0) result.ready.push({ person, technician });
    else if (gaps.length > 1) result.others++;
    else if (gaps[0].check.missing) result.missingOne.push({ person, skillName: gaps[0].skill.name, technician });
    else result.almost.push({ person, reason: gaps[0].check.reason!, technician });
  }
  // Stable sorts: technicians first, otherwise the persons' order.
  const technicianFirst = (a: { technician: boolean }, b: { technician: boolean }) => Number(b.technician) - Number(a.technician);
  result.ready.sort(technicianFirst);
  result.almost.sort(technicianFirst);
  result.missingOne.sort(technicianFirst);
  return result;
}

/** "Advanced or higher" in the "Minimum level" choices; the highest level of the scale is just its name. */
export function minimumLevelLabel(level: { level: number; name: string }, scale: { level: number }[]): string {
  const highest = Math.max(...scale.map((l) => l.level));
  return level.level >= highest ? level.name : t("find.orHigher", { level: level.name });
}
