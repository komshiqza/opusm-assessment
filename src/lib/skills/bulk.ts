/**
 * One skill to several persons (at most 25 per action): one guarded create per person, with the
 * same duplicate check and the same check after a write FSM did not answer as a single assignment.
 */
import { FsmTimeoutError } from "@/lib/fsm/client";
import { toUserMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/t";
import type { Assignment, AssignmentInput } from "./types";
import { AssignmentExistsError, checkAssignmentCreatedForPerson, createAssignmentForPerson, toWritableDates, type WriteCheck } from "./repository";

/** Shared company: no bulk imports beyond a few dozen records, so one action is capped. */
export const BULK_LIMIT = 25;

/** What happened for one person. `checkFirst`: a create FSM did not answer; a retry looks in FSM before creating. */
export interface BulkResult {
  personId: string;
  result: "assigned" | "skipped" | "failed" | "unconfirmed";
  error?: string;
  checkFirst?: boolean;
}

/** The answer of a check after a timed-out create, as a bulk result. */
function fromCheck(personId: string, check: WriteCheck<Assignment>): BulkResult {
  if (check.result === "done") return { personId, result: "assigned" };
  if (check.result === "notDone") return { personId, result: "failed", error: t("assign.notInFsm"), checkFirst: true };
  return { personId, result: "unconfirmed", error: check.error };
}

/**
 * A person's refId (SAP's key for all records of one human). Creates and checks read the person's
 * records fresh by it: new assignments go to the current main record, a skill on any record counts.
 */
export type RefIdOf = (personId: string) => string;
const refIdIsId: RefIdOf = (personId) => personId;

/** One person: the same guarded create as a single assignment, with the same timeout check. */
async function assignOne(tagId: string, personId: string, input: AssignmentInput, checkFirst: boolean, refIdOf: RefIdOf): Promise<BulkResult> {
  const refId = refIdOf(personId);
  if (checkFirst) {
    const check = await checkAssignmentCreatedForPerson(tagId, refId);
    if (check.result !== "notDone") return fromCheck(personId, check);
  }
  try {
    await createAssignmentForPerson(tagId, refId, input);
    return { personId, result: "assigned" };
  } catch (e) {
    if (e instanceof AssignmentExistsError) return { personId, result: "skipped" };
    if (e instanceof FsmTimeoutError && e.write) return fromCheck(personId, await checkAssignmentCreatedForPerson(tagId, refId));
    return { personId, result: "failed", error: toUserMessage(e) };
  }
}

/**
 * Assigns one skill to several persons, one after another: each create goes through the same guards
 * and duplicate check as a single assignment, and a person who already has the skill is skipped.
 * Returns one result per person; a failure does not stop the others. No certificates in bulk.
 */
export async function bulkAssign(
  tagId: string,
  personIds: string[],
  input: AssignmentInput,
  onProgress?: (index: number, total: number) => void,
  refIdOf: RefIdOf = refIdIsId,
): Promise<BulkResult[]> {
  if (personIds.length > BULK_LIMIT) throw new Error(t("bulk.limit", { max: BULK_LIMIT }));
  toWritableDates(input); // invalid dates: stop before the first write
  const results: BulkResult[] = [];
  for (const [index, personId] of personIds.entries()) {
    onProgress?.(index, personIds.length);
    results.push(await assignOne(tagId, personId, input, false, refIdOf));
  }
  return results;
}

/** Try again for the failed persons only; a timed-out one is looked up in FSM first, never created twice. */
export async function retryBulk(tagId: string, failed: BulkResult[], input: AssignmentInput, refIdOf: RefIdOf = refIdIsId): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  for (const r of failed) results.push(await assignOne(tagId, r.personId, input, r.checkFirst ?? false, refIdOf));
  return results;
}

/** Check again for persons whose timed-out create could not be confirmed. Reads only. */
export async function recheckBulk(tagId: string, unconfirmed: BulkResult[], refIdOf: RefIdOf = refIdIsId): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  for (const r of unconfirmed) results.push(fromCheck(r.personId, await checkAssignmentCreatedForPerson(tagId, refIdOf(r.personId))));
  return results;
}
