import { describe, expect, it } from "vitest";
import { checkSkillForJob, matchTechnicians } from "./jobMatch";
import { isValidOn } from "./status";

const JOB = "2026-12-15";
const TODAY = "2026-11-16";

describe("isValidOn", () => {
  it.each([
    // [startDate, endDate, expected, why]
    ["2026-01-01", null, true, "no end date"],
    ["2026-01-01", "2026-12-14", false, "ends the day before the job"],
    ["2026-01-01", "2026-12-15", true, "ends on the job day (last valid day)"],
    ["2026-01-01", "2026-12-16", true, "ends the day after the job"],
    ["2026-12-15", null, true, "starts on the job day"],
    ["2026-12-16", null, false, "starts the day after the job"],
    [null, "9999-12-31", true, "Skill Service open end"],
  ] as const)("start %s, end %s → %s (%s)", (startDate, endDate, expected, _why) => {
    expect(isValidOn({ startDate, endDate }, JOB)).toBe(expected);
  });
});

const assignment = (over: Partial<{ startDate: string | null; endDate: string | null; proficiencyLevel: number | null; proficiencyName: string | null }> = {}) => ({
  startDate: "2025-01-01",
  endDate: null,
  proficiencyLevel: 1,
  proficiencyName: "Basic",
  ...over,
});
const firstAid = { id: "aid", name: "First aid" };
const heights = { id: "heights", name: "Working at heights" };

describe("checkSkillForJob", () => {
  it("is ok when valid on the job date", () => {
    expect(checkSkillForJob(assignment(), firstAid, JOB, TODAY, null)).toEqual({ ok: true, reason: null, missing: false });
  });

  it("names a missing skill", () => {
    expect(checkSkillForJob(undefined, heights, JOB, TODAY, null).reason).toBe("Missing: Working at heights");
  });

  it("counts the days when the skill ends before the job", () => {
    expect(checkSkillForJob(assignment({ endDate: "2026-12-09" }), firstAid, JOB, TODAY, null).reason).toBe("First aid ends 6 days before the job");
    expect(checkSkillForJob(assignment({ endDate: "2026-12-14" }), firstAid, JOB, TODAY, null).reason).toBe("First aid ends 1 day before the job");
  });

  it("says when the skill has already expired", () => {
    expect(checkSkillForJob(assignment({ endDate: "2026-11-01" }), firstAid, JOB, TODAY, null).reason).toBe("First aid expired on 01.11.2026");
  });

  it("says when the skill starts only after the job", () => {
    expect(checkSkillForJob(assignment({ startDate: "2026-12-20" }), firstAid, JOB, TODAY, null).reason).toBe("First aid is valid only from 20.12.2026");
  });

  it("checks the minimum level", () => {
    const min = { level: 2, name: "Advanced" };
    expect(checkSkillForJob(assignment(), firstAid, JOB, TODAY, min).reason).toBe("First aid: Basic, Advanced needed");
    expect(checkSkillForJob(assignment({ proficiencyLevel: null, proficiencyName: null }), firstAid, JOB, TODAY, min).reason).toBe(
      "First aid: no level, Advanced needed",
    );
    expect(checkSkillForJob(assignment({ proficiencyLevel: 3, proficiencyName: "Expert" }), firstAid, JOB, TODAY, min).ok).toBe(true);
  });
});

