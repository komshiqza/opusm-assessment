/**
 * Namespacing in the shared FSM company. All candidates work in the same company, so every
 * skill (Tag) and every proficiency scale you create is named `<CANDIDATE_ID>::<display name>`.
 * Only touch objects in your own namespace. See ASSIGNMENT.md, "Rules for the shared company".
 */
export const CANDIDATE_ID = (process.env.NEXT_PUBLIC_CANDIDATE_ID ?? "").trim().toLowerCase();

export const CANDIDATE_ID_VALID = /^[a-z0-9-]{3,20}$/.test(CANDIDATE_ID);

export const NAME_PREFIX = `${CANDIDATE_ID}::`;

/** "Hydraulics" → "jdoe::Hydraulics" (use for Tag and Scale names) */
export function toScopedName(displayName: string): string {
  return `${NAME_PREFIX}${displayName.trim()}`;
}

/** "jdoe::Hydraulics" → "Hydraulics" */
export function fromScopedName(name: string): string {
  return name.startsWith(NAME_PREFIX) ? name.slice(NAME_PREFIX.length) : name;
}

/** True when the Tag / Scale name belongs to you. */
export function isOwnName(name: string): boolean {
  return CANDIDATE_ID_VALID && name.startsWith(NAME_PREFIX);
}
