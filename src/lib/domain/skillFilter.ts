/**
 * The skill filter without skills that no longer exist (e.g. deleted in the catalogue meanwhile).
 * Returns the same array when nothing was dropped, so callers can tell whether to prune their state.
 */
export function knownSkillIds(skillIds: string[], definitions: { id: string }[]): string[] {
  const known = skillIds.filter((id) => definitions.some((d) => d.id === id));
  return known.length === skillIds.length ? skillIds : known;
}
