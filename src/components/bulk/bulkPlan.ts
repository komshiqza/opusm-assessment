import { BULK_LIMIT, type BulkResult } from "@/lib/skills/bulk";

/**
 * Preview of a bulk assignment: who gets the skill and who is skipped because they already have it.
 * Only persons to assign count against the limit (a skipped person needs no write).
 */
export function planBulk(selected: string[], hasSkill: (personId: string) => boolean) {
  const toAssign = selected.filter((id) => !hasSkill(id));
  return { toAssign, skip: selected.filter(hasSkill), overLimit: toAssign.length > BULK_LIMIT };
}

/** Replaces the lines of the persons a retry or check was for; the other lines stay as they are. */
export function mergeResults(current: BulkResult[], update: BulkResult[]): BulkResult[] {
  const byPerson = new Map(update.map((r) => [r.personId, r]));
  return current.map((r) => byPerson.get(r.personId) ?? r);
}
