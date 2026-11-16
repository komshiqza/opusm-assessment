import { BULK_LIMIT, type BulkResult } from "@/lib/skills/bulk";

/**
 * Preview of a bulk assignment: who gets the skill and who is skipped because the matrix shows they
 * already have it. The matrix may be out of date, so every selected person is sent (`send`): FSM's
 * duplicate check skips who really has it, without a write. That is why all count against the limit.
 */
export function planBulk(selected: string[], hasSkill: (personId: string) => boolean) {
  const toAssign = selected.filter((id) => !hasSkill(id));
  const skip = selected.filter(hasSkill);
  const send = [...toAssign, ...skip];
  return { toAssign, skip, send, overLimit: send.length > BULK_LIMIT };
}

/** Who can be picked: not the secondary records (new skills go on the main record); `leftOut` is counted for a note. */
export function bulkCandidates<P extends { id: string }>(persons: P[], secondary: Set<string>): { selectable: P[]; leftOut: number } {
  const selectable = persons.filter((p) => !secondary.has(p.id));
  return { selectable, leftOut: persons.length - selectable.length };
}

/** Replaces the lines of the persons a retry or check was for; the other lines stay as they are. */
export function mergeResults(current: BulkResult[], update: BulkResult[]): BulkResult[] {
  const byPerson = new Map(update.map((r) => [r.personId, r]));
  return current.map((r) => byPerson.get(r.personId) ?? r);
}
