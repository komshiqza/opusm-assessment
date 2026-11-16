/**
 * Assignment status for one matrix cell. All dates are plain calendar dates ("YYYY-MM-DD"),
 * compared as strings, so there are no time-zone shifts.
 */

export type AssignmentStatus = "none" | "upcoming" | "valid" | "expiring" | "expired";

/** An end date this close (in days, inclusive) counts as "expiring soon". */
export const EXPIRY_WARNING_DAYS = 30;

/** The Skill Service returns this end date for skills without an end date. */
export const OPEN_END_DATE = "9999-12-31";

/** "9999-12-31", "" and null all mean "no end date". */
export function normalizeEndDate(endDate: string | null | undefined): string | null {
  if (!endDate || endDate === OPEN_END_DATE) return null;
  return endDate;
}

/** Today in the browser's local time zone, as "YYYY-MM-DD". */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Valid on `date`: started on or before it, and the end date (last valid day) is on or after it. */
export function isValidOn(skill: { startDate?: string | null; endDate: string | null }, date: string): boolean {
  if (skill.startDate && skill.startDate > date) return false;
  const end = normalizeEndDate(skill.endDate);
  return !end || end >= date;
}

/** Calendar arithmetic in UTC so daylight-saving changes cannot shift the result. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * - no assignment                         → "none"
 * - end date before today                 → "expired"
 * - start date after today                → "upcoming" (not valid yet; shown as "Starts …")
 * - end date today … today + 30 days      → "expiring" (the end date is the last valid day)
 * - no end date, or later than that       → "valid"
 * "Valid today" is the same rule the job search uses (`isValidOn`), so both views agree.
 */
export function getAssignmentStatus(
  assignment: { startDate?: string | null; endDate: string | null } | null | undefined,
  today: string,
): AssignmentStatus {
  if (!assignment) return "none";
  const end = normalizeEndDate(assignment.endDate);
  if (end && end < today) return "expired";
  if (!isValidOn(assignment, today)) return "upcoming";
  if (end && end <= addDays(today, EXPIRY_WARNING_DAYS)) return "expiring";
  return "valid";
}
