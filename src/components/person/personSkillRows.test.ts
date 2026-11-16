import { describe, expect, it } from "vitest";
import { personSkillRows } from "./personSkillRows";

const TODAY = "2026-11-16";
const definitions = [
  { id: "AID", name: "First aid" },
  { id: "WELD", name: "Welding (steel)" },
  { id: "HEIGHTS", name: "Working at heights" },
];
const assignment = (id: string, tagId: string, endDate: string | null) => ({
  id,
  tagId,
  personId: "anna",
  startDate: "2025-01-01",
  endDate,
  proficiencyId: "L1",
  proficiencyName: "Basic",
  proficiencyLevel: 1,
});
const held: Record<string, ReturnType<typeof assignment>> = {
  "anna|WELD": assignment("S1", "WELD", "2026-11-20"),
  "anna|AID": assignment("S2", "AID", null),
};
const certificates = new Map([["S1", [{ id: "C1", skillId: "S1", fileName: "weld.pdf", type: "PDF", createdAt: null }]]]);

describe("personSkillRows (all skills of one person)", () => {
  const rows = personSkillRows("anna", definitions, (p, t) => held[`${p}|${t}`], certificates, TODAY);

  it("lists every skill of the catalogue: held ones first, then the ones to assign", () => {
    expect(rows.map((r) => [r.definition.id, r.status])).toEqual([
      ["AID", "valid"],
      ["WELD", "expiring"],
      ["HEIGHTS", "none"],
    ]);
  });

  it("carries dates, level and certificates of a held skill", () => {
    const weld = rows.find((r) => r.definition.id === "WELD")!;
    expect(weld.assignment?.endDate).toBe("2026-11-20");
    expect(weld.assignment?.proficiencyName).toBe("Basic");
    expect(weld.certificates.map((c) => c.fileName)).toEqual(["weld.pdf"]);
  });

  it("a skill the person does not have has no assignment and no certificates", () => {
    const heights = rows.find((r) => r.definition.id === "HEIGHTS")!;
    expect(heights.assignment).toBeUndefined();
    expect(heights.certificates).toEqual([]);
  });
});
