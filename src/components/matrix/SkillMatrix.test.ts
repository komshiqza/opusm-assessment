import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cellKey, placeAssignments } from "@/lib/domain/persons";
import type { Assignment, Person, SkillDefinition } from "@/lib/skills/types";
import type { SkillDataState } from "@/hooks/useSkillData";
import { LockedCell } from "./LockedCell";
import { SkillMatrix } from "./SkillMatrix";

const anna: Person = {
  id: "ANNA-ERP",
  name: "Anna Schneider",
  jobTitle: "Service Technician",
  refId: "ANNA-EMP",
  records: [
    { id: "ANNA-ERP", type: "ERPUSER" },
    { id: "ANNA-EMP", type: "EMPLOYEE" },
  ],
};
const eva: Person = { id: "EVA-ERP", name: "Eva Graf", jobTitle: "Service Technician", refId: "EVA-ERP", records: [{ id: "EVA-ERP", type: "ERPUSER" }] };
const aid: SkillDefinition = { id: "AID", name: "First aid", description: null, scaleId: null };
const onEmployee: Assignment = { id: "S1", tagId: "AID", personId: "ANNA-EMP", startDate: null, endDate: null, proficiencyId: null, proficiencyName: "Basic", proficiencyLevel: 1 };

function state(): SkillDataState {
  const persons = [anna, eva];
  const assignments = [onEmployee];
  const placed = placeAssignments(persons, assignments);
  return {
    data: { persons, definitions: [aid], assignments, certificates: [], scale: null },
    loading: false,
    refreshing: false,
    error: null,
    reload: async () => true,
    assignmentByCell: placed.byCell,
    alsoOnByCell: placed.alsoOn,
    assignmentByRecord: new Map(assignments.map((a) => [cellKey(a.personId, a.tagId), a])),
    personOfRecord: placed.ownerOf,
    certificatesBySkill: new Map(),
  };
}

const render = () =>
  renderToStaticMarkup(createElement(SkillMatrix, { state: state(), onOpenCell: () => {}, onOpenPerson: () => {}, onGoToCatalogue: () => {} }));

describe("SkillMatrix with 'Show each FSM record'", () => {
  it("is off on every load: one row per person, every cell a button, the switch unticked with the record count", () => {
    const html = render();
    const toggle = html.match(/<ui5-checkbox[^>]*>/)?.[0] ?? "";
    expect(toggle).toContain('text="Show each FSM record (3)"');
    expect(toggle).not.toMatch(/\schecked/);
    expect(html).toContain("People (2)");
    expect(html.match(/<tr>/g)).toHaveLength(3); // header + 2 people
    expect(html).not.toContain("aria-disabled");
    expect(html.match(/<button type="button"/g)).toHaveLength(2); // one cell per person
  });
});

describe("LockedCell (a cell of a linked record: shown, never written)", () => {
  it("has no button or link, is marked disabled and keeps the full label for screen readers", () => {
    const html = renderToStaticMarkup(createElement(LockedCell, { label: "Anna Schneider, First aid: not on this record" }, "–"));
    expect(html).not.toMatch(/<button|<a\s|<ui5-link|tabindex/);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("Anna Schneider, First aid: not on this record");
  });
});
