import { describe, expect, it } from "vitest";
import { knownSkillIds } from "./skillFilter";

const definitions = [{ id: "WELD" }, { id: "FIRST_AID" }];

describe("knownSkillIds (skill filter after a skill was deleted)", () => {
  it("drops a filtered skill that no longer exists", () => {
    expect(knownSkillIds(["DELETED"], definitions)).toEqual([]);
    expect(knownSkillIds(["WELD", "DELETED"], definitions)).toEqual(["WELD"]);
  });

  it("keeps the filter as it is when every skill still exists", () => {
    const filter = ["FIRST_AID", "WELD"];
    expect(knownSkillIds(filter, definitions)).toBe(filter);
  });
});
