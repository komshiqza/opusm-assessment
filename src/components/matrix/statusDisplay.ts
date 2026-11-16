import type { AssignmentStatus } from "@/lib/domain/status";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n/t";
import type { MessageKey } from "@/lib/i18n/messages";

/** Icon, colour and words for each status. Colour is never the only signal: there is always text. */
const STATUS_LOOK: Record<AssignmentStatus, { labelKey: MessageKey; icon: string; color: string; design: "Positive" | "Critical" | "Negative" | "None" }> = {
  upcoming: { labelKey: "status.upcoming", icon: "future", color: "var(--sapNeutralTextColor)", design: "None" },
  valid: { labelKey: "status.valid", icon: "sys-enter-2", color: "var(--sapPositiveTextColor)", design: "Positive" },
  expiring: { labelKey: "status.expiring", icon: "alert", color: "var(--sapCriticalTextColor)", design: "Critical" },
  expired: { labelKey: "status.expired", icon: "error", color: "var(--sapNegativeTextColor)", design: "Negative" },
  none: { labelKey: "status.none", icon: "less", color: "var(--sapContent_LabelColor)", design: "None" },
};

/** Icon, colour and words for each status; `label` is read in the current language. */
export const STATUS_DISPLAY = Object.fromEntries(
  (Object.keys(STATUS_LOOK) as AssignmentStatus[]).map((status) => {
    const { labelKey, ...look } = STATUS_LOOK[status];
    return [
      status,
      {
        ...look,
        get label() {
          return t(labelKey);
        },
      },
    ];
  }),
) as Record<AssignmentStatus, { label: string; icon: string; color: string; design: "Positive" | "Critical" | "Negative" | "None" }>;

/** Short text in a matrix cell, e.g. "Expires 01.12.2026" or "Starts 01.01.2027". */
export function statusText(status: AssignmentStatus, assignment: { startDate: string | null; endDate: string | null } | null | undefined): string {
  const endDate = assignment?.endDate ?? null;
  if (status === "upcoming") return t("status.startsOn", { date: formatDate(assignment?.startDate) });
  if (status === "expired") return t("status.expiredOn", { date: formatDate(endDate) });
  if (status === "expiring") return t("status.expiresOn", { date: formatDate(endDate) });
  if (status === "valid") return endDate ? t("status.validTo", { date: formatDate(endDate) }) : t("status.validNoEnd");
  return "";
}

/**
 * What a click on a matrix cell or a phone-card line does: open the assignment, assign the skill, or,
 * on an empty cell of a secondary record (src/lib/domain/persons.ts), nothing: new skills go on the
 * person's main record. Existing skills on a secondary record stay fully usable.
 */
export function cellAction(assigned: boolean, secondaryRecord: boolean): "open" | "assign" | "assignOnMain" {
  if (assigned) return "open";
  return secondaryRecord ? "assignOnMain" : "assign";
}

/** What a screen reader hears on an empty cell: "Assign." only where a skill can be assigned. */
export function emptyCellLabel(person: string, skill: string, action: "assign" | "assignOnMain"): string {
  return t(action === "assign" ? "matrix.cellNotAssigned" : "matrix.cellNotAssignedHere", { person, skill });
}

/** "2027-09-12" → "12.09.27": the date in a narrow matrix cell. */
function shortDate(iso: string | null | undefined): string {
  return formatDate(iso).replace(/\.\d{2}(\d{2})$/, ".$1");
}

/**
 * Narrow matrix cells: the date only, next to the status icon ("12.09.27"). The start date for a skill
 * that starts later, otherwise the end date. The full text stays in the cell's tooltip and screen-reader label.
 */
export function compactStatusText(status: AssignmentStatus, assignment: { startDate: string | null; endDate: string | null } | null | undefined): string {
  if (status === "none") return "";
  if (status === "upcoming") return shortDate(assignment?.startDate);
  return assignment?.endDate ? shortDate(assignment.endDate) : t("status.noEnd");
}