describe("matchTechnicians", () => {
  const persons = ["anna", "ben", "cara", "dino"].map((id) => ({ id, name: id }));
  const held: Record<string, ReturnType<typeof assignment>> = {
    "anna|aid": assignment(),
    "anna|heights": assignment(),
    "ben|aid": assignment({ endDate: "2026-12-09" }),
    "ben|heights": assignment(),
    "cara|aid": assignment(),
    // dino has nothing
  };
  const lookup = (personId: string, tagId: string) => held[`${personId}|${tagId}`];

  it("splits persons into ready, almost (one gap that can be fixed), missing one skill, and the rest", () => {
    const result = matchTechnicians(persons, [firstAid, heights], lookup, JOB, TODAY, null);
    expect(result.ready.map((r) => r.person.id)).toEqual(["anna"]);
    expect(result.almost.map((r) => [r.person.id, r.reason])).toEqual([["ben", "First aid ends 6 days before the job"]]);
    expect(result.missingOne.map((r) => [r.person.id, r.skillName])).toEqual([["cara", "Working at heights"]]);
    expect(result.others).toBe(1);
  });

  it("with one required skill, 'almost' holds only renewals, levels and later starts, not everyone without the skill", () => {
    const people = ["aaron", "bea", "zoe", "lev", "sam"].map((id) => ({ id, name: id }));
    const skills: Record<string, ReturnType<typeof assignment>> = {
      "zoe|aid": assignment({ endDate: "2026-12-10" }), // renew before the job
      "lev|aid": assignment({ proficiencyLevel: 1, proficiencyName: "Basic" }), // level too low
      "sam|aid": assignment({ startDate: "2026-12-20" }), // starts after the job
    };
    const expert = { level: 3, name: "Expert" };
    const result = matchTechnicians(people, [firstAid], (p, s) => skills[`${p}|${s}`], JOB, TODAY, expert);
    expect(result.almost.map((r) => r.person.id)).toEqual(["zoe", "lev", "sam"]);
    expect(result.missingOne.map((r) => r.person.id)).toEqual(["aaron", "bea"]);
    expect(result.others).toBe(0);
  });

  it("returns nothing when no skill is required", () => {
    expect(matchTechnicians(persons, [], lookup, JOB, TODAY, null)).toEqual({ ready: [], almost: [], missingOne: [], others: 0 });
  });
});

describe("people without a job title", () => {
  const tech = { id: "tech", name: "A Technician" };
  const staff = { id: "staff", name: "Dominic" }; // no job title, holds our skills
  const notTechnician = (p: { id: string }) => p.id !== "staff";

  it("lists a person without a job title who can do the job, after the technicians", () => {
    const held: Record<string, ReturnType<typeof assignment>> = { "staff|aid": assignment(), "tech|aid": assignment() };
    const result = matchTechnicians([staff, tech], [firstAid], (p, s) => held[`${p}|${s}`], JOB, TODAY, null, notTechnician);
    expect(result.ready.map((r) => [r.person.id, r.technician])).toEqual([
      ["tech", true],
      ["staff", false],
    ]);
  });

  it("leaves out a person without a job title who has none of the required skills", () => {
    const held: Record<string, ReturnType<typeof assignment>> = { "staff|heights": assignment() };
    const result = matchTechnicians([staff], [firstAid], (p, s) => held[`${p}|${s}`], JOB, TODAY, null, notTechnician);
    expect(result).toEqual({ ready: [], almost: [], missingOne: [], others: 0 });
  });

  it("puts technicians first in the 'missing one skill' list too", () => {
    const held: Record<string, ReturnType<typeof assignment>> = { "staff|heights": assignment(), "tech|heights": assignment() };
    const result = matchTechnicians([staff, tech], [firstAid, heights], (p, s) => held[`${p}|${s}`], JOB, TODAY, null, notTechnician);
    expect(result.missingOne.map((r) => [r.person.id, r.technician])).toEqual([
      ["tech", true],
      ["staff", false],
    ]);
  });

  it("puts technicians first in the 'almost' list too", () => {
    const held: Record<string, ReturnType<typeof assignment>> = {
      "staff|aid": assignment({ endDate: "2026-12-01" }),
      "tech|aid": assignment({ endDate: "2026-12-01" }),
    };
    const result = matchTechnicians([staff, tech], [firstAid], (p, s) => held[`${p}|${s}`], JOB, TODAY, null, notTechnician);
    expect(result.almost.map((r) => [r.person.id, r.technician])).toEqual([
      ["tech", true],
      ["staff", false],
    ]);
  });
});
