import type { AssignmentStatus } from "@/lib/domain/status";
import { formatDate } from "@/lib/format";

/** Icon, colour and words for each status. Colour is never the only signal: there is always text. */
export const STATUS_DISPLAY: Record<AssignmentStatus, { label: string; icon: string; color: string; design: "Positive" | "Critical" | "Negative" | "None" }> = {
  upcoming: { label: "Starts later", icon: "future", color: "var(--sapNeutralTextColor)", design: "None" },
  valid: { label: "Valid", icon: "sys-enter-2", color: "var(--sapPositiveTextColor)", design: "Positive" },
  expiring: { label: "Expiring soon", icon: "alert", color: "var(--sapCriticalTextColor)", design: "Critical" },
  expired: { label: "Expired", icon: "error", color: "var(--sapNegativeTextColor)", design: "Negative" },
  none: { label: "Not assigned", icon: "less", color: "var(--sapContent_LabelColor)", design: "None" },
};

/** Short text in a matrix cell, e.g. "Expires 01.12.2026" or "Starts 01.01.2027". */
export function statusText(status: AssignmentStatus, assignment: { startDate: string | null; endDate: string | null } | null | undefined): string {
  const endDate = assignment?.endDate ?? null;
  if (status === "upcoming") return `Starts ${formatDate(assignment?.startDate)}`;
  if (status === "expired") return `Expired ${formatDate(endDate)}`;
  if (status === "expiring") return `Expires ${formatDate(endDate)}`;
  if (status === "valid") return endDate ? `Valid to ${formatDate(endDate)}` : "Valid, no end";
  return "";
}
