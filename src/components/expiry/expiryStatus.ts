import { daysBetween, getAssignmentStatus, type AssignmentStatus } from "@/lib/domain/status";
import { statusText } from "@/components/matrix/statusDisplay";
import { t, tn } from "@/lib/i18n/t";

/**
 * The status cell of a row in "Expiry overview": days left, "Ends today" or "Expired n days ago". An
 * assignment that has not started yet is labelled like in the matrix ("Starts …", grey), which does
 * not count it as expiring.
 */
export function expiryStatus(assignment: { startDate: string | null; endDate: string }, today: string): { status: AssignmentStatus; text: string } {
  const status = getAssignmentStatus(assignment, today);
  if (status === "upcoming") return { status, text: statusText(status, assignment) };
  const left = daysBetween(today, assignment.endDate);
  return { status, text: left < 0 ? tn("expiry.expiredAgo", -left) : left === 0 ? t("expiry.endsToday") : tn("expiry.daysLeft", left) };
}
