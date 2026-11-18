import { describe, expect, it } from "vitest";
import { checkSkillForJob, heldAcrossRecords, jobDayLabel, matchTechnicians, minimumLevelLabel } from "./jobMatch";
import { NO_JOB_TITLE, jobTitleOptions, selectedJobTitles, withJobTitles } from "./jobTitleFilter";
import { buildPeople } from "./persons";
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

  it("names every problem of a skill, not only the first: expired and too low a level", () => {
    const min = { level: 2, name: "Advanced" };
    expect(checkSkillForJob(assignment({ endDate: "2026-11-01" }), firstAid, JOB, TODAY, min).reason).toBe(
      "First aid expired on 01.11.2026; level Basic, Advanced needed",
    );
    expect(checkSkillForJob(assignment({ startDate: "2026-12-20" }), firstAid, JOB, TODAY, min).reason).toBe(
      "First aid is valid only from 20.12.2026; level Basic, Advanced needed",
    );
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

describe("Find technician with the Job title filter: only the people shown are counted", () => {
  const persons = [
    { id: "anna", name: "anna", jobTitle: "Service Technician" }, // ready
    { id: "ben", name: "ben", jobTitle: "Service Technician" }, // almost: First aid ends before the job
    { id: "cara", name: "cara", jobTitle: "Electrician" }, // misses one skill
    { id: "dino", name: "dino", jobTitle: "Service Technician" }, // has nothing
    { id: "eli", name: "eli", jobTitle: null }, // no job title, holds both
    { id: "fay", name: "fay", jobTitle: null }, // no job title, holds nothing: never listed
  ];
  const held: Record<string, ReturnType<typeof assignment>> = {
    "anna|aid": assignment(),
    "anna|heights": assignment(),
    "ben|aid": assignment({ endDate: "2026-12-09" }),
    "ben|heights": assignment(),
    "cara|aid": assignment(),
    "eli|aid": assignment(),
    "eli|heights": assignment(),
  };
  const options = jobTitleOptions(persons);
  const counts = (stored: string[] | null) => {
    const shown = withJobTitles(persons, selectedJobTitles(stored, options));
    const r = matchTechnicians(shown, [firstAid, heights], (p, s) => held[`${p}|${s}`], JOB, TODAY, null, (p) => Boolean(p.jobTitle));
    return {
      ready: r.ready.map((x) => x.person.id),
      almost: r.almost.map((x) => x.person.id),
      missingOne: r.missingOne.map((x) => x.person.id),
      others: r.others,
    };
  };

  it.each([
    ["nothing stored: the default, Service Technician", null, { ready: ["anna"], almost: ["ben"], missingOne: [], others: 1 }],
    ["cleared (explicit everyone): people without a job title come back", [], { ready: ["anna", "eli"], almost: ["ben"], missingOne: ["cara"], others: 1 }],
    ["only 'No job title'", [NO_JOB_TITLE], { ready: ["eli"], almost: [], missingOne: [], others: 0 }],
    ["Electrician", ["Electrician"], { ready: [], almost: [], missingOne: ["cara"], others: 0 }],
    ["a title nobody has any more: everyone", ["Mechanic"], { ready: ["anna", "eli"], almost: ["ben"], missingOne: ["cara"], others: 1 }],
  ] as const)("%s", (_case, stored, expected) => {
    expect(counts(stored === null ? null : [...stored])).toEqual(expected);
  });

  it("keeps the persons' order and the same objects", () => {
    const shown = withJobTitles(persons, ["Service Technician"]);
    expect(shown.map((p) => p.id)).toEqual(["anna", "ben", "dino"]);
    expect(shown[0]).toBe(persons[0]);
    expect(withJobTitles(persons, [])).toEqual(persons);
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

describe("one person with several records (ERP user and Employee, linked by refId)", () => {
  // The same list every screen uses (src/lib/domain/persons.ts): Employee record listed first on purpose.
  const anna = buildPeople(
    [{ id: "U-ANNA", refId: "annaU", name: "Anna Schneider", jobTitle: "Service Technician" }],
    [
      { id: "annaE", refId: "annaU", type: "EMPLOYEE" },
      { id: "annaU", refId: "annaU", type: "ERPUSER" },
    ],
  );
  const welding = { id: "weld", name: "Welding" };
  const match = (held: Record<string, ReturnType<typeof assignment>>, required: { id: string; name: string }[], min: { level: number; name: string } | null = null) => {
    const groups = anna.map((person) => ({ person, records: person.records }));
    const lookup = heldAcrossRecords(groups, (p, s) => held[`${p}|${s}`], JOB, TODAY, min);
    return { lookup, result: matchTechnicians(groups.map((g) => g.person), required, (p, s) => lookup(p, s)?.held, JOB, TODAY, min) };
  };

  it("is ready when the job's skills are spread over her records (Welding on Employee, First aid on ERP user)", () => {
    const { result } = match({ "annaE|weld": assignment(), "annaU|aid": assignment() }, [welding, firstAid]);
    expect(result.ready.map((r) => r.person.id)).toEqual(["annaU"]);
  });

  it("counts once when both records hold the skill", () => {
    const { result } = match({ "annaE|aid": assignment(), "annaU|aid": assignment() }, [firstAid]);
    expect(result.ready).toHaveLength(1);
  });

  it("is ready, and not also listed as missing the skill, when only the Employee record holds it", () => {
    const { result, lookup } = match({ "annaE|aid": assignment() }, [firstAid]);
    expect(result.ready.map((r) => r.person.id)).toEqual(["annaU"]);
    expect(result.missingOne).toEqual([]);
    expect(lookup("annaU", "aid")?.record.id).toBe("annaE"); // a click opens the record that holds it
  });

  it("takes the best assignment across her records: a valid one beats an expired one", () => {
    const { lookup, result } = match({ "annaU|aid": assignment({ endDate: "2026-11-01" }), "annaE|aid": assignment() }, [firstAid]);
    expect(lookup("annaU", "aid")?.record.id).toBe("annaE");
    expect(result.ready).toHaveLength(1);
  });

  it("when none counts, takes the one closest to counting (the later end date)", () => {
    const { lookup } = match({ "annaU|aid": assignment({ endDate: "2026-11-01" }), "annaE|aid": assignment({ endDate: "2026-12-10" }) }, [firstAid]);
    expect(lookup("annaU", "aid")?.record.id).toBe("annaE");
  });
});

describe("jobDayLabel (the cell in Find technician)", () => {
  const label = (over: Parameters<typeof assignment>[0] | null, min: { level: number; name: string } | null = null) => {
    const held = over === null ? undefined : assignment(over);
    return jobDayLabel(held, checkSkillForJob(held, firstAid, JOB, TODAY, min), JOB, TODAY);
  };

  it.each([
    [null, "none", "Not assigned"],
    [{}, "valid", "Valid on job day"],
    [{ endDate: "2026-11-15" }, "expired", "Expired 15.11.2026"],
    [{ endDate: "2026-12-01" }, "expiring", "Ends 01.12.2026"],
    [{ startDate: "2026-12-20" }, "upcoming", "Starts 20.12.2026"],
  ] as const)("%j → %s, %s", (over, status, text) => {
    expect(label(over)).toEqual({ status, label: text });
  });

  it("names a level that is too low", () => {
    expect(label({}, { level: 2, name: "Advanced" })).toEqual({ status: "expiring", label: "Level too low" });
  });
});

describe("minimumLevelLabel (the 'Minimum level' choices)", () => {
  const scale = [
    { level: 1, name: "Basic" },
    { level: 2, name: "Advanced" },
    { level: 3, name: "Expert" },
  ];

  it("says 'or higher' for every level that has a higher one", () => {
    expect(minimumLevelLabel(scale[0], scale)).toBe("Basic or higher");
    expect(minimumLevelLabel(scale[1], scale)).toBe("Advanced or higher");
  });

  it("names the highest level of the scale on its own, also when the scale is not sorted", () => {
    expect(minimumLevelLabel(scale[2], scale)).toBe("Expert");
    expect(minimumLevelLabel(scale[2], [scale[2], scale[0], scale[1]])).toBe("Expert");
  });
});
