/**
 * Assignment status for one matrix cell. All dates are plain calendar dates ("YYYY-MM-DD"),
 * compared as strings, so there are no time-zone shifts.
 */

export type AssignmentStatus = "none" | "valid" | "expiring" | "expired";

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

/** Calendar arithmetic in UTC so daylight-saving changes cannot shift the result. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * - no assignment                         → "none"
 * - end date before today                 → "expired"
 * - end date today … today + 30 days      → "expiring" (the end date is the last valid day)
 * - no end date, or later than that       → "valid"
 */
export function getAssignmentStatus(assignment: { endDate: string | null } | null | undefined, today: string): AssignmentStatus {
  if (!assignment) return "none";
  const end = normalizeEndDate(assignment.endDate);
  if (!end) return "valid";
  if (end < today) return "expired";
  if (end <= addDays(today, EXPIRY_WARNING_DAYS)) return "expiring";
  return "valid";
}
