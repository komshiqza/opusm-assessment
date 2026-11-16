/**
 * DTO versions for every `dtos=` parameter. Verified against the assessment company on 16.11.2026.
 * Add entries here when you query other entities.
 */
export const DTO = {
  Person: "Person.24",
  UnifiedPerson: "UnifiedPerson.13",
  Tag: "Tag.10",
  Skill: "Skill.11",
  Attachment: "Attachment.19",
} as const;

export type DtoEntity = keyof typeof DTO;

/** `dtos=` value for several entities, e.g. `Skill.11;Tag.10`. */
export function dtosParam(entities: DtoEntity[]): string {
  return Array.from(new Set(entities))
    .map((e) => DTO[e])
    .join(";");
}
