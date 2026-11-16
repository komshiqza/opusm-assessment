/**
 * Write guard for the shared FSM company.
 *
 * We may only change Tags/Scales named `<CANDIDATE_ID>::…`, Skills of those Tags and Attachments
 * of those Skills. Every write in `src/lib/skills/repository.ts` first calls one of these checks
 * (with data read fresh from FSM right before the write) and refuses the write if it fails.
 * The proxy's own allowlist stays in place underneath; this is the second, per-record layer.
 */
import { CANDIDATE_ID_VALID, NAME_PREFIX } from "@/lib/candidate";

export class OwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnershipError";
  }
}

/** FSM ids are 32 hex characters. Checked before an id is put into a CoreSQL string. */
const FSM_ID = /^[0-9A-F]{32}$/i;

export function assertFsmId(id: string): void {
  if (!FSM_ID.test(id)) throw new OwnershipError(`Refused: "${id}" is not a valid FSM id.`);
}

/** Tag or Scale name must be `<CANDIDATE_ID>::<non-empty name>` (case-sensitive). */
export function assertOwnName(name: string, what: "Tag" | "Scale"): void {
  if (!CANDIDATE_ID_VALID) {
    throw new OwnershipError("Refused: NEXT_PUBLIC_CANDIDATE_ID is missing or invalid, so no write is allowed.");
  }
  if (!name.startsWith(NAME_PREFIX) || name.slice(NAME_PREFIX.length).trim() === "") {
    throw new OwnershipError(`Refused: ${what} "${name}" is not in your namespace "${NAME_PREFIX}".`);
  }
}

/** A Skill or Attachment is ours only if the Tag it belongs to is ours. `null` = not found. */
export function assertOwnedByTagName(record: { tagName: string } | null, what: "Skill" | "Attachment"): void {
  if (!record) throw new OwnershipError(`Refused: the ${what} was not found or does not belong to one of your skills.`);
  try {
    assertOwnName(record.tagName, "Tag");
  } catch {
    throw new OwnershipError(`Refused: this ${what} belongs to the skill "${record.tagName}", which is not yours.`);
  }
}
