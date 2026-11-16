/** Input validation for the dialogs. Each function returns an error message or null. */
import { OPEN_END_DATE } from "./status";
import { t } from "@/lib/i18n/t";

export const MAX_SKILL_NAME_LENGTH = 100;
function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** What is wrong with a validity period, and which field to mark (the message is in the current language). */
export function validityProblem(from: string | null, to: string | null): { field: "from" | "to"; kind: "invalid" | "reserved" | "beforeFrom"; message: string } | null {
  if (from && !isValidIsoDate(from)) return { field: "from", kind: "invalid", message: t("validation.fromInvalid") };
  if (to && !isValidIsoDate(to)) return { field: "to", kind: "invalid", message: t("validation.toInvalid") };
  if (to === OPEN_END_DATE) return { field: "to", kind: "reserved", message: t("validation.reservedEnd") };
  if (from && to && to < from) return { field: "to", kind: "beforeFrom", message: t("validation.toBeforeFrom") };
  return null;
}

export function validateValidity(from: string | null, to: string | null): string | null {
  return validityProblem(from, to)?.message ?? null;
}

/** The Skill Service needs a start date, so an empty "valid from" means today. */
export function effectiveStartDate(from: string | null, today: string): string {
  return from || today;
}

export function validateSkillName(displayName: string, existingDisplayNames: string[]): string | null {
  const name = displayName.trim();
  if (!name) return t("validation.nameEmpty");
  if (name.length > MAX_SKILL_NAME_LENGTH) return t("validation.nameTooLong", { max: MAX_SKILL_NAME_LENGTH });
  if (name.includes("::")) return t("validation.nameColons");
  const lower = name.toLowerCase();
  if (existingDisplayNames.some((n) => n.toLowerCase() === lower)) return t("validation.nameExists", { name });
  return null;
}
